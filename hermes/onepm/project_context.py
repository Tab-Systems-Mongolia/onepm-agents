"""The short project summary the agent gets with each OnePM message.

Workspace members wrote the project's names, so every such value goes in as a
JSON string inside a delimited data block, never as free text the model could
read as an instruction.
"""

import json
import re
from typing import Callable, NamedTuple, Optional, Sequence

from .constants import (
    CLONES_NOTE, CONTEXT_MAX_REPOSITORIES, CONTEXT_MAX_STATUSES, CONTEXT_NAME_MAX_LENGTH, PROJECT_CONTEXT_HEADING,
    PROJECT_CONTEXT_NOTE, PROJECT_DATA_BEGIN, PROJECT_DATA_END,
)


class RepositoryEntry(NamedTuple):
    owner: str
    name: str
    # Where the agent's tools find the clone; None while there's no local copy.
    path: Optional[str]


def one_line(value) -> str:
    """Workspace-written text goes into the prompt as one short line."""
    text = re.sub(r"\s+", " ", "" if value is None else str(value)).strip()
    return f"{text[:CONTEXT_NAME_MAX_LENGTH]}…" if len(text) > CONTEXT_NAME_MAX_LENGTH else text


def quoted(value) -> str:
    """One short line, as a JSON string: quotes and backslashes in it are escaped."""
    return json.dumps(one_line(value), ensure_ascii=False)


def _capped(items: Sequence, limit: int, format_item: Callable) -> str:
    shown = [format_item(item) for item in items[:limit]]
    rest = len(items) - len(shown)
    return ", ".join([*shown, f"and {rest} more"] if rest > 0 else shown)


def _project_line(self_info: dict, project: Optional[dict]) -> str:
    key = (project or {}).get("slug") or self_info.get("projectSlug")
    parts = [f"name {quoted(project['name'])}"] if project and project.get("name") else []
    if key:
        parts.append(f"key {quoted(key)}")
    parts.append(f"id {quoted(self_info.get('projectId'))}")
    return f"project: {', '.join(parts)}"


def _status(column: dict) -> str:
    final = " (final)" if column.get("isFinal") else ""
    return f"{quoted(column.get('slug'))} {quoted(column.get('name'))}{final}"


def _repository(entry: RepositoryEntry) -> str:
    name = quoted(f"{one_line(entry.owner)}/{one_line(entry.name)}")
    return f"{name} at {json.dumps(entry.path, ensure_ascii=False)}" if entry.path else f"{name} (no local copy)"


def format_project_context(self_info: dict, project: Optional[dict], columns: Optional[list],
                           repositories: Optional[list[RepositoryEntry]]) -> str:
    """A few lines about the agent's project. Pieces that couldn't be read are left out."""
    data = [_project_line(self_info, project), f"your handle: {quoted(self_info.get('handle'))}"]
    if columns:
        data.append("statuses, in board order (slug, then name): "
                    + _capped(columns, CONTEXT_MAX_STATUSES, _status))
    if repositories is not None:
        listed = _capped(repositories, CONTEXT_MAX_REPOSITORIES, _repository) if repositories else "none"
        data.append(f"GitHub repositories: {listed}")
    lines = [PROJECT_CONTEXT_HEADING, PROJECT_DATA_BEGIN, *data, PROJECT_DATA_END, PROJECT_CONTEXT_NOTE]
    if repositories and any(entry.path for entry in repositories[:CONTEXT_MAX_REPOSITORIES]):
        lines.append(CLONES_NOTE)
    return "\n".join(lines)
