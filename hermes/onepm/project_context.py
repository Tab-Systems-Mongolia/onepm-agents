"""The short project summary the agent gets with each OnePM message."""

import re
from typing import Callable, NamedTuple, Optional, Sequence

from .constants import (
    CLONES_NOTE, CONTEXT_MAX_REPOSITORIES, CONTEXT_MAX_STATUSES, CONTEXT_NAME_MAX_LENGTH, PROJECT_CONTEXT_HEADING,
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


def _capped(items: Sequence, limit: int, format_item: Callable) -> str:
    shown = [format_item(item) for item in items[:limit]]
    rest = len(items) - len(shown)
    return ", ".join([*shown, f"and {rest} more"] if rest > 0 else shown)


def _project_line(self_info: dict, project: Optional[dict]) -> str:
    key = one_line((project or {}).get("slug") or self_info.get("projectSlug"))
    name = f"{one_line(project['name'])} " if project and project.get("name") else ""
    key_part = f"(key {key}, " if key else "("
    return (f"- Project: {name}{key_part}id {one_line(self_info.get('projectId'))}). "
            f"You are @{one_line(self_info.get('handle'))}; ticket IDs look like {key or 'KEY'}-12.")


def _status(column: dict) -> str:
    final = " (final)" if column.get("isFinal") else ""
    return f'{one_line(column.get("slug"))} "{one_line(column.get("name"))}"{final}'


def _repository(entry: RepositoryEntry) -> str:
    name = f"{one_line(entry.owner)}/{one_line(entry.name)}"
    return f"{name} at {entry.path}" if entry.path else f"{name} (no local copy)"


def format_project_context(self_info: dict, project: Optional[dict], columns: Optional[list],
                           repositories: Optional[list[RepositoryEntry]]) -> str:
    """A few lines about the agent's project. Pieces that couldn't be read are left out."""
    lines = [PROJECT_CONTEXT_HEADING, _project_line(self_info, project)]
    if columns:
        lines.append("- Statuses, in board order (a task's status is the column's slug): "
                     + _capped(columns, CONTEXT_MAX_STATUSES, _status))
    if repositories is not None:
        listed = _capped(repositories, CONTEXT_MAX_REPOSITORIES, _repository) if repositories else "none"
        lines.append(f"- GitHub repositories: {listed}")
        if any(entry.path for entry in repositories[:CONTEXT_MAX_REPOSITORIES]):
            lines.append(CLONES_NOTE)
    return "\n".join(lines)
