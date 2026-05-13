"""Phase: Parse Contracts — reads devex doc + implementation plan and uploads to VM."""

import re
from dataclasses import dataclass

from core.harness_client import HarnessClient


@dataclass
class ContractMetadata:
    feature_name: str
    repos: list[str]
    devex_content: str
    impl_content: str


def run_parse_contracts(
    client: HarnessClient,
    session_id: str,
    devex_path: str,
    impl_path: str,
    feature_name: str,
) -> ContractMetadata:
    with open(devex_path) as f:
        devex_content = f.read()
    with open(impl_path) as f:
        impl_content = f.read()

    repos = _detect_repos(devex_content + "\n" + impl_content)

    _upload_file(client, session_id, "/tmp/devex.md", devex_content)
    _upload_file(client, session_id, "/tmp/impl.md", impl_content)

    return ContractMetadata(
        feature_name=feature_name,
        repos=repos,
        devex_content=devex_content,
        impl_content=impl_content,
    )


def _detect_repos(content: str) -> list[str]:
    repos = []
    content_lower = content.lower()
    if "agentcore-cli" in content_lower or "cli" in content_lower:
        repos.append("agentcore-cli")
    if "agentcore-l3-cdk" in content_lower or "cdk" in content_lower:
        repos.append("agentcore-l3-cdk-constructs")
    if "sdk-python" in content_lower or "python sdk" in content_lower:
        repos.append("bedrock-agentcore-sdk-python")
    if "sdk-typescript" in content_lower or "typescript sdk" in content_lower:
        repos.append("bedrock-agentcore-sdk-typescript")
    if not repos:
        repos = ["agentcore-cli"]
    return repos


def _upload_file(client: HarnessClient, session_id: str, remote_path: str, content: str) -> None:
    escaped = content.replace("\\", "\\\\").replace("'", "'\\''")
    client.run_command(
        session_id,
        f"cat > {remote_path} << 'CONTRACT_EOF'\n{escaped}\nCONTRACT_EOF",
    )
