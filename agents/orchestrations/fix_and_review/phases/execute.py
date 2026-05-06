from core.config import PipelineConfig
from core.harness_client import HarnessClient
from orchestrations.fix_and_review.phases.setup import load_prompt


def run_execute(
    client: HarnessClient,
    config: PipelineConfig,
    session_id: str,
    plan: str,
    branch_name: str,
    issue_number: str,
) -> str:
    prompt = load_prompt(
        "executor.md",
        plan=plan,
        commit_message=f"fix issue #{issue_number}",
        branch_name=branch_name,
    )
    return client.invoke(session_id=session_id, message=prompt, max_iterations=40)
