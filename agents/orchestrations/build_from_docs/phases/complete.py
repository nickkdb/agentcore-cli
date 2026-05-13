"""Phase: Complete — creates PR with full audit trail linking back to contracts."""

import re
from dataclasses import dataclass

from core.config import PipelineConfig
from core.harness_client import HarnessClient
from core.progress import read_progress


@dataclass
class CompleteResult:
    pr_urls: list[str]
    errors: list[str]


def run_complete(
    client: HarnessClient,
    config: PipelineConfig,
    session_id: str,
    branch_name: str,
    feature_name: str,
    repos: list[str],
    review_summary: str,
    test_results: str,
) -> CompleteResult:
    errors: list[str] = []
    pr_urls: list[str] = []

    progress_content = read_progress(client, session_id)

    # Determine repos with actual changes
    repos_with_changes: list[str] = []
    for repo in repos:
        repo_name = repo.split("/")[-1] if "/" in repo else repo
        # Check for commits on current branch vs origin/main
        stdout, _, exit_code = client.run_command(
            session_id,
            f"cd {repo_name} && git log origin/main..HEAD --oneline 2>/dev/null",
        )
        if exit_code == 0 and stdout.strip():
            repos_with_changes.append(repo)

    if not repos_with_changes:
        return CompleteResult(pr_urls=[], errors=["No repos have changes on the feature branch"])

    # Push and create PR for each repo (CDK first for dependency ordering)
    repo_order = _order_repos(repos_with_changes, config)

    for repo in repo_order:
        repo_name = repo.split("/")[-1]

        # Rebase onto latest main
        _, stderr, exit_code = client.run_command(
            session_id,
            f"cd {repo_name} && git fetch origin main && git rebase origin/main",
        )
        if exit_code != 0:
            client.run_command(session_id, f"cd {repo_name} && git rebase --abort")
            errors.append(f"Rebase failed in {repo_name}: {stderr[:300]}")
            continue

        # Push
        _, stderr, exit_code = client.run_command(
            session_id,
            f"cd {repo_name} && git push origin {branch_name} --force-with-lease",
        )
        if exit_code != 0:
            errors.append(f"Push failed in {repo_name}: {stderr[:300]}")
            continue

        # Create PR via agent (so it can read and fill the PR template)
        pr_body = _build_pr_body(feature_name, progress_content, review_summary, test_results, pr_urls)
        escaped_body = pr_body.replace("'", "'\\''")
        client.run_command(
            session_id,
            f"cat > /tmp/pr_body.md << 'PR_EOF'\n{escaped_body}\nPR_EOF",
        )

        pr_title = f"feat: {feature_name}"
        stdout, _, exit_code = client.run_command(
            session_id,
            f'cd {repo_name} && gh pr create --title "{pr_title}" --body-file /tmp/pr_body.md --head {branch_name} 2>&1',
        )

        url_match = re.search(r"https://github\.com/[^\s]+/pull/\d+", stdout)
        if url_match:
            pr_urls.append(url_match.group(0))
        else:
            # Try to find existing PR
            stdout, _, _ = client.run_command(
                session_id,
                f"cd {repo_name} && gh pr list --head {branch_name} --json url --jq '.[0].url'",
            )
            if stdout.strip():
                pr_urls.append(stdout.strip())
            else:
                errors.append(f"PR creation may have failed in {repo_name}")

    return CompleteResult(pr_urls=pr_urls, errors=errors)


def _order_repos(repos: list[str], config: PipelineConfig) -> list[str]:
    ordered = []
    # CDK repos first (CLI depends on CDK)
    for repo in repos:
        if "cdk" in repo.lower():
            ordered.append(repo)
    for repo in repos:
        if "cdk" not in repo.lower():
            ordered.append(repo)
    return ordered


def _build_pr_body(
    feature_name: str,
    progress: str,
    review_summary: str,
    test_results: str,
    linked_prs: list[str],
) -> str:
    sections = [
        f"## Summary\n\nAutonomous implementation of feature: **{feature_name}**",
        f"\n\n## Implementation Progress\n\n{progress}",
        f"\n\n## Review Summary\n\n{review_summary}",
        f"\n\n## Agentic Test Results\n\n{test_results}",
    ]

    if linked_prs:
        links = "\n".join(f"- {url}" for url in linked_prs)
        sections.append(f"\n\n## Related PRs\n\n{links}")

    sections.append(
        "\n\n---\n*This PR was created by the autonomous feature builder pipeline.*"
    )

    return "".join(sections)
