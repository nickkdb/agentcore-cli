"""Phase: Decompose — breaks contracts into an ordered task graph via LLM."""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from core.harness_client import HarnessClient, MaxTokensExceededError
from core.config import PipelineConfig


@dataclass
class Task:
    id: str
    title: str
    description: str
    files_to_create: list[str] = field(default_factory=list)
    files_to_modify: list[str] = field(default_factory=list)
    acceptance_criteria: list[str] = field(default_factory=list)
    depends_on: list[str] = field(default_factory=list)
    size: str = "M"
    verification: list[str] = field(default_factory=list)
    repo: str = "agentcore-cli"


@dataclass
class TaskGraph:
    feature_name: str
    tasks: list[Task]
    repos: list[str]


def run_decompose(
    client: HarnessClient,
    config: PipelineConfig,
    session_id: str,
    devex_content: str,
    impl_content: str,
    feature_name: str,
    repos: list[str],
    prompts_dir: Path,
) -> TaskGraph:
    prompt_template = (prompts_dir / "decompose.md").read_text()
    prompt = prompt_template.format(
        devex_content="(uploaded to /tmp/devex.md — read it from disk)",
        impl_content="(uploaded to /tmp/impl.md — read it from disk)",
        feature_name=feature_name,
        repos=", ".join(repos),
    )

    output = client.invoke(session_id=session_id, message=prompt)

    # Agent writes task graph to /tmp/tasks.json
    stdout, _, exit_code = client.run_command(session_id, "cat /tmp/tasks.json 2>/dev/null")
    if exit_code == 0 and stdout.strip():
        raw_json = stdout.strip()
    else:
        raw_json = _extract_json_from_output(output)

    if not raw_json:
        raise RuntimeError("Decompose phase failed to produce tasks.json")

    return _parse_task_graph(raw_json, feature_name, repos)


def _parse_tasks_from_markdown(impl_content: str, repos: list[str]) -> list[Task]:
    """Parse structured task tables directly from implementation plan markdown.

    Handles tables with columns: #, Task, File(s), Depends On, Size, Verification
    """
    tasks: list[Task] = []
    default_repo = repos[0] if repos else "agentcore-cli"

    lines = impl_content.split("\n")
    current_phase = ""

    for i, line in enumerate(lines):
        # Detect phase headers
        phase_match = re.match(r"^#+\s*Phase\s+(\d+)", line)
        if phase_match:
            current_phase = phase_match.group(1)
            continue

        # Parse task table rows: | 1.1 | Task description | file.ts | — | S | verification |
        table_match = re.match(
            r"\|\s*(\d+\.\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(\w+)\s*\|\s*(.+?)\s*\|",
            line,
        )
        if not table_match:
            continue

        task_id = table_match.group(1).strip()
        title = table_match.group(2).strip()
        files_raw = table_match.group(3).strip()
        depends_raw = table_match.group(4).strip()
        size = table_match.group(5).strip()
        verification_raw = table_match.group(6).strip()

        # Skip header rows
        if task_id == "#" or title == "Task" or "---" in task_id:
            continue

        # Parse files
        files_to_create: list[str] = []
        files_to_modify: list[str] = []
        for f in re.split(r"[,;]|\s*`\s*", files_raw):
            f = f.strip().strip("`").strip()
            if not f or f == "—" or f == "-":
                continue
            if "test" in f.lower() or "__tests__" in f:
                files_to_create.append(f)
            elif any(f.endswith(ext) for ext in [".ts", ".tsx", ".js", ".json"]):
                files_to_modify.append(f)

        # Parse depends_on
        depends_on: list[str] = []
        if depends_raw and depends_raw not in ("—", "-", ""):
            depends_on = [d.strip() for d in re.findall(r"(\d+\.\d+)", depends_raw)]

        # Parse verification
        verification: list[str] = []
        if verification_raw and verification_raw not in ("—", "-"):
            verification = [v.strip() for v in verification_raw.split(",") if v.strip()]

        tasks.append(Task(
            id=task_id,
            title=title,
            description=title,
            files_to_create=files_to_create,
            files_to_modify=files_to_modify,
            acceptance_criteria=verification or ["npm run typecheck passes"],
            depends_on=depends_on,
            size=size if size in ("S", "M", "L", "XL") else "M",
            verification=verification or ["npm run typecheck"],
            repo=default_repo,
        ))

    return tasks


def _extract_json_from_output(output: str) -> str:
    match = re.search(r"```json?\s*\n(.*?)\n\s*```", output, re.DOTALL)
    if match:
        return match.group(1).strip()

    start = output.find("{")
    if start == -1:
        return ""

    depth = 0
    for i in range(start, len(output)):
        if output[i] == "{":
            depth += 1
        elif output[i] == "}":
            depth -= 1
            if depth == 0:
                return output[start:i + 1]
    return ""


def _parse_task_graph(raw_json: str, feature_name: str, repos: list[str]) -> TaskGraph:
    data = json.loads(raw_json)

    tasks_data = data.get("tasks", data.get("phases", []))

    # Handle flat task list
    if tasks_data and isinstance(tasks_data[0], dict) and "task_id" in tasks_data[0]:
        tasks = [_parse_task(t) for t in tasks_data]
    # Handle phase-grouped tasks
    elif tasks_data and isinstance(tasks_data[0], dict) and "tasks" in tasks_data[0]:
        tasks = []
        for phase in tasks_data:
            for t in phase.get("tasks", []):
                tasks.append(_parse_task(t))
    else:
        tasks = [_parse_task(t) for t in tasks_data]

    return TaskGraph(feature_name=feature_name, tasks=tasks, repos=repos)


def _parse_task(data: dict) -> Task:
    task_id = data.get("task_id", data.get("id", "T0"))
    return Task(
        id=task_id,
        title=data.get("title", ""),
        description=data.get("description", ""),
        files_to_create=data.get("files_to_create", data.get("files", {}).get("create", [])),
        files_to_modify=data.get("files_to_modify", data.get("files", {}).get("modify", [])),
        acceptance_criteria=data.get("acceptance_criteria", data.get("verification", [])),
        depends_on=data.get("depends_on", []),
        size=data.get("size", "M"),
        verification=data.get("verification", []),
        repo=data.get("repo", "agentcore-cli"),
    )


def get_execution_order(tasks: list[Task]) -> list[Task]:
    """Topological sort tasks by dependency, with cross-repo ordering (CDK before CLI)."""
    task_map = {t.id: t for t in tasks}
    visited: set[str] = set()
    order: list[Task] = []

    def visit(task_id: str) -> None:
        if task_id in visited:
            return
        visited.add(task_id)
        task = task_map.get(task_id)
        if not task:
            return
        for dep in task.depends_on:
            visit(dep)
        order.append(task)

    # Process CDK tasks first
    cdk_tasks = [t for t in tasks if "cdk" in t.repo.lower()]
    cli_tasks = [t for t in tasks if "cdk" not in t.repo.lower()]

    for t in cdk_tasks:
        visit(t.id)
    for t in cli_tasks:
        visit(t.id)

    return order
