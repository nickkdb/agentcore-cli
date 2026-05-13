"""Feature Builder Agent — builds features from DevEx doc + Implementation Plan contracts.

Usage:
    # From a GitHub issue (issue body contains the contracts):
    uv run python -m feature_builder.main --issue https://github.com/aws/private-agentcore-cli-staging/issues/176

    # From local files:
    uv run python -m feature_builder.main --devex docs/devex.md --impl docs/impl.md --name my-feature

    # With repo override:
    uv run python -m feature_builder.main --issue <url> --repos cli,cdk
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from orchestrations.build_from_docs.orchestrator import run_feature_pipeline

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"

REPO_ALIASES = {
    "cli": "agentcore-cli",
    "private-cli": "private-agentcore-cli-staging",
    "private-agentcore-cli-staging": "private-agentcore-cli-staging",
    "cdk": "agentcore-l3-cdk-constructs",
    "python-sdk": "bedrock-agentcore-sdk-python",
    "ts-sdk": "bedrock-agentcore-sdk-typescript",
}


def main():
    parser = argparse.ArgumentParser(description="Feature Builder Agent")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--issue", help="GitHub issue URL containing the contracts")
    group.add_argument("--devex", help="Path to DevEx doc (markdown)")
    parser.add_argument("--impl", help="Path to implementation plan (markdown)")
    parser.add_argument("--name", help="Feature name (used for branch naming)")
    parser.add_argument("--repos", help="Comma-separated repos to implement on: cli,cdk,python-sdk,ts-sdk")
    parser.add_argument("--target-repo", help="Override target repo for implementation + PR (e.g. 'cli' to implement on public repo while reading issue from private)")
    parser.add_argument("--config", default="config.yaml", help="Config YAML path")
    parser.add_argument("--aws-profile", help="Override AWS profile")
    parser.add_argument("--harness-arn", help="Override harness ARN")
    args = parser.parse_args()

    repos = None
    if args.target_repo:
        repos = [REPO_ALIASES.get(args.target_repo.strip(), args.target_repo.strip())]
    elif args.repos:
        repos = [REPO_ALIASES.get(r.strip(), r.strip()) for r in args.repos.split(",")]

    if args.issue:
        return _run_from_issue(args.issue, args.name, repos, args.config)
    else:
        return _run_from_files(args.devex, args.impl, args.name, repos, args.config)


def _run_from_issue(issue_url: str, name: str | None, repos: list[str] | None, config_path: str) -> int:
    print(f"Fetching issue: {issue_url}", flush=True)

    result = subprocess.run(
        ["gh", "issue", "view", issue_url, "--json", "title,body"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"Error: failed to fetch issue: {result.stderr}", file=sys.stderr)
        return 1

    issue_data = json.loads(result.stdout)
    title = issue_data["title"]
    body = issue_data["body"]

    # Extract feature name from title or --name flag
    feature_name = name or _extract_feature_name(title)
    print(f"Feature: {feature_name}", flush=True)

    # The issue body IS the implementation plan. Write it to a temp file.
    impl_file = tempfile.NamedTemporaryFile(mode="w", suffix=".md", prefix="impl-", delete=False)
    impl_file.write(body)
    impl_file.close()

    # The devex doc might be linked in the body, or the body itself serves as both.
    devex_content = _extract_devex_from_body(body)
    devex_file = tempfile.NamedTemporaryFile(mode="w", suffix=".md", prefix="devex-", delete=False)
    devex_file.write(devex_content)
    devex_file.close()

    print(f"Impl plan: {len(body)} chars", flush=True)
    print(f"DevEx content: {len(devex_content)} chars", flush=True)

    # Log to file for dashboard tracking
    log_path = f"/tmp/feature-{feature_name}.log"
    log_file = open(log_path, "w")
    print(f"Log: {log_path}", flush=True)

    # Write state for dashboard
    _write_state(feature_name, issue_url, "running")

    exit_code = run_feature_pipeline(
        devex_path=devex_file.name,
        impl_path=impl_file.name,
        feature_name=feature_name,
        config_path=config_path,
        prompts_dir=PROMPTS_DIR,
        repos=repos,
        output=log_file,
    )

    _write_state(feature_name, issue_url, "success" if exit_code == 0 else "failed")
    log_file.close()
    return exit_code


def _write_state(feature_name: str, issue_url: str, status: str) -> None:
    state_path = Path("/tmp/feature-state.json")
    state: dict = {}
    if state_path.exists():
        try:
            state = json.loads(state_path.read_text())
        except json.JSONDecodeError:
            pass
    state[feature_name] = {
        "feature": feature_name,
        "issue": issue_url,
        "status": status,
        "log_file": f"/tmp/feature-{feature_name}.log",
        "type": "feature",
    }
    state_path.write_text(json.dumps(state, indent=2))


def _run_from_files(devex_path: str, impl_path: str | None, name: str | None, repos: list[str] | None, config_path: str) -> int:
    if not impl_path:
        print("Error: --impl required when using --devex", file=sys.stderr)
        return 1

    devex = Path(devex_path)
    impl = Path(impl_path)

    if not devex.exists():
        print(f"Error: devex doc not found: {devex}", file=sys.stderr)
        return 1
    if not impl.exists():
        print(f"Error: impl doc not found: {impl}", file=sys.stderr)
        return 1

    feature_name = name or devex.stem.replace(" ", "-").lower()

    return run_feature_pipeline(
        devex_path=str(devex),
        impl_path=str(impl),
        feature_name=feature_name,
        config_path=config_path,
        prompts_dir=PROMPTS_DIR,
        repos=repos,
    )


def _extract_feature_name(title: str) -> str:
    # "feat(deploy): Multi-Environment Deploy — Implementation Plan" → "multi-env-deploy"
    # Strip common prefixes
    cleaned = re.sub(r"^feat\([^)]*\):\s*", "", title, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*[—–-]\s*(Implementation Plan|DevEx|Design).*$", "", cleaned, flags=re.IGNORECASE)
    # Convert to slug
    slug = cleaned.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    # Shorten if too long
    if len(slug) > 40:
        slug = slug[:40].rstrip("-")
    return slug or "unnamed-feature"


def _extract_devex_from_body(body: str) -> str:
    """Extract the DevEx doc content from the issue body.

    The issue body might contain both the devex doc and impl plan,
    or just the impl plan with a reference to the devex doc.
    For now, we treat the Summary + phases description as the devex content
    (what the user experience should be) and the full body as the impl plan
    (technical approach).
    """
    # Look for a "DevEx" or "Summary" section that describes user experience
    lines = body.split("\n")
    devex_sections = []
    in_summary = False

    for line in lines:
        if re.match(r"^#+\s*(Summary|DevEx|User Experience|Overview)", line, re.IGNORECASE):
            in_summary = True
            devex_sections.append(line)
        elif in_summary:
            if re.match(r"^#+\s*(Phase|Task|Prerequisites|Risk|Testing|PR Strategy)", line, re.IGNORECASE):
                in_summary = False
            else:
                devex_sections.append(line)

    if devex_sections:
        return "\n".join(devex_sections)

    # Fallback: use the full body as both devex and impl
    return body


if __name__ == "__main__":
    sys.exit(main())
