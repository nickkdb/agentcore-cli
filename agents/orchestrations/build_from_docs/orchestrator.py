"""Feature Builder Orchestrator — builds features from DevEx doc + Implementation Plan contracts.

Pipeline: Setup → Parse Contracts → Decompose → Execute Tasks (loop) → Agentic Test → Review → Fix → Complete
"""

import time
from pathlib import Path

from core.config import PipelineConfig
from core.harness_client import HarnessClient, MaxTokensExceededError
from core.progress import (
    init_progress,
    read_progress,
    set_status,
    get_next_pending_task_id,
    get_completed_task_ids,
)
from orchestrations.build_from_docs.phases.parse_contracts import (
    ContractMetadata,
    run_parse_contracts,
)
from orchestrations.build_from_docs.phases.decompose import (
    TaskGraph,
    run_decompose,
    get_execution_order,
)
from orchestrations.build_from_docs.phases.execute_task import run_execute_task
from orchestrations.build_from_docs.phases.verify_task import run_verify_task
from orchestrations.build_from_docs.phases.agentic_test import (
    AgenticTestResult,
    run_agentic_test_with_retry,
)
from orchestrations.build_from_docs.phases.review import run_feature_review
from orchestrations.build_from_docs.phases.complete import run_complete, CompleteResult
from orchestrations.fix_and_review.phases.aggregate import run_aggregate
from orchestrations.fix_and_review.phases.babysit import run_babysit
from orchestrations.fix_and_review.phases.fix import run_fix
from orchestrations.fix_and_review.phases.setup import set_prompts_dir


MAX_TASK_FAILURES = 3
PIPELINE_TIMEOUT_MINUTES = 180


