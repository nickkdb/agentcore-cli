from dataclasses import dataclass

from core.harness_client import HarnessClient
from orchestrations.fix_and_review.partitioning import DiffStats


@dataclass
class ExtractResult:
    diff_stat: str
    full_diff: str
    commit_log: str
    stats: DiffStats


def run_extract(
    client: HarnessClient,
    session_id: str,
    cli_repo: str,
    cdk_repo: str,
) -> ExtractResult:
    cli_name = cli_repo.split("/")[-1]
    cdk_name = cdk_repo.split("/")[-1]

    all_diff_stat = ""
    all_full_diff = ""
    all_commit_log = ""
    changed_files: list[str] = []
    total_lines = 0
    has_cli = False
    has_cdk = False

    for repo_name in [cli_name, cdk_name]:
        # Check if this repo has changes on the branch
        commit_log, _, exit_code = client.run_command(
            session_id, f"cd {repo_name} && git log main..HEAD --oneline 2>/dev/null"
        )
        if exit_code != 0 or not commit_log.strip():
            continue

        diff_stat, _, _ = client.run_command(session_id, f"cd {repo_name} && git diff main --stat")
        full_diff, _, _ = client.run_command(session_id, f"cd {repo_name} && git diff main")

        all_diff_stat += diff_stat
        all_full_diff += full_diff
        all_commit_log += commit_log

        for line in diff_stat.strip().split("\n"):
            line = line.strip()
            if "|" in line:
                file_path = line.split("|")[0].strip()
                if file_path:
                    changed_files.append(file_path)
                    if repo_name == cli_name:
                        has_cli = True
                    else:
                        has_cdk = True

        for line in full_diff.split("\n"):
            if line.startswith("+") and not line.startswith("+++"):
                total_lines += 1
            elif line.startswith("-") and not line.startswith("---"):
                total_lines += 1

    cross_repo = has_cli and has_cdk

    stats = DiffStats(
        changed_files=changed_files,
        total_lines=total_lines,
        cross_repo=cross_repo,
    )

    return ExtractResult(
        diff_stat=all_diff_stat,
        full_diff=all_full_diff,
        commit_log=all_commit_log,
        stats=stats,
    )
