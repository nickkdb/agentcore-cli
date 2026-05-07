import time
from pathlib import Path

from core.config import PipelineConfig
from core.harness_client import HarnessClient, MaxTokensExceededError
from core.parsing import Finding
from orchestrations.fix_and_review.partitioning import (
    ReviewerAssignment,
    calculate_reviewer_count,
    partition_round1_by_directory,
    partition_round2_focus_prompts,
    partition_round3_risk_areas,
)
from orchestrations.fix_and_review.phases.aggregate import run_aggregate
from orchestrations.fix_and_review.phases.babysit import run_babysit
from orchestrations.fix_and_review.phases.complete import run_complete
from orchestrations.fix_and_review.phases.execute import run_execute
from orchestrations.fix_and_review.phases.extract import ExtractResult, run_extract
from orchestrations.fix_and_review.phases.fix import run_fix
from orchestrations.fix_and_review.phases.plan import run_plan
from orchestrations.fix_and_review.phases.review import run_review
from orchestrations.fix_and_review.phases.setup import run_setup, set_prompts_dir
from orchestrations.fix_and_review.phases.validate import run_validate
from orchestrations.fix_and_review.phases.verify import run_verify


def _invoke_with_retry(fn, max_retries=2, phase_name="phase", log=None):
    """Retry a phase function on MaxTokensExceededError."""
    _print = log or (lambda *a, **k: print(*a, **k))
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except MaxTokensExceededError as e:
            if attempt < max_retries:
                _print(f"  ⚠️  {phase_name} hit max_tokens (attempt {attempt + 1}/{max_retries + 1}). Retrying with fresh invocation...")
            else:
                _print(f"  ⚠️  {phase_name} hit max_tokens after {max_retries + 1} attempts. Using partial output.")
                return e.partial_output