def run_feature_pipeline(
    devex_path: str,
    impl_path: str,
    feature_name: str,
    config_path: str = "config.yaml",
    prompts_dir: str | Path | None = None,
    repos: list[str] | None = None,
    output=None,
) -> int:
    config = PipelineConfig.from_yaml(config_path)

    if prompts_dir:
        prompts_dir = Path(prompts_dir)
    else:
        prompts_dir = Path(__file__).resolve().parent.parent.parent / "feature_builder" / "prompts"

    _out = output or __import__("sys").stdout
    set_prompts_dir(prompts_dir)

    def _log(*args, **kwargs):
        kwargs.setdefault("file", _out)
        kwargs.setdefault("flush", True)
        print(*args, **kwargs)

    client = HarnessClient(config, output=_out)
    session_id = HarnessClient.new_session_id()
    short_id = session_id[:8].lower()
    branch_name = f"feature/{feature_name}-{short_id}"

    pipeline_start = time.time()
    _log("=== Feature Builder Pipeline Start ===")
    _log(f"Feature: {feature_name}")
    _log(f"Session: {session_id}")
    _log(f"Harness: {config.harness_arn}")
    _log()

    def elapsed() -> str:
        m, s = divmod(int(time.time() - pipeline_start), 60)
        return f"{m}m{s:02d}s"

    def check_timeout() -> bool:
        return (time.time() - pipeline_start) / 60 > PIPELINE_TIMEOUT_MINUTES

    # Phase 0: Setup — clone repos and create branch
    t0 = time.time()
    _log("--- Phase 0: Setup ---")
    _run_setup(client, config, session_id, feature_name, branch_name, repos or [], prompts_dir)
    _log(f"Setup complete. [{int(time.time()-t0)}s | total {elapsed()}]")
    _log()

    # Phase 1: Parse Contracts
    t0 = time.time()
    _log("--- Phase 1: Parse Contracts ---")
    contracts = run_parse_contracts(client, session_id, devex_path, impl_path, feature_name)
    effective_repos = repos or contracts.repos
    _log(f"Contracts parsed. Repos: {effective_repos} [{int(time.time()-t0)}s | total {elapsed()}]")
    _log()

    # Phase 2: Decompose into tasks
    t0 = time.time()
    _log("--- Phase 2: Decompose ---")
    task_graph = run_decompose(
        client, config, session_id,
        contracts.devex_content, contracts.impl_content,
        feature_name, effective_repos, prompts_dir,
    )
    ordered_tasks = get_execution_order(task_graph.tasks)

    # Normalize task repo fields to match what's actually cloned on disk
    cloned_repo_names = [r.split("/")[-1] for r in effective_repos]
    default_repo_name = cloned_repo_names[0] if cloned_repo_names else "agentcore-cli"
    for task in ordered_tasks:
        repo_name = task.repo.split("/")[-1] if "/" in task.repo else task.repo
        if repo_name not in cloned_repo_names:
            task.repo = default_repo_name

    _log(f"Decomposed into {len(ordered_tasks)} tasks. [{int(time.time()-t0)}s | total {elapsed()}]")
    for task in ordered_tasks:
        _log(f"  {task.id}: {task.title} [{task.size}] repo={task.repo}")
    _log()

    # Initialize progress file on VM
    init_progress(client, session_id, feature_name, [
        {"id": t.id, "title": t.title} for t in ordered_tasks
    ])

    # Phase 3: Execute tasks one by one
    _log("--- Phase 3: Execute Tasks ---")
    total_failures = 0

    for i, task in enumerate(ordered_tasks):
        if check_timeout():
            _log(f"  ⚠️  Pipeline timeout ({PIPELINE_TIMEOUT_MINUTES}min). Stopping task execution.")
            break

        t0 = time.time()
        _log(f"  [{i+1}/{len(ordered_tasks)}] Task {task.id}: {task.title}")

        # Check dependencies are satisfied
        completed = get_completed_task_ids(client, session_id)
        unmet_deps = [d for d in task.depends_on if d not in completed]
        if unmet_deps:
            _log(f"    Skipping — unmet dependencies: {unmet_deps}")
            total_failures += 1
            if total_failures >= MAX_TASK_FAILURES:
                _log(f"  ⚠️  Too many failures ({total_failures}). Stopping.")
                break
            continue

        # Execute task
        success = run_execute_task(
            client, config, session_id, task, branch_name, feature_name, prompts_dir,
        )

        if success:
            # Quality gate
            test_files = [f for f in task.files_to_create if "test" in f.lower()]
            verification = run_verify_task(client, session_id, task.repo, test_files or None)
            if verification.passed:
                _log(f"    ✓ Task complete + verified. [{int(time.time()-t0)}s]")
            else:
                _log(f"    ⚠️  Task committed but verification has issues: {verification.errors[:2]}")
                # Ask agent to fix verification issues
                if not verification.typecheck_passed:
                    fix_msg = (
                        f"Typecheck is failing after task {task.id}. Errors:\n"
                        + "\n".join(verification.errors)
                        + f"\nFix ONLY the typecheck errors you caused. Commit: git add -A && "
                        f'git commit -m "fix: resolve typecheck errors from {task.id}"'
                    )
                    client.invoke(session_id=session_id, message=fix_msg)
                    _log(f"    → Fix applied. [{int(time.time()-t0)}s]")
        else:
            total_failures += 1
            _log(f"    ✗ Task failed after retries. [{int(time.time()-t0)}s]")
            if total_failures >= MAX_TASK_FAILURES:
                _log(f"  ⚠️  Too many failures ({total_failures}). Stopping.")
                break

    _log()

    # Phase 4: Agentic Testing
    t0 = time.time()
    _log("--- Phase 4: Agentic Test ---")
    test_result = run_agentic_test_with_retry(
        client, config, session_id, feature_name, prompts_dir,
    )
    test_summary = _format_test_result(test_result)
    if test_result.passed:
        _log(f"Agentic test PASSED. [{int(time.time()-t0)}s | total {elapsed()}]")
    else:
        _log(f"Agentic test FAILED: {test_result.errors}")
        _log(f"Proceeding to review anyway. [{int(time.time()-t0)}s | total {elapsed()}]")
    _log()

    # Phase 5: Multi-Agent Review
    t0 = time.time()
    _log("--- Phase 5: Review ---")
    review_results = run_feature_review(
        client, config, branch_name, feature_name,
        effective_repos, prompts_dir,
    )
    aggregate = run_aggregate(review_results)
    _log(
        f"Review: approved={aggregate.all_approved}, "
        f"findings={len(aggregate.unique_findings)} "
        f"[{int(time.time()-t0)}s | total {elapsed()}]"
    )

    # Phase 5.5: Fix review findings if needed
    if not aggregate.all_approved and aggregate.unique_findings:
        medium_plus = [
            f for f in aggregate.unique_findings
            if f.severity in ("critical", "high", "medium")
        ]
        if medium_plus:
            _log(f"  Fixing {len(medium_plus)} findings...")
            run_fix(client, config, session_id, medium_plus, branch_name, 1)
            _log("  Fixes applied.")
    _log()

    # Phase 6: Complete — push and create PR
    t0 = time.time()
    _log("--- Phase 6: Complete ---")
    review_summary = (
        f"Reviewers: {len(review_results)}, "
        f"Approved: {aggregate.all_approved}, "
        f"Findings: {len(aggregate.unique_findings)}"
    )

    set_status(client, session_id, "COMPLETE")

    result = run_complete(
        client, config, session_id, branch_name, feature_name,
        effective_repos, review_summary, test_summary,
    )

    if result.pr_urls:
        _log(f"\n=== Feature Builder Pipeline Complete [{elapsed()}] ===")
        for url in result.pr_urls:
            _log(f"PR: {url}")

        # Phase 7: Babysit PR — wait for CI and reviewer feedback
        _log(f"\n--- Phase 7: Babysit PR ---")
        for url in result.pr_urls:
            run_babysit(client, config, session_id, url, branch_name)
    else:
        _log(f"\n=== Feature Builder Pipeline Failed [{elapsed()}] ===")
        _log(f"Errors: {result.errors}")

    return 0 if result.pr_urls else 1


