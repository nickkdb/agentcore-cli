import time

from core.harness_client import HarnessClient
from core.config import PipelineConfig


POLL_INTERVAL_SECONDS = 60
MAX_WAIT_MINUTES = 60
AUTOMATION_USER = "agentcore-cli-automation"


def run_babysit(
    client: HarnessClient,
    config: PipelineConfig,
    session_id: str,
    pr_url: str,
    branch_name: str,
) -> None:
    pr_number = pr_url.rstrip("/").split("/")[-1]
    repo = "/".join(pr_url.split("/")[3:5])
    repo_name = repo.split("/")[-1]
    seen_review_ids: set[str] = set()
    seen_ci_failures: set[str] = set()
    start_time = time.time()

    print(f"  Babysitting PR #{pr_number} — watching for reviews and CI status...", flush=True)

    while True:
        elapsed_minutes = (time.time() - start_time) / 60
        if elapsed_minutes > MAX_WAIT_MINUTES:
            print(f"  Babysit timeout ({MAX_WAIT_MINUTES}min). Stopping.", flush=True)
            return

        time.sleep(POLL_INTERVAL_SECONDS)

        # 1. Check CI status
        ci_status = _check_ci(client, session_id, repo_name, pr_number)
        if ci_status == "failing":
            failure_key = f"ci-{int(elapsed_minutes)}"
            if failure_key not in seen_ci_failures:
                seen_ci_failures.add(failure_key)
                print(f"  CI failing. Getting failure logs and fixing...", flush=True)
                _fix_ci(client, session_id, repo_name, pr_number, branch_name)

        # 2. Check for PR reviews from automation user
        stdout, _, exit_code = client.run_command(
            session_id,
            f'cd {repo_name} && gh pr view {pr_number} --json reviews --jq \'.reviews[] | select(.author.login=="{AUTOMATION_USER}") | "\\(.id)|\\(.state)|\\(.body)"\' 2>/dev/null'
        )

        if exit_code != 0 or not stdout.strip():
            continue

        for line in stdout.strip().split("\n"):
            if "|" not in line:
                continue
            parts = line.split("|", 2)
            if len(parts) < 3:
                continue
            review_id, state, body = parts[0], parts[1], parts[2]

            if review_id in seen_review_ids:
                continue
            seen_review_ids.add(review_id)

            print(f"  New review from {AUTOMATION_USER}: state={state}", flush=True)

            if state == "APPROVED":
                print(f"  PR approved by {AUTOMATION_USER}. Done babysitting.", flush=True)
                return

            if state == "CHANGES_REQUESTED":
                print(f"  Changes requested. Fixing...", flush=True)
                fix_prompt = (
                    f"The automated reviewer submitted a review requesting changes on your PR:\n\n"
                    f"{body}\n\n"
                    f"Address ALL the requested changes. Make the fixes, run typecheck with "
                    f"`npm run typecheck 2>&1 | tail -20`, commit, and push.\n"
                    f"Commit message: fix: address reviewer feedback\n"
                    f"Push: git push origin {branch_name}"
                )
                client.invoke(session_id=session_id, message=fix_prompt)
                client.run_command(session_id, f"cd {repo_name} && git push origin {branch_name}")
                print(f"  Fix pushed. Re-triggering reviewer...", flush=True)
                # Re-trigger the reviewer workflow so it reviews the updated PR
                client.run_command(
                    session_id,
                    f'cd {repo_name} && gh workflow run "AgentCore Harness Reviewing" -f pr_url={pr_url}'
                )
                print(f"  Reviewer re-triggered. Waiting for next review...", flush=True)

            if state == "COMMENTED":
                print(f"  Review comment (non-blocking). Continuing to wait.", flush=True)


def _check_ci(client: HarnessClient, session_id: str, repo_name: str, pr_number: str) -> str:
    """Check CI status: 'passing', 'failing', 'pending', or 'unknown'."""
    stdout, _, exit_code = client.run_command(
        session_id,
        f'cd {repo_name} && gh pr checks {pr_number} 2>/dev/null'
    )
    if exit_code != 0 or not stdout.strip():
        return "unknown"

    if "\tfail\t" in stdout:
        return "failing"
    if "\tpending\t" in stdout:
        return "pending"
    if "\tpass\t" in stdout and "\tfail\t" not in stdout:
        return "passing"
    return "unknown"


def _fix_ci(client: HarnessClient, session_id: str, repo_name: str, pr_number: str, branch_name: str) -> None:
    """Get CI failure logs and ask agent to fix."""
    # Get the failing checks
    stdout, _, _ = client.run_command(
        session_id,
        f'cd {repo_name} && gh pr checks {pr_number} 2>&1 | grep "fail"'
    )

    # Get more detail on the failure
    log_output, _, _ = client.run_command(
        session_id,
        f'cd {repo_name} && gh run list --branch {branch_name} --status failure --limit 1 --json databaseId --jq ".[0].databaseId" 2>/dev/null'
    )
    run_id = log_output.strip()

    failure_details = ""
    if run_id:
        details, _, _ = client.run_command(
            session_id,
            f'cd {repo_name} && gh run view {run_id} --log-failed 2>/dev/null | tail -50'
        )
        failure_details = details

    fix_prompt = (
        f"CI is failing on this PR. Here are the failing checks:\n\n"
        f"{stdout}\n\n"
        f"Failure details:\n{failure_details}\n\n"
        f"Fix the CI failures. Run typecheck, fix issues, commit and push.\n"
        f"Commit message: fix: resolve CI failures\n"
        f"Push: git push origin {branch_name}"
    )
    client.invoke(session_id=session_id, message=fix_prompt)
    client.run_command(session_id, f"cd {repo_name} && git push origin {branch_name}")
    print(f"  CI fix pushed. Waiting for CI to re-run...", flush=True)
