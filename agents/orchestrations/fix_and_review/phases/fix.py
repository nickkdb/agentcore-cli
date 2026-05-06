from core.config import PipelineConfig
from core.harness_client import HarnessClient
from core.parsing import Finding
from orchestrations.fix_and_review.phases.setup import load_prompt


def run_fix(
    client: HarnessClient,
    config: PipelineConfig,
    session_id: str,
    findings: list[Finding],
    branch_name: str,
    round_number: int,
) -> str:
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    sorted_findings = sorted(findings, key=lambda f: severity_order.get(f.severity, 4))

    findings_text = ""
    for f in sorted_findings:
        findings_text += f"### [{f.severity.upper()}] {f.file}:{f.line}\n"
        findings_text += f"**Issue:** {f.description}\n"
        findings_text += f"**Suggestion:** {f.suggestion}\n\n"

    prompt = load_prompt(
        "fixer.md",
        findings_text=findings_text,
        round_number=str(round_number),
        branch_name=branch_name,
    )
    return client.invoke(session_id=session_id, message=prompt, max_iterations=30)