def run_pipeline(
    issue_url: str,
    config_path: str = "config.yaml",
    prompts_dir: str | Path | None = None,
    devex_content: str | None = None,
    impl_content: str | None = None,
    feature_name: str | None = None,
    output=None,
    **overrides: str,
) -> int:
    config = PipelineConfig.from_yaml(config_path)
    for key, value in overrides.items():
        if hasattr(config, key):
            field_type = type(getattr(config, key))
            if field_type == int:
                value = int(value)
            setattr(config, key, value)

    if prompts_dir:
        set_prompts_dir(Path(prompts_dir))

    is_feature = devex_content is not None
    if is_feature:
        issue_number = feature_name or "feature"
        branch_name = f"feature/{feature_name or 'unnamed'}"
    else:
        issue_number = issue_url.rstrip("/").split("/")[-1]
        short_id = HarnessClient.new_session_id()[:8].lower()
        branch_name = f"fix/{issue_number}-{short_id}"

    _out = output or __import__("sys").stdout

    def _log(*args, **kwargs):
        kwargs.setdefault("file", _out)
        kwargs.setdefault("flush", True)
        print(*args, **kwargs)

    client = HarnessClient(config, output=_out)
    session_id = HarnessClient.new_session_id()

    pipeline_start = time.time()
    _log(f"=== Pipeline Start ===")
    _log(f"{'Feature' if is_feature else 'Issue'}: {feature_name or issue_url}")
    _log(f"Session: {session_id}")
    _log(f"Harness: {config.harness_arn}")
    _log()

    def elapsed() -> str:
        m, s = divmod(int(time.time() - pipeline_start), 60)
        return f"{m}m{s:02d}s"

    # Phase 0: Setup
    t0 = time.time()
    _log("--- Phase 0: Setup ---")
    issue_details = _invoke_with_retry(
        lambda: run_setup(client, config, session_id, issue_url,
                          feature_name=feature_name, branch_name=branch_name),
        phase_name="Setup", log=_log)
    if is_feature:
        issue_title = feature_name or "unnamed feature"
    else:
        issue_title_raw, _, _ = client.run_command(
            session_id, f"gh issue view {issue_url} --json title --jq .title 2>/dev/null"
        )
        issue_title = issue_title_raw.strip() or f"resolve #{issue_number}"
    _log(f"Setup complete. {'Feature' if is_feature else 'Issue'}: {issue_title} [{int(time.time()-t0)}s | total {elapsed()}]")
    _log()

    # Phase 1: Plan
    t0 = time.time()
    _log("--- Phase 1: Plan ---")
    if is_feature:
        plan = _invoke_with_retry(
            lambda: run_plan(client, config, session_id, issue_details,
                            devex_content=devex_content, impl_content=impl_content),
            phase_name="Plan", log=_log)
    else:
        plan = _invoke_with_retry(
            lambda: run_plan(client, config, session_id, issue_details),
            phase_name="Plan", log=_log)
    _log(f"Plan generated ({len(plan)} chars). [{int(time.time()-t0)}s | total {elapsed()}]")

    # Check if agent determined this isn't fixable
    if "ASSESSMENT: NOT_FIXABLE" in plan:
        _log("  Agent determined this issue is not fixable with available repos.")
        reason = ""
        for line in plan.split("\n"):
            if line.startswith("REASON:"):
                reason = line[len("REASON:"):].strip()
                break
        # Post comment on the issue explaining why
        if not is_feature:
            comment = (
                f"After analyzing this issue and exploring the codebase, I've determined this "
                f"cannot be fixed with changes to the CLI/CDK/SDK repos alone.\n\n"
                f"**Reason:** {reason}\n\n"
                f"_This assessment was made by an automated agent. Please review and re-label if you disagree._"
            )
            client.run_command(
                session_id,
                f'gh issue comment {issue_url} --body "{comment}"'
            )
            _log(f"  Comment posted on issue. Exiting.")
        return 0
    _log()

    # Phase 1.5: Validate Plan
    t0 = time.time()
    _log("--- Phase 1.5: Validate Plan ---")
    for attempt in range(3):
        validation = run_validate(client, session_id, plan)
        if validation.valid:
            _log(f"Plan validated. [{int(time.time()-t0)}s | total {elapsed()}]")
            break
        _log(f"Validation errors: {validation.errors}")
        if attempt < 2:
            _log("Re-planning...")
            plan = run_plan(
                client, config, session_id,
                f"Previous plan had issues: {validation.errors}\n\n{issue_details}",
            )
        else:
            _log("WARNING: Plan validation failed after 3 attempts. Proceeding anyway.")
    _log()

    # Phase 2: Execute
    t0 = time.time()
    _log("--- Phase 2: Execute ---")
    affected_repos: list[str] = []
    if "agentcore-cli" in plan.lower() or "cli" in plan.lower():
        affected_repos.append("agentcore-cli")
    if "agentcore-l3-cdk" in plan.lower() or "cdk" in plan.lower():
        affected_repos.append("agentcore-l3-cdk-constructs")
    if not affected_repos:
        affected_repos = ["agentcore-cli"]

    for attempt in range(3):
        _invoke_with_retry(
            lambda: run_execute(client, config, session_id, plan, branch_name, issue_number),
            phase_name="Execute", log=_log)
        _log(f"Execution complete. [{int(time.time()-t0)}s | total {elapsed()}]")

        # Phase 2.5: Verify
        _log("--- Phase 2.5: Verify ---")
        verification = run_verify(client, session_id, branch_name, affected_repos)
        if verification.all_passed:
            _log(f"Verification passed. [{int(time.time()-t0)}s | total {elapsed()}]")
            break
        _log(f"Verification failed: {verification.errors}")
        if attempt < 2:
            _log("Re-executing with error context...")
        else:
            _log("WARNING: Verification failed after 3 attempts. Proceeding to review anyway.")
    _log()

    # Phase 3: Extract
    t0 = time.time()
    _log("--- Phase 3: Extract ---")
    extract = run_extract(client, session_id, config.cli_repo, config.cdk_repo)
    _log(
        f"Extracted diff: {len(extract.stats.changed_files)} files, "
        f"{extract.stats.total_lines} lines changed [{int(time.time()-t0)}s | total {elapsed()}]"
    )
    if not extract.stats.changed_files:
        _log("\n=== Pipeline Failed — no changes were produced. Agent may have failed to commit. ===")
        return 1
    _log()

    # Review Loop
    all_previous_findings_files: list[str] = []
    review_summary_parts: list[str] = []

    for round_num in range(1, config.max_review_rounds + 1):
        t0 = time.time()
        # Phase 4: Review
        _log(f"--- Phase 4: Review (Round {round_num}) ---")
        num_reviewers = calculate_reviewer_count(
            extract.stats, config.min_reviewers, config.max_reviewers
        )

        if round_num == 1:
            assignments = partition_round1_by_directory(
                extract.stats.changed_files, num_reviewers
            )
        elif round_num == 2:
            focus_prompts = partition_round2_focus_prompts(num_reviewers)
            assignments = [
                ReviewerAssignment(files=extract.stats.changed_files, focus=fp)
                for fp in focus_prompts
            ]
        else:
            assignments = partition_round3_risk_areas(
                all_previous_findings_files, extract.stats.changed_files, num_reviewers
            )

        previous_context = ""
        if round_num > 1:
            previous_context = (
                f"These findings were identified and fixed in previous rounds: "
                f"{', '.join(all_previous_findings_files)}. "
                f"Do not re-raise issues that have already been addressed."
            )

        issue_summary = issue_details[:500] if issue_details else "See branch for details"
        review_results = run_review(
            client, config, assignments, branch_name, issue_summary, previous_context
        )
        _log(f"Reviews collected from {len(review_results)} reviewers. [{int(time.time()-t0)}s | total {elapsed()}]")

        # Phase 5: Aggregate
        _log(f"--- Phase 5: Aggregate (Round {round_num}) ---")
        aggregate = run_aggregate(review_results)
        _log(
            f"Approved: {aggregate.all_approved}, "
            f"Findings: {len(aggregate.unique_findings)}, "
            f"Parse failures: {aggregate.parse_failures}"
        )

        if aggregate.all_approved:
            medium_plus = [
                f for f in aggregate.unique_findings
                if f.severity in ("critical", "high", "medium")
            ]
            if not medium_plus:
                _log(f"All reviewers approved. Moving to Complete. [total {elapsed()}]")
                review_summary_parts.append(
                    f"Round {round_num}: {len(aggregate.unique_findings)} findings, all approved"
                )
                break

        review_summary_parts.append(
            f"Round {round_num}: {len(aggregate.unique_findings)} findings"
        )

        for f in aggregate.unique_findings:
            if f.file and f.file not in all_previous_findings_files:
                all_previous_findings_files.append(f.file)

        # Phase 6: Fix
        t_fix = time.time()
        _log(f"--- Phase 6: Fix (Round {round_num}) ---")
        run_fix(client, config, session_id, aggregate.unique_findings, branch_name, round_num)
        _log(f"Fixes applied. [{int(time.time()-t_fix)}s | total {elapsed()}]")

        # Re-extract for next round
        extract = run_extract(client, session_id, config.cli_repo, config.cdk_repo)
        _log()
    else:
        _log(
            f"WARNING: Max review rounds ({config.max_review_rounds}) reached "
            f"without full approval."
        )

    # Phase 8: Complete
    t0 = time.time()
    _log("--- Phase 8: Complete ---")
    review_summary = "\n".join(review_summary_parts)
    result = run_complete(
        client, config, session_id, branch_name, issue_url, issue_number,
        issue_title, review_summary, affected_repos,
    )

    if result.pr_urls:
        _log(f"\n=== Pipeline Complete [{elapsed()}] ===")
        for url in result.pr_urls:
            _log(f"PR: {url}")

        # Phase 9: Babysit PR — wait for automation reviewer feedback
        _log(f"\n--- Phase 9: Babysit PR ---")
        for url in result.pr_urls:
            run_babysit(client, config, session_id, url, branch_name)
    else:
        _log(f"\n=== Pipeline Failed [{elapsed()}] ===")
        _log(f"Errors: {result.errors}")

    return 0 if result.pr_urls else 1


