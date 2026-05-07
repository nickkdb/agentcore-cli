"""Batch Bug Fixer — runs multiple issues in parallel.

Usage:
    uv run python -m bug_fixer.batch --issues url1 url2 url3
    uv run python -m bug_fixer.batch --issues-file issues.txt
    uv run python -m bug_fixer.batch --label bug --repo aws/agentcore-cli --max 5

This is a temporary batch runner. The architecture for parallel orchestration
may change — this file is designed to be easy to remove/replace.
"""

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from orchestrations.fix_and_review.orchestrator import run_pipeline
from orchestrations.fix_and_review.phases.setup import set_prompts_dir

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
MAX_PARALLEL = 5


def fetch_issues_by_label(repo: str, label: str, max_count: int) -> list[str]:
    import subprocess
    result = subprocess.run(
        ["gh", "issue", "list", "--repo", repo, "--label", label,
         "--state", "open", "--limit", str(max_count), "--json", "url", "--jq", ".[].url"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"Error fetching issues: {result.stderr}", file=sys.stderr)
        return []
    return [url.strip() for url in result.stdout.strip().split("\n") if url.strip()]


def run_single_issue(issue_url: str, config_path: str) -> dict:
    import io
    import contextlib
    import json as json_mod
    import os

    issue_number = issue_url.rstrip("/").split("/")[-1]
    log_path = Path(f"/tmp/batch-issue-{issue_number}.log")
    start = time.time()

    # Mark as running immediately so dashboard can see it
    _update_state(issue_number, {
        "issue": issue_url,
        "number": issue_number,
        "status": "running",
        "duration": 0,
        "log_file": str(log_path),
    })

    try:
        # Each issue gets its own log file handle passed to the harness client
        with open(log_path, "w", buffering=1) as log_file:
            set_prompts_dir(PROMPTS_DIR)
            exit_code = run_pipeline(
                issue_url=issue_url,
                config_path=config_path,
                prompts_dir=PROMPTS_DIR,
                output=log_file,
            )
        result = {
            "issue": issue_url,
            "number": issue_number,
            "status": "success" if exit_code == 0 else "failed",
            "duration": int(time.time() - start),
            "log_file": str(log_path),
        }
    except Exception as e:
        result = {
            "issue": issue_url,
            "number": issue_number,
            "status": "error",
            "error": str(e),
            "duration": int(time.time() - start),
            "log_file": str(log_path),
        }

    # Write final state
    _update_state(issue_number, result)
    return result


def _update_state(issue_number: str, result: dict) -> None:
    import json as json_mod
    import fcntl

    state_path = Path("/tmp/batch-state.json")
    try:
        with open(state_path, "r+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            state = json_mod.load(f)
            state[issue_number] = result
            f.seek(0)
            f.truncate()
            json_mod.dump(state, f, indent=2)
            fcntl.flock(f, fcntl.LOCK_UN)
    except (FileNotFoundError, json_mod.JSONDecodeError):
        with open(state_path, "w") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            json_mod.dump({issue_number: result}, f, indent=2)
            fcntl.flock(f, fcntl.LOCK_UN)


def main():
    parser = argparse.ArgumentParser(description="Batch Bug Fixer")
    parser.add_argument("--issues", nargs="+", help="GitHub issue URLs")
    parser.add_argument("--issues-file", help="File with one issue URL per line")
    parser.add_argument("--label", default="bug", help="Label to filter issues by")
    parser.add_argument("--repo", default="aws/agentcore-cli", help="Repo to fetch issues from")
    parser.add_argument("--max", type=int, default=5, help="Max issues to process")
    parser.add_argument("--parallel", type=int, default=MAX_PARALLEL, help="Max parallel workers")
    parser.add_argument("--config", default="config.yaml", help="Config YAML path")
    args = parser.parse_args()

    # Resolve issue list
    if args.issues:
        issues = args.issues
    elif args.issues_file:
        issues = [line.strip() for line in Path(args.issues_file).read_text().split("\n") if line.strip()]
    else:
        print(f"Fetching open issues with label '{args.label}' from {args.repo}...", flush=True)
        issues = fetch_issues_by_label(args.repo, args.label, args.max)

    if not issues:
        print("No issues found.", file=sys.stderr)
        return 1

    issues = issues[:args.max]
    workers = min(args.parallel, len(issues))

    print(f"\n=== Batch Bug Fixer ===")
    print(f"Issues: {len(issues)}")
    print(f"Parallel workers: {workers}")
    print(f"Issues:")
    for url in issues:
        print(f"  - {url}")
    print()

    start = time.time()
    results = []

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(run_single_issue, url, args.config): url
            for url in issues
        }
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            status_icon = "✓" if result["status"] == "success" else "✗"
            print(f"  {status_icon} {result['issue']} — {result['status']} ({result['duration']}s)", flush=True)

    total_time = int(time.time() - start)
    successes = sum(1 for r in results if r["status"] == "success")
    failures = len(results) - successes

    print(f"\n=== Batch Complete [{total_time}s] ===")
    print(f"  {successes}/{len(results)} succeeded, {failures} failed")

    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
