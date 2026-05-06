from dataclasses import dataclass

from core.harness_client import HarnessClient

TEST_COMMANDS = {
    "agentcore-cli": "npm run test:unit",
    "agentcore-l3-cdk-constructs": "npm test",
}


@dataclass
class VerificationResult:
    commits_exist: bool
    typecheck_passes: bool
    tests_pass: bool
    branch_pushed: bool
    errors: list[str]

    @property
    def all_passed(self) -> bool:
        return self.commits_exist and self.typecheck_passes and self.tests_pass and self.branch_pushed


def run_verify(
    client: HarnessClient,
    session_id: str,
    branch_name: str,
    affected_repos: list[str],
) -> VerificationResult:
    errors: list[str] = []

    # Check commits exist — cd into first affected repo
    first_repo = affected_repos[0] if affected_repos else "agentcore-cli"
    stdout, _, exit_code = client.run_command(
        session_id, f"cd {first_repo} && git log main..HEAD --oneline"
    )
    commits_exist = exit_code == 0 and len(stdout.strip()) > 0
    if not commits_exist:
        errors.append(f"No commits found on feature branch in {first_repo}")

    # Only typecheck/test repos that were actually changed
    typecheck_passes = True
    for repo in affected_repos:
        stdout, _, exit_code = client.run_command(
            session_id, f"cd {repo} && git diff main --stat 2>/dev/null"
        )
        if not stdout.strip():
            continue
        print(f"  Running typecheck in {repo}...", flush=True)
        _, stderr, exit_code = client.run_command(session_id, f"cd {repo} && npm run typecheck 2>&1 | tail -5")
        if exit_code != 0:
            typecheck_passes = False
            errors.append(f"Typecheck failed in {repo}: {stderr[:500]}")

    tests_pass = True
    for repo in affected_repos:
        stdout, _, exit_code = client.run_command(
            session_id, f"cd {repo} && git diff main --stat 2>/dev/null"
        )
        if not stdout.strip():
            continue
        # Find test files related to changed source files
        print(f"  Running targeted tests in {repo}...", flush=True)
        changed_files_out, _, _ = client.run_command(
            session_id, f"cd {repo} && git diff main --name-only | head -20"
        )
        test_files: list[str] = []
        for changed in changed_files_out.strip().split("\n"):
            changed = changed.strip()
            if not changed:
                continue
            if "__tests__" in changed or ".test." in changed:
                test_files.append(changed)
            else:
                # Look for adjacent test file
                test_candidate = changed.replace("/src/", "/src/").replace(".ts", ".test.ts")
                dir_parts = changed.rsplit("/", 1)
                if len(dir_parts) == 2:
                    test_dir = f"{dir_parts[0]}/__tests__/{dir_parts[1].replace('.ts', '.test.ts')}"
                    test_files.append(test_dir)

        if not test_files:
            continue

        # Run only the targeted tests (max 5)
        test_paths = " ".join(test_files[:5])
        stdout, stderr, exit_code = client.run_command(
            session_id, f'cd {repo} && npx vitest run --project unit {test_paths} > /tmp/test_output.txt 2>&1; echo "EXIT:$?"'
        )
        test_exit = 1
        for line in stdout.strip().split("\n"):
            if line.startswith("EXIT:"):
                test_exit = int(line.split(":")[1])
        if test_exit != 0:
            tests_pass = False
            summary, _, _ = client.run_command(
                session_id, 'tail -20 /tmp/test_output.txt'
            )
            errors.append(f"Tests failed in {repo}: {summary[:500]}")

    # Only push if all local checks passed
    branch_pushed = True
    if not (typecheck_passes and tests_pass):
        branch_pushed = False
    else:
        for repo in affected_repos:
            stdout, _, _ = client.run_command(
                session_id, f"cd {repo} && git diff main --stat 2>/dev/null"
            )
            if not stdout.strip():
                continue
            print(f"  Pushing {branch_name} in {repo}...", flush=True)
            _, stderr, exit_code = client.run_command(
                session_id, f"cd {repo} && git push origin {branch_name}"
            )
            if exit_code != 0:
                branch_pushed = False
                errors.append(f"Push failed in {repo}: {stderr[:500]}")

    return VerificationResult(
        commits_exist=commits_exist,
        typecheck_passes=typecheck_passes,
        tests_pass=tests_pass,
        branch_pushed=branch_pushed,
        errors=errors,
    )
