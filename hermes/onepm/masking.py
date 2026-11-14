"""Hide token-like secrets before a reply is posted on a task."""

import re
from typing import Iterable

from .constants import MIN_MASKED_VALUE_LENGTH, REDACTED

# The same patterns the OnePM connector redacted in its act runs.
SECRET_PATTERNS = (
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bopm_[A-Za-z0-9_]{16,}"),
    re.compile(r"\bnpm_[A-Za-z0-9]{20,}"),
    re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),
    re.compile(r"(\b(?:Bearer|Basic|Token)\s+)[A-Za-z0-9._~+/=-]{12,}", re.IGNORECASE),
    re.compile(r"(://[^\s:/@]+:)[^\s@/]+(?=@)"),
)


def _mask_pattern(text: str, pattern: re.Pattern) -> str:
    # A pattern with a group keeps it (the scheme word, a URL's user name).
    if pattern.groups:
        return pattern.sub(lambda match: f"{match.group(1)}{REDACTED}", text)
    return pattern.sub(REDACTED, text)


def mask_secrets(text: str, values: Iterable[str] = ()) -> str:
    """The known values first, longest first, then the patterns."""
    known = sorted((value for value in values if value and len(value) >= MIN_MASKED_VALUE_LENGTH),
                   key=len, reverse=True)
    for value in known:
        text = text.replace(value, REDACTED)
    for pattern in SECRET_PATTERNS:
        text = _mask_pattern(text, pattern)
    return text
