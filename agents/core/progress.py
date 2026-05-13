"""Progress file management for task-by-task execution.

The progress file (progress.md) lives on the VM and bridges context between
fresh agent sessions. Each task reads it at start to understand what's been
done, then appends to it after completing work.
"""

import re
from dataclasses import dataclass, field

from core.harness_client import HarnessClient


PROGRESS_PATH = "/tmp/progress.md"


@dataclass
class TaskStatus:
    task_id: str
    title: str
    completed: bool = False
    commit: str = ""
    error: str = ""
    attempts: int = 0


@dataclass
class Progress:
    feature_name: str = ""
    status: str = "IN_PROGRESS"
    tasks: list[TaskStatus] = field(default_factory=list)
    learnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def init_progress(
    client: HarnessClient,
    session_id: str,
    feature_name: str,
    tasks: list[dict],
) -> None:
    lines = [
        f"# Progress — feature/{feature_name}",
        "",
        "## Status: IN_PROGRESS",
        "",
        "## Tasks",
    ]
    for task in tasks:
        lines.append(f"- [ ] {task['id']}: {task['title']}")

    lines.extend(["", "## Learnings", "", "## Errors", ""])

    content = "\n".join(lines)
    escaped = content.replace("'", "'\\''")
    client.run_command(session_id, f"cat > {PROGRESS_PATH} << 'PROGRESS_EOF'\n{escaped}\nPROGRESS_EOF")


def read_progress(client: HarnessClient, session_id: str) -> str:
    stdout, _, exit_code = client.run_command(session_id, f"cat {PROGRESS_PATH} 2>/dev/null")
    if exit_code != 0:
        return ""
    return stdout


def mark_task_complete(
    client: HarnessClient,
    session_id: str,
    task_id: str,
    commit_sha: str = "",
) -> None:
    commit_note = f" (commit: {commit_sha})" if commit_sha else ""
    client.run_command(
        session_id,
        f"sed -i 's/- \\[ \\] {task_id}:/- [x] {task_id}:{commit_note}/' {PROGRESS_PATH}",
    )


def mark_task_failed(
    client: HarnessClient,
    session_id: str,
    task_id: str,
    error: str,
) -> None:
    safe_error = error.replace("'", "").replace("\n", " ")[:200]
    client.run_command(
        session_id,
        f"sed -i 's/- \\[ \\] {task_id}:/- [!] {task_id}: FAILED —/' {PROGRESS_PATH}",
    )
    append_error(client, session_id, f"Task {task_id}: {safe_error}")


def append_learning(client: HarnessClient, session_id: str, learning: str) -> None:
    safe = learning.replace("'", "'\\''").replace("\n", " ")[:300]
    client.run_command(
        session_id,
        f"sed -i '/^## Learnings$/a - {safe}' {PROGRESS_PATH}",
    )


def append_error(client: HarnessClient, session_id: str, error: str) -> None:
    safe = error.replace("'", "'\\''").replace("\n", " ")[:300]
    client.run_command(
        session_id,
        f"sed -i '/^## Errors$/a - {safe}' {PROGRESS_PATH}",
    )


def set_status(client: HarnessClient, session_id: str, status: str) -> None:
    client.run_command(
        session_id,
        f"sed -i 's/^## Status: .*/## Status: {status}/' {PROGRESS_PATH}",
    )


def get_completed_task_ids(client: HarnessClient, session_id: str) -> list[str]:
    stdout = read_progress(client, session_id)
    return re.findall(r"- \[x\] (T\d+|[\d.]+):", stdout)


def get_next_pending_task_id(client: HarnessClient, session_id: str) -> str | None:
    stdout = read_progress(client, session_id)
    match = re.search(r"- \[ \] (T\d+|[\d.]+):", stdout)
    return match.group(1) if match else None