def _run_setup(
    client: HarnessClient,
    config: PipelineConfig,
    session_id: str,
    feature_name: str,
    branch_name: str,
    repos: list[str],
    prompts_dir: Path,
) -> None:
    repo_map = {
        "agentcore-cli": config.cli_repo,
        "agentcore-l3-cdk-constructs": config.cdk_repo,
        "private-agentcore-cli-staging": "aws/private-agentcore-cli-staging",
        "bedrock-agentcore-sdk-python": "aws/bedrock-agentcore-sdk-python",
        "bedrock-agentcore-sdk-typescript": "aws/bedrock-agentcore-sdk-typescript",
    }

    effective_repos = repos if repos else [config.cli_repo]
    resolved_repos = [repo_map.get(r, f"aws/{r}" if "/" not in r else r) for r in effective_repos]

    # Use agent-based setup — deterministic run_command doesn't persist PATH/env
    # across invocations. The agent handles this properly via its shell.
    repo_clone_lines = []
    for repo_full in resolved_repos:
        repo_name = repo_full.split("/")[-1]
        repo_clone_lines.append(f"- git clone https://github.com/{repo_full}.git {repo_name}")
        repo_clone_lines.append(f"- cd {repo_name} && npm install 2>&1 | tail -3 && git checkout -b {branch_name} && cd ..")

    setup_prompt = f"""You are setting up a development environment to build a new feature.

Feature: {feature_name}
Branch: {branch_name}

Steps:
1. Install tools and configure node 20 as default:
   dnf install -y -q git nodejs20 > /dev/null 2>&1
   ln -sf /usr/bin/node-20 /usr/local/bin/node
   ln -sf /usr/lib/nodejs20/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
   export PATH=/usr/local/bin:$PATH
2. Authenticate GitHub: echo $GH_TOKEN | gh auth login --with-token
3. Configure git to use gh for auth: gh auth setup-git
4. Clone repos:
{chr(10).join(repo_clone_lines)}
5. Report back confirmation that the environment is ready.

IMPORTANT: Run each step as a separate shell command. Do not combine them. If tools are already installed, skip step 1.

Output: Confirm environment is ready and which repos are cloned."""

    client.invoke(session_id=session_id, message=setup_prompt)


def _format_test_result(result: AgenticTestResult) -> str:
    lines = [
        f"- Build: {'PASS' if result.build_passed else 'FAIL'}",
        f"- Pack: {'PASS' if result.pack_passed else 'FAIL'}",
        f"- Install: {'PASS' if result.install_passed else 'FAIL'}",
        f"- Version check: {'PASS' if result.version_check_passed else 'FAIL'}",
        f"- Feature test: {'PASS' if result.feature_test_passed else 'FAIL'}",
        f"- Overall: {'PASS' if result.passed else 'FAIL'}",
    ]

    if result.tester_results:
        lines.append("\nParallel Testers:")
        for tr in result.tester_results:
            status = "PASS" if tr.passed else "FAIL"
            lines.append(f"  - {tr.focus}: {status} ({tr.tests_run} tests, {len(tr.bugs_found)} bugs)")
            for bug in tr.bugs_found:
                lines.append(f"      Bug: {bug[:150]}")

    if result.errors:
        lines.append(f"\nErrors:\n" + "\n".join(f"  - {e[:200]}" for e in result.errors))

    return "\n".join(lines)
