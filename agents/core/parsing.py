import json
import re
from typing import Literal

from pydantic import BaseModel, ValidationError


class Finding(BaseModel):
    severity: Literal["critical", "high", "medium", "low"]
    file: str
    line: int
    description: str
    suggestion: str


class ReviewResult(BaseModel):
    approved: bool
    findings: list[Finding]


def parse_reviewer_output(raw_text: str) -> ReviewResult | None:
    json_str = _extract_json(raw_text)
    if json_str is None:
        return None
    return _validate(json_str)


def _extract_json(raw_text: str) -> str | None:
    match = re.search(r"```json?\s*\n(.*?)\n\s*```", raw_text, re.DOTALL)
    if match:
        return match.group(1).strip()

    start = raw_text.find("{")
    if start == -1:
        return None

    while start != -1:
        depth = 0
        in_string = False
        escape_next = False
        for i in range(start, len(raw_text)):
            c = raw_text[i]
            if escape_next:
                escape_next = False
                continue
            if c == "\\":
                escape_next = True
                continue
            if c == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    candidate = raw_text[start : i + 1]
                    if "approved" in candidate:
                        return candidate
                    break
        start = raw_text.find("{", start + 1)
    return None


def _validate(json_str: str) -> ReviewResult | None:
    try:
        data = json.loads(json_str)
        return ReviewResult(**data)
    except (json.JSONDecodeError, ValidationError):
        return None
