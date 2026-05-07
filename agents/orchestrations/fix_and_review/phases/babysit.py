import time

from core.harness_client import HarnessClient
from core.config import PipelineConfig
from orchestrations.fix_and_review.phases.setup import load_prompt


POLL_INTERVAL_SECONDS = 60
MAX_WAIT_MINUTES = 30
AUTOMATION_USER = "agentcore-cli-automation"
APPROVAL_KEYWORDS = ["lgtm", "good to go", "approved", "looks good", "ship it"]


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
    seen_comment_ids: set[str] = set()
    start_time = time.time()

    print(f"  Babysitting PR #{pr_number} — waiting for comments from {AUTOMATION_USER}...", flush=True)

    while True:
        elapsed_minutes = (time.time() - start_time) / 60
        if elapsed_minutes > MAX_WAIT_MINUTES:
            print(f"  Babysit timeout ({MAX_WAIT_MINUTES}min). Stopping.", flush=True)
            return

        time.sleep(POLL_INTERVAL_SECONDS)

        # Check for new comments from the automation user
        stdout, _, exit_code = client.run_command(
            session_id,
            f'cd {repo_name} && gh pr view {pr_number} --json comments --jq \'.comments[] | select(.author.login=="{AUTOMATION_USER}") | "\\(.id)|\\(.body)"\' 2>/dev/null'
        )

        if exit_code != 0 or not stdout.strip():
            continue

        for line in stdout.strip().split("\n"):
            if "|" not in line:
                continue
            comment_id, comment_body = line.split("|", 1)
            if comment_id in seen_comment_ids:
                continue
            seen_comment_ids.add(comment_id)

            print(f"  New comment from {AUTOMATION_USER}: {comment_body[:100]}...", flush=True)

            # Check if it's an approval
            if any(keyword in comment_body.lower() for keyword in APPROVAL_KEYWORDS):
                print(f"  PR approved by {AUTOMATION_USER}. Done babysitting.", flush=True)
                return

            # It's a fix request — invoke harness to address it
            print(f"  Fixing requested changes...", flush=True)
            fix_prompt = (
                f"The automated reviewer left this comment on your PR:\n\n"
                f"{comment_body}\n\n"
                f"Address the feedback. Make the changes, run typecheck, commit, and push.\n"
                f"Commit message: fix: address review feedback\n"
                f"Push: git push origin {branch_name}"
            )
            client.invoke(session_id=session_id, message=fix_prompt)

            # Verify push happened
            client.run_command(session_id, f"cd {repo_name} && git push origin {branch_name}")
            print(f"  Fix pushed. Waiting for next review...", flush=True)
