"""Phase: Agentic Test — builds, packs, installs, and invokes the CLI to verify the feature works.

Architecture:
1. Orchestrator does deterministic build → pack → install (code, no agent needed)
2. Test Planner agent reads the devex doc and decides WHAT to test from WHAT angles
3. Tester agents are spawned in parallel, each with their specific scenario

The test planner is critical — it makes the testing feature-specific rather than generic.
Each feature gets custom test scenarios based on what it actually does.
"""

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

from core.harness_client import HarnessClient
from core.config import PipelineConfig


@dataclass
class TesterResult:
    focus: str
    passed: bool
    tests_run: int = 0
    tests_passed: int = 0
    tests_failed: int = 0
    bugs_found: list[str] = field(default_factory=list)
    raw_output: str = ""


@dataclass
class AgenticTestResult:
    passed: bool
    build_passed: bool = False
    pack_passed: bool = False
    install_passed: bool = False
    version_check_passed: bool = False
    feature_test_passed: bool = False
    tester_results: list[TesterResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    agent_output: str = ""


def run_agentic_test(
    client: HarnessClient,
    config: PipelineConfig,
    session_id: str,
    feature_name: str,
    prompts_dir: Path,
) -> AgenticTestResult:
    result = AgenticTestResult(passed=False)
    repo_name = config.cli_repo.split("/")[-1]

    # Step 1: Build
    stdout, _, exit_code = client.run_command(
        session_id,
        f"cd {repo_name} && npm run build 2>&1 | tail -20",
    )
    result.build_passed = exit_code == 0
    if not result.build_passed:
        result.errors.append(f"Build failed:\n{stdout[-500:]}")
        return result

    # Step 2: Pack
    stdout, _, exit_code = client.run_command(
        session_id,
        f"cd {repo_name} && npm pack 2>&1 | tail -5",
    )
    result.pack_passed = exit_code == 0
    if not result.pack_passed:
        result.errors.append(f"Pack failed:\n{stdout[-300:]}")
        return result

    # Step 3: Install globally
    stdout, _, exit_code = client.run_command(
        session_id,
        f"cd {repo_name} && npm install -g ./aws-agentcore-*.tgz 2>&1 | tail -10",
    )
    result.install_passed = exit_code == 0
    if not result.install_passed:
        result.errors.append(f"Install failed:\n{stdout[-300:]}")
        return result

    # Step 4: Version check
    stdout, _, exit_code = client.run_command(
        session_id,
        "agentcore --version 2>&1",
    )
    result.version_check_passed = exit_code == 0 and stdout.strip() != ""
    if not result.version_check_passed:
        result.errors.append(f"Version check failed: {stdout}")
        return result

    # Step 5: Plan test scenarios (agent reads devex doc and decides angles)
    test_scenarios = _plan_test_scenarios(client, session_id, feature_name, prompts_dir)
    if not test_scenarios:
        result.errors.append("Test planner failed to produce scenarios")
        return result

    print(f"  Test planner produced {len(test_scenarios)} scenarios:", flush=True)
    for s in test_scenarios:
        print(f"    - {s['name']}: {s['description'][:80]}", flush=True)

    # Step 6: Spawn parallel testers, one per scenario
    prompt_template = (prompts_dir / "agentic_test.md").read_text()

    def _run_tester(scenario: dict) -> TesterResult:
        tester_session = HarnessClient.new_session_id()
        prompt = prompt_template.format(
            feature_name=feature_name,
            test_focus=scenario["name"],
            test_id=scenario["name"].lower().replace(" ", "-").replace("_", "-"),
        )
        # Prepend the specific scenario instructions
        full_prompt = (
            f"{prompt}\n\n"
            f"## YOUR SPECIFIC TEST SCENARIO\n\n"
            f"**{scenario['name']}**\n\n"
            f"{scenario['description']}\n\n"
            f"Commands to try:\n"
            + "\n".join(f"- `{cmd}`" for cmd in scenario.get("commands", []))
            + "\n\nTest ALL of these commands and report results. "
            f"Go beyond this list if you discover other things worth testing."
        )
        output = client.invoke(session_id=tester_session, message=full_prompt)
        return _parse_tester_output(scenario["name"], output)

    print(f"  Spawning {len(test_scenarios)} test agents in parallel...", flush=True)

    with ThreadPoolExecutor(max_workers=len(test_scenarios)) as executor:
        futures = [executor.submit(_run_tester, scenario) for scenario in test_scenarios]
        for future in as_completed(futures):
            tester_result = future.result()
            result.tester_results.append(tester_result)
            if tester_result.bugs_found:
                result.errors.extend(tester_result.bugs_found)

    # Aggregate results
    all_passed = all(tr.passed for tr in result.tester_results)
    total_bugs = sum(len(tr.bugs_found) for tr in result.tester_results)
    result.feature_test_passed = all_passed and total_bugs == 0

    result.agent_output = "\n\n".join(
        f"=== {tr.focus} ===\n{tr.raw_output[:1000]}" for tr in result.tester_results
    )

    result.passed = (
        result.build_passed
        and result.pack_passed
        and result.install_passed
        and result.version_check_passed
        and result.feature_test_passed
    )
    return result


TEST_PLANNER_PROMPT = """You are a QA lead planning test scenarios for a CLI feature.

The feature `{feature_name}` has been built and installed. Read the DevEx doc to understand what it does:

```
cat /tmp/devex.md
```

Based on the DevEx doc, design 2-4 test scenarios that test the feature from DIFFERENT ANGLES.
Each scenario should cover a distinct path through the feature — not just "happy" vs "sad" but
actually different USER WORKFLOWS that exercise different code paths.

Examples of good angle separation:
- "Create fresh project with this feature" vs "Add feature to existing populated project"
- "Use feature with Framework A" vs "Use feature with Framework B"
- "Full lifecycle: add → configure → validate → deploy-dry-run → remove"
- "Error recovery: corrupt config, missing deps, invalid refs, duplicate resources"
- "Integration: feature interacts with agents, memories, credentials correctly"

Write a JSON array to /tmp/test_scenarios.json with this structure:
```json
[
  {{
    "name": "Scenario Name",
    "description": "Detailed description of what to test and WHY this angle matters",
    "commands": [
      "agentcore add config-bundle --name test",
      "agentcore validate",
      "cat agentcore/agentcore.json | jq .configBundles"
    ]
  }}
]
```

Rules:
- 2-4 scenarios. Not more. Each should be substantial.
- Commands should be REAL commands this feature exposes (based on the devex doc).
- Each scenario must test a genuinely different path, not the same thing with slight variations.
- Include the full command with flags, not just the verb.
- Scenarios should NOT require AWS deployment (local testing only).
- Write the file now. Do NOT explain — just write /tmp/test_scenarios.json.
"""


def _plan_test_scenarios(
    client: HarnessClient,
    session_id: str,
    feature_name: str,
    prompts_dir: Path,
) -> list[dict]:
    prompt = TEST_PLANNER_PROMPT.format(feature_name=feature_name)
    client.invoke(session_id=session_id, message=prompt)

    # Read the scenarios file the agent wrote
    stdout, _, exit_code = client.run_command(session_id, "cat /tmp/test_scenarios.json 2>/dev/null")
    if exit_code != 0 or not stdout.strip():
        return _fallback_scenarios(feature_name)

    try:
        scenarios = json.loads(stdout.strip())
        if isinstance(scenarios, list) and len(scenarios) >= 2:
            return scenarios
    except json.JSONDecodeError:
        pass

    return _fallback_scenarios(feature_name)


def _fallback_scenarios(feature_name: str) -> list[dict]:
    return [
        {
            "name": "Full Lifecycle",
            "description": f"Test the complete lifecycle of {feature_name}: create a project, use the feature, validate, and clean up.",
            "commands": [
                "agentcore --help",
                f"agentcore add --help",
                "agentcore validate",
            ],
        },
        {
            "name": "Error Handling",
            "description": f"Test that {feature_name} handles errors gracefully: invalid inputs, missing config, wrong types.",
            "commands": [
                "agentcore validate",
                f"agentcore add --help",
            ],
        },
    ]


def _parse_tester_output(focus: str, output: str) -> TesterResult:
    output_lower = output.lower()

    passed = "overall: pass" in output_lower
    if "overall: fail" in output_lower:
        passed = False

    # Extract counts
    tests_run = 0
    tests_passed = 0
    tests_failed = 0
    for line in output.split("\n"):
        line_lower = line.lower().strip()
        if line_lower.startswith("tests_run:"):
            try:
                tests_run = int(line_lower.split(":")[1].strip())
            except (ValueError, IndexError):
                pass
        elif line_lower.startswith("tests_passed:"):
            try:
                tests_passed = int(line_lower.split(":")[1].strip())
            except (ValueError, IndexError):
                pass
        elif line_lower.startswith("tests_failed:"):
            try:
                tests_failed = int(line_lower.split(":")[1].strip())
            except (ValueError, IndexError):
                pass

    # Extract bugs
    bugs: list[str] = []
    in_bugs_section = False
    for line in output.split("\n"):
        if "BUGS FOUND:" in line:
            in_bugs_section = True
            continue
        if in_bugs_section:
            if line.strip().startswith("- "):
                bugs.append(line.strip()[2:])
            elif line.strip() == "" or line.startswith("NOTES:"):
                in_bugs_section = False

    return TesterResult(
        focus=focus,
        passed=passed,
        tests_run=tests_run,
        tests_passed=tests_passed,
        tests_failed=tests_failed,
        bugs_found=bugs,
        raw_output=output,
    )


def run_agentic_test_with_retry(
    client: HarnessClient,
    config: PipelineConfig,
    session_id: str,
    feature_name: str,
    prompts_dir: Path,
    max_retries: int = 2,
) -> AgenticTestResult:
    """Run agentic test, retry on build/pack/install failures that might be fixable."""
    result = run_agentic_test(client, config, session_id, feature_name, prompts_dir)

    if result.passed:
        return result

    # Only retry if the build/pack/install failed (code issue we can fix)
    # Don't retry if testers found real bugs — those are valid findings
    if result.feature_test_passed is False and result.build_passed:
        return result

    for attempt in range(max_retries):
        fix_prompt = (
            f"The build/install step failed. Errors:\n"
            + "\n".join(result.errors[:3])
            + f"\n\nFix the build errors, commit, and push."
        )
        client.invoke(session_id=session_id, message=fix_prompt)

        result = run_agentic_test(client, config, session_id, feature_name, prompts_dir)
        if result.passed or result.build_passed:
            return result

    return result
