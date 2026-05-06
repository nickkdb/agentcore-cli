from collections import defaultdict
from pathlib import Path

from core.config import PipelineConfig
from core.harness_client import HarnessClient


_prompts_dir: Path | None = None


def set_prompts_dir(path: Path) -> None:
    global _prompts_dir
    _prompts_dir = path


def load_prompt(name: str, **kwargs: str) -> str:
    if _prompts_dir is None:
        raise RuntimeError("Prompts directory not set. Call set_prompts_dir() before running phases.")
    template = (_prompts_dir / name).read_text()
    return template.format_map(defaultdict(str, **kwargs))


def run_setup(
    client: HarnessClient,
    config: PipelineConfig,
    session_id: str,
    issue_url: str,
    feature_name: str | None = None,
    branch_name: str | None = None,
) -> str:
    issue_number = issue_url.rstrip("/").split("/")[-1]
    prompt = load_prompt(
        "setup.md",
        cli_repo=config.cli_repo,
        cdk_repo=config.cdk_repo,
        cli_repo_name=config.cli_repo.split("/")[-1],
        cdk_repo_name=config.cdk_repo.split("/")[-1],
        issue_url=issue_url,
        issue_number=issue_number,
        feature_name=feature_name or issue_number,
        branch_name=branch_name or f"fix/{issue_number}",
    )
    return client.invoke(session_id=session_id, message=prompt)
