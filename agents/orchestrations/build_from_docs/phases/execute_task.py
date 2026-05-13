"""Phase: Execute Task — runs one task in a fresh invocation with progress context."""

import re
from pathlib import Path

from core.harness_client import HarnessClient, MaxTokensExceededError
from core.config import PipelineConfig
from core.progress import (
    read_progress,
    mark_task_complete,
    mark_task_failed,
    append_learning,
    append_error,
)
from orchestrations.build_from_docs.phases.decompose import Task


MAX_RETRIES = 3


def run_execute_task(
    client: HarnessClient,
    config: PipelineConfig,
    session_id: str,
    task: Task,
    branch_name: str,
    feature_name: str,
    prompts_dir: Path,
) -> bool:
    prompt_template = (prompts_dir / "execute_task.md").read_text()

    progress_content = read_progress(client, session_id)

    prompt = prompt_template.format(
        task_id=task.id,
        task_title=task.title,
        task_description=task.description,
        files_to_create="\n".join(f"  - {f}" for f in task.files_to_create),
        files_to_modify="\n".join(f"  - {f}" for f in task.files_to_modify),
        acceptance_criteria="\n".join(f"  - {c}" for c in task.acceptance_criteria),
        repo=task.repo,
        branch_name=branch_name,
        feature_name=feature_name,
        progress=progress_content,
    )

    for attempt in range(MAX_RETRIES):
        try:
            output = client.invoke(session_id=session_id, message=prompt)
        except MaxTokensExceededError as e:
            output = e.partial_output

        commit_sha = _extract_commit_sha(client, session_id, task.repo)

        if commit_sha:
            mark_task_complete(client, session_id, task.id, commit_sha)
            if attempt > 0:
                append_learning(
                    client, session_id,
                    f"Task {task.id} succeeded on attempt {attempt + 1}",
                )
            return True

        if attempt < MAX_RETRIES - 1:
            error_context = _get_error_context(client, session_id, task.repo)
            if error_context:
                append_error(client, session_id, f"Task {task.id} attempt {attempt + 1}: {error_context[:200]}")
            prompt = (
                f"Your previous attempt for task {task.id} did not produce a commit. "
                f"Errors:\n{error_context}\n\n"
                f"Fix the issues, then commit and push. "
                f"Original task: {task.title}\n{task.description}"
            )

    mark_task_failed(client, session_id, task.id, "Failed after 3 attempts")
    return False


def _extract_commit_sha(client: HarnessClient, session_id: str, repo: str) -> str:
    repo_name = repo.split("/")[-1] if "/" in repo else repo
    # Try multiple locations where the repo might be
    stdout, _, exit_code = client.run_command(
        session_id,
        f"cd ~/{repo_name} 2>/dev/null && git log -1 --format=%h 2>/dev/null || "
        f"cd /tmp/{repo_name} 2>/dev/null && git log -1 --format=%h 2>/dev/null || "
        f"cd {repo_name} 2>/dev/null && git log -1 --format=%h 2>/dev/null",
    )
    if exit_code == 0 and stdout.strip():
        return stdout.strip().split('\n')[-1]
    return ""


def _get_error_context(client: HarnessClient, session_id: str, repo: str) -> str:
    repo_name = repo.split("/")[-1] if "/" in repo else repo
    stdout, _, _ = client.run_command(
        session_id,
        f"cd ~/{repo_name} 2>/dev/null || cd /tmp/{repo_name} 2>/dev/null || cd {repo_name}; "
        f"npm run typecheck 2>&1 | tail -30",
    )
    return stdout.strip()
