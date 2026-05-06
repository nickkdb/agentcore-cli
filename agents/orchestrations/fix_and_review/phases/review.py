from concurrent.futures import ThreadPoolExecutor, as_completed

from core.config import PipelineConfig
from core.harness_client import HarnessClient
from core.parsing import ReviewResult, parse_reviewer_output
from orchestrations.fix_and_review.partitioning import ReviewerAssignment
from orchestrations.fix_and_review.phases.setup import load_prompt


def _run_single_reviewer(
    client: HarnessClient,
    config: PipelineConfig,
    assignment: ReviewerAssignment,
    branch_name: str,
    issue_summary: str,
    previous_findings_context: str,
) -> tuple[ReviewResult | None, str]:
    session_id = HarnessClient.new_session_id()
    prompt = load_prompt(
        "reviewer.md",
        issue_summary=issue_summary,
        branch_name=branch_name,
        cli_repo=config.cli_repo,
        cdk_repo=config.cdk_repo,
        focus=assignment.focus,
        assigned_files=", ".join(assignment.files),
        previous_findings_context=previous_findings_context,
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


def run_review(
    client: HarnessClient,
    config: PipelineConfig,
    assignments: list[ReviewerAssignment],
    branch_name: str,
    issue_summary: str,
    previous_findings_context: str = "",
) -> list[tuple[ReviewResult | None, str]]:
    print(f"  Spawning {len(assignments)} reviewers in parallel...", flush=True)

    with ThreadPoolExecutor(max_workers=len(assignments)) as executor:
        futures = [
            executor.submit(
                _run_single_reviewer,
                client, config, assignment, branch_name,
                issue_summary, previous_findings_context,
            )
            for assignment in assignments
        ]
        results: list[tuple[ReviewResult | None, str]] = []
        for future in as_completed(futures):
            results.append(future.result())

    return results
