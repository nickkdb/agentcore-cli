import re
from dataclasses import dataclass

from core.config import PipelineConfig
from core.harness_client import HarnessClient


@dataclass
class CompleteResult:
    pr_urls: list[str]
    rebase_succeeded: bool
    errors: list[str]


def run_complete(
    client: HarnessClient,
    config: PipelineConfig,
    session_id: str,
    branch_name: str,
    issue_url: str,
    issue_number: str,
    issue_title: str,
    review_summary: str,
    affected_repos: list[str],
) -> CompleteResult:
    errors: list[str] = []
    pr_urls: list[str] = []

    # Normalize affected_repos to full org/repo format for comparison with config
    full_repo_map = {
        "agentcore-cli": config.cli_repo,
        "agentcore-l3-cdk-constructs": config.cdk_repo,
        config.cli_repo: config.cli_repo,
        config.cdk_repo: config.cdk_repo,
    }

    # Filter to repos that actually have changes on the feature branch
    repos_with_changes: list[str] = []
    for repo in affected_repos:
        repo_name = repo.split("/")[-1] if "/" in repo else repo
        stdout, _, exit_code = client.run_command(
            session_id, f"cd {repo_name} && git log main..{branch_name} --oneline 2>/dev/null"
        )
        if exit_code == 0 and stdout.strip():
            full_repo = full_repo_map.get(repo, repo)
            repos_with_changes.append(full_repo)

    if not repos_with_changes:
        return CompleteResult(pr_urls=[], rebase_succeeded=False, errors=["No repos have changes on the feature branch"])

    # Rebase and push each repo that has changes
    rebase_succeeded = True
    for repo in repos_with_changes:
        repo_name = repo.split("/")[-1] if "/" in repo else repo

        _, stderr, exit_code = client.run_command(
            session_id, f"cd {repo_name} && git fetch origin main && git rebase origin/main"
        )
        if exit_code != 0:
            rebase_succeeded = False
            client.run_command(session_id, f"cd {repo_name} && git rebase --abort")
            errors.append(f"Rebase failed in {repo_name}: {stderr[:500]}")
            continue

        _, stderr, exit_code = client.run_command(
            session_id, f"cd {repo_name} && git push origin {branch_name} --force-with-lease"
        )
        if exit_code != 0:
            errors.append(f"Push failed in {repo_name}: {stderr[:500]}")

    # Create PRs — CDK first if both repos have changes
    repo_order = []
    if config.cdk_repo in repos_with_changes:
        repo_order.append(config.cdk_repo)
    if config.cli_repo in repos_with_changes:
        repo_order.append(config.cli_repo)

    for repo in repo_order:
        repo_name = repo.split("/")[-1]

        # Let the agent create the PR — it can read the repo's PR template and fill it in properly
        pr_message = (
            f"Create a pull request in this repo for branch {branch_name}.\n"
            f"Issue: {issue_url} (#{issue_number})\n"
            f"Issue title: {issue_title}\n"
            f"Review summary: {review_summary}\n"
            f"Read the PR template at .github/pull_request_template.md and fill it in properly.\n"
            f"IMPORTANT: The Related Issue section MUST say 'Closes #{issue_number}' to auto-close the issue when merged.\n"
            f"Use a descriptive title based on the issue title. Do NOT use a generic title like 'fix: resolve #N'.\n"
            f"Use: gh pr create --title '<title>' --body-file /tmp/pr_body.md --head {branch_name}\n"
            f"Write the filled-in template to /tmp/pr_body.md first."
        )
        pr_output = client.invoke(session_id=session_id, message=pr_message)

        # Extract PR URL from the agent's output
        url_match = re.search(r"https://github\.com/[^\s]+/pull/\d+", pr_output)
        if url_match:
            pr_urls.append(url_match.group(0))
        else:
            stdout, _, _ = client.run_command(
                session_id, f"cd {repo_name} && gh pr list --head {branch_name} --json url --jq '.[0].url'"
            )
            if stdout.strip():
                pr_urls.append(stdout.strip())
            else:
                errors.append(f"PR may have been created in {repo} but could not extract URL")

    return CompleteResult(pr_urls=pr_urls, rebase_succeeded=rebase_succeeded, errors=errors)
