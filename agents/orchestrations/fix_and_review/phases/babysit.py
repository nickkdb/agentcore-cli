import time

from core.harness_client import HarnessClient
from core.config import PipelineConfig


POLL_INTERVAL_SECONDS = 60
MAX_WAIT_MINUTES = 30
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
    start_time = time.time()

    print(f"  Babysitting PR #{pr_number} — waiting for reviews from {AUTOMATION_USER}...", flush=True)

    while True:
        elapsed_minutes = (time.time() - start_time) / 60
        if elapsed_minutes > MAX_WAIT_MINUTES:
            print(f"  Babysit timeout ({MAX_WAIT_MINUTES}min). Stopping.", flush=True)
            return

        time.sleep(POLL_INTERVAL_SECONDS)

        # Check for PR reviews (not comments) from the automation user
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

            # APPROVED — we're done
            if state == "APPROVED":
                print(f"  PR approved by {AUTOMATION_USER}. Done babysitting.", flush=True)
                return

            # CHANGES_REQUESTED — fix and push
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
                print(f"  Fix pushed. Waiting for next review...", flush=True)

            # COMMENTED — non-blocking, keep waiting for a decisive review
            if state == "COMMENTED":
                print(f"  Review comment (non-blocking). Continuing to wait for approval or change request.", flush=True)
