"""Phase: Verify Task — deterministic quality gates run by orchestrator (not agent)."""

from dataclasses import dataclass, field

from core.harness_client import HarnessClient


@dataclass
class VerificationResult:
    passed: bool
    typecheck_passed: bool = True
    tests_passed: bool = True
    lint_passed: bool = True
    errors: list[str] = field(default_factory=list)


def _find_repo_cmd(repo_name: str) -> str:
    """Generate a shell snippet that finds and cds into the repo."""
    return (
        f"if [ -d ~/{repo_name} ]; then cd ~/{repo_name}; "
        f"elif [ -d /tmp/{repo_name} ]; then cd /tmp/{repo_name}; "
        f"elif [ -d {repo_name} ]; then cd {repo_name}; fi"
    )


def run_verify_task(
    client: HarnessClient,
    session_id: str,
    repo: str,
    test_files: list[str] | None = None,
) -> VerificationResult:
    repo_name = repo.split("/")[-1] if "/" in repo else repo
    cd = _find_repo_cmd(repo_name)
    errors: list[str] = []

    # 1. Typecheck
    stdout, _, exit_code = client.run_command(
        session_id,
        f"{cd} && npm run typecheck 2>&1 | tail -30",
    )
    typecheck_passed = exit_code == 0
    if not typecheck_passed:
        errors.append(f"Typecheck failed:\n{stdout[-500:]}")

    # 2. Targeted tests (if test files specified)
    tests_passed = True
    if test_files:
        test_paths = " ".join(test_files)
        stdout, _, exit_code = client.run_command(
            session_id,
            f"{cd} && npx vitest run --project unit {test_paths} 2>&1 | tail -30",
        )
        tests_passed = exit_code == 0
        if not tests_passed:
            errors.append(f"Tests failed:\n{stdout[-500:]}")

    # 3. Lint (non-blocking — report but don't fail)
    stdout, _, exit_code = client.run_command(
        session_id,
        f"{cd} && npm run lint 2>&1 | tail -10",
    )
    lint_passed = exit_code == 0
    if not lint_passed:
        errors.append(f"Lint warnings:\n{stdout[-300:]}")

    passed = typecheck_passed and tests_passed

    return VerificationResult(
        passed=passed,
        typecheck_passed=typecheck_passed,
        tests_passed=tests_passed,
        lint_passed=lint_passed,
        errors=errors,
    )
