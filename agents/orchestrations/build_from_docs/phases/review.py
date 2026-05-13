"""Phase: Review — parallel multi-agent code review of the full feature diff."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from core.config import PipelineConfig
from core.harness_client import HarnessClient
from core.parsing import ReviewResult, parse_reviewer_output


REVIEW_FOCUSES = [
    "Correctness and logic errors. Does the code do what the spec says?",
    "Breaking changes and backwards compatibility. Will existing users be affected?",
    "Pattern consistency. Does this follow the existing codebase conventions?",
    "Security and input validation. Are there injection risks or missing checks?",
    "Test coverage. Are edge cases handled? Are the tests meaningful?",
]


def run_feature_review(
    client: HarnessClient,
    config: PipelineConfig,
    branch_name: str,
    feature_name: str,
    repos: list[str],
    prompts_dir: Path,
    num_reviewers: int = 5,
) -> list[tuple[ReviewResult | None, str]]:
    prompt_template = (prompts_dir / "reviewer.md").read_text()

    focuses = REVIEW_FOCUSES[:num_reviewers]

    # Resolve the actual repo to clone (may be private repo override)
    repo_map = {
        "agentcore-cli": config.cli_repo,
        "agentcore-l3-cdk-constructs": config.cdk_repo,
        "private-agentcore-cli-staging": "aws/private-agentcore-cli-staging",
    }
    clone_repo = repo_map.get(repos[0], f"aws/{repos[0]}") if repos else config.cli_repo

    def _run_single_reviewer(focus: str) -> tuple[ReviewResult | None, str]:
        session_id = HarnessClient.new_session_id()
        repo_names = [r.split("/")[-1] for r in repos]

        # Setup the reviewer's VM with git/gh and clone the branch
        client.run_command(session_id, (
            "which git > /dev/null 2>&1 || dnf install -y -q git > /dev/null 2>&1; "
            "echo $GH_TOKEN | gh auth login --with-token 2>/dev/null; "
            "gh auth setup-git 2>/dev/null"
        ))
        repo_name = clone_repo.split("/")[-1]
        client.run_command(session_id, (
            f"git clone --depth 50 --branch {branch_name} "
            f"https://github.com/{clone_repo}.git {repo_name} 2>&1 | tail -3"
        ))

        prompt = prompt_template.format(
            feature_name=feature_name,
            branch_name=branch_name,
            repos=", ".join(repo_names),
            focus=focus,
            cli_repo=clone_repo,
            cdk_repo=config.cdk_repo,
        )

        raw_output = client.invoke(session_id=session_id, message=prompt)
        parsed = parse_reviewer_output(raw_output)

        if parsed is None:
            retry_msg = (
                "Your previous output was not valid JSON. Please output ONLY a JSON object "
                "wrapped in ```json fences with this schema: "
                '{"approved": boolean, "findings": [{"severity": "critical"|"high"|"medium"|"low", '
                '"file": "path", "line": number, "description": "...", "suggestion": "..."}]}'
            )
            for _ in range(2):
                raw_output = client.invoke(session_id=session_id, message=retry_msg)
                parsed = parse_reviewer_output(raw_output)
                if parsed is not None:
                    break

        return (parsed, raw_output)

    print(f"  Spawning {len(focuses)} reviewers in parallel...", flush=True)

    with ThreadPoolExecutor(max_workers=len(focuses)) as executor:
        futures = [executor.submit(_run_single_reviewer, focus) for focus in focuses]
        results: list[tuple[ReviewResult | None, str]] = []
        for future in as_completed(futures):
            results.append(future.result())

    return results
