import time
from pathlib import Path

from core.config import PipelineConfig
from core.harness_client import HarnessClient
from core.parsing import Finding
from orchestrations.fix_and_review.partitioning import (
    ReviewerAssignment,
    calculate_reviewer_count,
    partition_round1_by_directory,
    partition_round2_focus_prompts,
    partition_round3_risk_areas,
)
from orchestrations.fix_and_review.phases.aggregate import run_aggregate
from orchestrations.fix_and_review.phases.complete import run_complete
from orchestrations.fix_and_review.phases.execute import run_execute
from orchestrations.fix_and_review.phases.extract import ExtractResult, run_extract
from orchestrations.fix_and_review.phases.fix import run_fix
from orchestrations.fix_and_review.phases.plan import run_plan
from orchestrations.fix_and_review.phases.review import run_review
from orchestrations.fix_and_review.phases.setup import run_setup, set_prompts_dir
from orchestrations.fix_and_review.phases.validate import run_validate
from orchestrations.fix_and_review.phases.verify import run_verify


def run_pipeline(
    issue_url: str,
    config_path: str = "config.yaml",
    prompts_dir: str | Path | None = None,
    devex_content: str | None = None,
    impl_content: str | None = None,
    feature_name: str | None = None,
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

    client = HarnessClient(config)
    session_id = HarnessClient.new_session_id()

    pipeline_start = time.time()
    print(f"=== Pipeline Start ===")
    print(f"{'Feature' if is_feature else 'Issue'}: {feature_name or issue_url}")
    print(f"Session: {session_id}")
    print(f"Harness: {config.harness_arn}")
    print()

    def elapsed() -> str:
        m, s = divmod(int(time.time() - pipeline_start), 60)
        return f"{m}m{s:02d}s"

    # Phase 0: Setup
    t0 = time.time()
    print("--- Phase 0: Setup ---")
    issue_details = run_setup(client, config, session_id, issue_url,
                              feature_name=feature_name, branch_name=branch_name)
    if is_feature:
        issue_title = feature_name or "unnamed feature"
    else:
        issue_title_raw, _, _ = client.run_command(
            session_id, f"gh issue view {issue_url} --json title --jq .title 2>/dev/null"
        )
        issue_title = issue_title_raw.strip() or f"resolve #{issue_number}"
    print(f"Setup complete. {'Feature' if is_feature else 'Issue'}: {issue_title} [{int(time.time()-t0)}s | total {elapsed()}]")
    print()

    # Phase 1: Plan
    t0 = time.time()
    print("--- Phase 1: Plan ---")
    if is_feature:
        plan = run_plan(client, config, session_id, issue_details,
                        devex_content=devex_content, impl_content=impl_content)
    else:
        plan = run_plan(client, config, session_id, issue_details)
    print(f"Plan generated ({len(plan)} chars). [{int(time.time()-t0)}s | total {elapsed()}]")
    print()

    # Phase 1.5: Validate Plan
    t0 = time.time()
    print("--- Phase 1.5: Validate Plan ---")
    for attempt in range(3):
        validation = run_validate(client, session_id, plan)
        if validation.valid:
            print(f"Plan validated. [{int(time.time()-t0)}s | total {elapsed()}]")
            break
        print(f"Validation errors: {validation.errors}")
        if attempt < 2:
            print("Re-planning...")
            plan = run_plan(
                client, config, session_id,
                f"Previous plan had issues: {validation.errors}\n\n{issue_details}",
            )
        else:
            print("WARNING: Plan validation failed after 3 attempts. Proceeding anyway.")
    print()

    # Phase 2: Execute
    t0 = time.time()
    print("--- Phase 2: Execute ---")
    affected_repos: list[str] = []
    if "agentcore-cli" in plan.lower() or "cli" in plan.lower():
        affected_repos.append("agentcore-cli")
    if "agentcore-l3-cdk" in plan.lower() or "cdk" in plan.lower():
        affected_repos.append("agentcore-l3-cdk-constructs")
    if not affected_repos:
        affected_repos = ["agentcore-cli"]

    for attempt in range(3):
        run_execute(client, config, session_id, plan, branch_name, issue_number)
        print(f"Execution complete. [{int(time.time()-t0)}s | total {elapsed()}]")

        # Phase 2.5: Verify
        print("--- Phase 2.5: Verify ---")
        verification = run_verify(client, session_id, branch_name, affected_repos)
        if verification.all_passed:
            print(f"Verification passed. [{int(time.time()-t0)}s | total {elapsed()}]")
            break
        print(f"Verification failed: {verification.errors}")
        if attempt < 2:
            print("Re-executing with error context...")
        else:
            print("WARNING: Verification failed after 3 attempts. Proceeding to review anyway.")
    print()

    # Phase 3: Extract
    t0 = time.time()
    print("--- Phase 3: Extract ---")
    extract = run_extract(client, session_id, config.cli_repo, config.cdk_repo)
    print(
        f"Extracted diff: {len(extract.stats.changed_files)} files, "
        f"{extract.stats.total_lines} lines changed [{int(time.time()-t0)}s | total {elapsed()}]"
    )
    if not extract.stats.changed_files:
        print("\n=== Pipeline Failed — no changes were produced. Agent may have failed to commit. ===")
        return 1
    print()

    # Review Loop
    all_previous_findings_files: list[str] = []
    review_summary_parts: list[str] = []

    for round_num in range(1, config.max_review_rounds + 1):
        t0 = time.time()
        # Phase 4: Review
        print(f"--- Phase 4: Review (Round {round_num}) ---")
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
        print(f"Reviews collected from {len(review_results)} reviewers. [{int(time.time()-t0)}s | total {elapsed()}]")

        # Phase 5: Aggregate
        print(f"--- Phase 5: Aggregate (Round {round_num}) ---")
        aggregate = run_aggregate(review_results)
        print(
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
                print(f"All reviewers approved. Moving to Complete. [total {elapsed()}]")
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
        print(f"--- Phase 6: Fix (Round {round_num}) ---")
        run_fix(client, config, session_id, aggregate.unique_findings, branch_name, round_num)
        print(f"Fixes applied. [{int(time.time()-t_fix)}s | total {elapsed()}]")

        # Re-extract for next round
        extract = run_extract(client, session_id, config.cli_repo, config.cdk_repo)
        print()
    else:
        print(
            f"WARNING: Max review rounds ({config.max_review_rounds}) reached "
            f"without full approval."
        )

    # Phase 8: Complete
    t0 = time.time()
    print("--- Phase 8: Complete ---")
    review_summary = "\n".join(review_summary_parts)
    result = run_complete(
        client, config, session_id, branch_name, issue_url, issue_number,
        issue_title, review_summary, affected_repos,
    )

    if result.pr_urls:
        print(f"\n=== Pipeline Complete [{elapsed()}] ===")
        for url in result.pr_urls:
            print(f"PR: {url}")
    else:
        print(f"\n=== Pipeline Failed [{elapsed()}] ===")
        print(f"Errors: {result.errors}")

    return 0 if result.pr_urls else 1


