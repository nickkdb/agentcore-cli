import json
import sys
import time
import uuid
from urllib.parse import quote

import boto3
import urllib3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.config import Config as BotoConfig
from botocore.eventstream import EventStreamBuffer

from core.config import PipelineConfig


class HarnessClient:
    def __init__(self, config: PipelineConfig, output=None):
        self.config = config
        self.output = output or sys.stdout
        self.session = boto3.Session(
            region_name=config.region,
            profile_name=config.aws_profile,
        )
        self.http = urllib3.PoolManager()
        self.client = self.session.client(
            "bedrock-agentcore",
            config=BotoConfig(read_timeout=600, connect_timeout=30, retries={"max_attempts": 2}),
        )

    def _print(self, *args, **kwargs):
        kwargs.setdefault("file", self.output)
        kwargs.setdefault("flush", True)
        print(*args, **kwargs)

    def invoke(
        self,
        session_id: str,
        message: str,
        system_prompt: str | None = None,
        max_iterations: int | None = None,
        verbose: bool = True,
        retries: int = 2,
    ) -> str:
        for attempt in range(retries + 1):
            try:
                return self._invoke_once(session_id, message, system_prompt, max_iterations, verbose)
            except (urllib3.exceptions.ProtocolError, urllib3.exceptions.ReadTimeoutError, ConnectionResetError) as e:
                if attempt < retries:
                    if verbose:
                        self._print(f"\n  ⚠️  Connection error (attempt {attempt + 1}/{retries + 1}): {e}. Retrying...")
                    time.sleep(5)
                else:
                    if verbose:
                        self._print(f"\n  ⚠️  Connection error after {retries + 1} attempts: {e}")
                    raise

    def _invoke_once(
        self,
        session_id: str,
        message: str,
        system_prompt: str | None = None,
        max_iterations: int | None = None,
        verbose: bool = True,
    ) -> str:
        body: dict = {
            "runtimeSessionId": session_id,
            "messages": [{"role": "user", "content": [{"text": message}]}],
            "model": {"bedrockModelConfig": {"modelId": self.config.model_id}},
        }
        if system_prompt:
            body["systemPrompt"] = [{"text": system_prompt}]
        if max_iterations:
            body["maxIterations"] = max_iterations

        region = self.config.region
        arn = self.config.harness_arn
        url = f"https://bedrock-agentcore.{region}.amazonaws.com/harnesses/invoke?harnessArn={quote(arn, safe='')}"

        body_bytes = json.dumps(body).encode()
        request = AWSRequest(method="POST", url=url, data=body_bytes, headers={
            "Content-Type": "application/json",
            "Accept": "application/vnd.amazon.eventstream",
        })
        credentials = self.session.get_credentials().get_frozen_credentials()
        SigV4Auth(credentials, "bedrock-agentcore", region).add_auth(request)

        response = self.http.urlopen(
            "POST", url, body=body_bytes,
            headers=dict(request.headers),
            preload_content=False,
            timeout=urllib3.Timeout(connect=30, read=900),
        )

        if response.status != 200:
            error = response.read().decode("utf-8")
            if verbose:
                self._print(f"\n  ⚠️  HTTP {response.status}: {error}")
            raise RuntimeError(f"InvokeHarness failed: HTTP {response.status}: {error}")

        request_id = response.headers.get("x-amzn-RequestId", "unknown")
        if verbose:
            self._print(f"  [request: {request_id}]")
        self.last_request_id = request_id

        return self._accumulate_text_from_http(response, verbose=verbose)

    def run_command(self, session_id: str, command: str, verbose: bool = False) -> tuple[str, str, int]:
        if verbose:
            self._print(f"  $ {command}")
        response = self.client.invoke_agent_runtime_command(
            agentRuntimeArn=self.config.harness_arn,
            runtimeSessionId=session_id,
            body={"command": command},
        )
        request_id = response.get("ResponseMetadata", {}).get("RequestId", "unknown")
        self.last_request_id = request_id
        return self._accumulate_command(response["stream"], verbose=verbose)

    def _accumulate_text_from_http(self, http_response, verbose: bool = False) -> str:
        text_parts: list[str] = []
        tool_input_parts: list[str] = []
        current_tool: str | None = None
        event_buffer = EventStreamBuffer()

        for chunk in http_response.stream(4096):
            event_buffer.add_data(chunk)
            for event in event_buffer:
                if event.headers.get(":message-type") == "exception":
                    payload = json.loads(event.payload.decode("utf-8"))
                    if verbose:
                        self._print(f"\n  ⚠️  Stream error: {payload}")
                    if text_parts:
                        return "".join(text_parts)
                    raise RuntimeError(f"Stream error: {payload}")

                event_type = event.headers.get(":event-type", "")
                if not event.payload:
                    continue
                payload = json.loads(event.payload.decode("utf-8"))

                if event_type == "contentBlockStart":
                    start = payload.get("start", {})
                    if "toolUse" in start:
                        current_tool = start["toolUse"].get("name", "unknown")
                        tool_input_parts = []
                    else:
                        current_tool = None
                elif event_type == "contentBlockDelta":
                    delta = payload.get("delta", {})
                    if "text" in delta:
                        text_parts.append(delta["text"])
                        if verbose:
                            self._print(delta["text"], end="")
                    elif "toolUse" in delta and current_tool:
                        tool_input_parts.append(delta["toolUse"].get("input", ""))
                elif event_type == "contentBlockStop":
                    if current_tool and verbose:
                        tool_input = "".join(tool_input_parts)
                        self._print(f"\n  🔧 {current_tool}: {tool_input[:200]}")
                        current_tool = None
                        tool_input_parts = []
                elif event_type == "messageStop" and verbose:
                    self._print(flush=True)

        return "".join(text_parts)

    def _accumulate_command(self, stream, verbose: bool = False) -> tuple[str, str, int]:
        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        exit_code = -1
        for event in stream:
            if "chunk" in event:
                chunk = event["chunk"]
                if "contentDelta" in chunk:
                    delta = chunk["contentDelta"]
                    if "stdout" in delta:
                        stdout_parts.append(delta["stdout"])
                        if verbose:
                            self._print(delta["stdout"], end="")
                    if "stderr" in delta:
                        stderr_parts.append(delta["stderr"])
                        if verbose:
                            self._print(delta["stderr"], end="", file=sys.stderr)
                elif "contentStop" in chunk:
                    exit_code = chunk["contentStop"].get("exitCode", -1)
                    if verbose:
                        self._print(f"  [exit: {exit_code}]")
        return "".join(stdout_parts), "".join(stderr_parts), exit_code

    @staticmethod
    def new_session_id() -> str:
        return str(uuid.uuid4()).upper()
