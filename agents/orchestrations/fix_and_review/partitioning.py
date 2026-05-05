from collections import defaultdict
from dataclasses import dataclass
from pathlib import PurePosixPath


@dataclass
class DiffStats:
    changed_files: list[str]
    total_lines: int
    cross_repo: bool


@dataclass
class ReviewerAssignment:
    files: list[str]
    focus: str = ""


def calculate_reviewer_count(stats: DiffStats, min_r: int = 3, max_r: int = 5) -> int:
    file_count = len(stats.changed_files)
    lines = stats.total_lines

    if file_count <= 2 and lines < 100:
        base = min_r
    elif file_count <= 7 and lines < 500:
        base = min_r + 1
    else:
        base = max_r

    if stats.cross_repo:
        base += 1

    return min(base, max_r)


def partition_round1_by_directory(
    changed_files: list[str], num_reviewers: int
) -> list[ReviewerAssignment]:
    if not changed_files:
        return [ReviewerAssignment(files=[], focus="No files to review")]

    groups: dict[str, list[str]] = defaultdict(list)
    for f in changed_files:
        parts = PurePosixPath(f).parts
        key = "/".join(parts[:2]) if len(parts) > 1 else parts[0] if parts else "root"
        groups[key].append(f)

    sorted_groups = sorted(groups.items(), key=lambda x: -len(x[1]))

    if len(sorted_groups) >= num_reviewers:
        assignments = [
            ReviewerAssignment(files=files, focus=f"Review changes in {key}/")
            for key, files in sorted_groups[:num_reviewers - 1]
        ]
        remaining_files = []
        for key, files in sorted_groups[num_reviewers - 1:]:
            remaining_files.extend(files)
        assignments.append(
            ReviewerAssignment(files=remaining_files, focus="Review remaining changes")
        )
        return assignments
    else:
        assignments = [
            ReviewerAssignment(files=files, focus=f"Review changes in {key}/")
            for key, files in sorted_groups
        ]
        focus_extras = [
            "Focus on error handling and edge cases",
            "Focus on type safety and interface consistency",
            "Focus on backwards compatibility and breaking changes",
        ]
        largest_group_files = sorted_groups[0][1] if sorted_groups else changed_files
        extra_idx = 0
        while len(assignments) < num_reviewers:
            assignments.append(
                ReviewerAssignment(
                    files=largest_group_files,
                    focus=focus_extras[extra_idx % len(focus_extras)],
                )
            )
            extra_idx += 1
        return assignments


def partition_round2_focus_prompts(num_reviewers: int) -> list[str]:
    prompts = [
        "Focus on correctness — does the logic match the issue requirements? Are there edge cases or off-by-one errors?",
        "Focus on safety — breaking changes, backwards compatibility, error handling, and graceful degradation",
        "Focus on testing — are the tests adequate? Do they cover acceptance criteria, edge cases, and error paths?",
        "Focus on cross-repo consistency — do type definitions, schemas, and interfaces stay in sync across both repos?",
        "Focus on performance and resource usage — are there unnecessary allocations, N+1 patterns, or missing caching?",
    ]
    return prompts[:num_reviewers]


def partition_round3_risk_areas(
    previous_findings_files: list[str],
    all_changed_files: list[str],
    num_reviewers: int,
) -> list[ReviewerAssignment]:
    risk_files = list(set(previous_findings_files))
    non_risk_files = [f for f in all_changed_files if f not in risk_files]

    assignments: list[ReviewerAssignment] = []
    risk_reviewer_count = max(1, num_reviewers // 2)
    for i in range(risk_reviewer_count):
        assignments.append(
            ReviewerAssignment(
                files=risk_files,
                focus=f"Deep review of previously-flagged files — verify fixes are correct and complete (pass {i + 1})",
            )
        )

    remaining = num_reviewers - risk_reviewer_count
    broader_files = risk_files + non_risk_files
    for i in range(remaining):
        assignments.append(
            ReviewerAssignment(
                files=broader_files,
                focus=f"Broad review with emphasis on how fixes interact with surrounding code (pass {i + 1})",
            )
        )

    return assignments
