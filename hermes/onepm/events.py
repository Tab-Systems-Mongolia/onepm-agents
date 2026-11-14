"""Turn a OnePM agent event into the fields of one inbound chat message.

Pure functions over the API's JSON, so they test without a server or Hermes.
Newer servers put actorName, taskTitle, taskKey and text on the event; older
ones only send ids, and the caller passes the task and comment it fetched.
"""

import datetime
import re
from dataclasses import dataclass
from typing import Optional

from .constants import (
    AGENT_ACTOR_SOURCE,
    ANY_TAG_PATTERN,
    ENTITIES,
    ENTITY_PATTERN,
    EXTRA_BLANK_LINES_PATTERN,
    LABEL_ATTRIBUTE_PATTERN,
    LINE_BREAK_TAG_PATTERN,
    MENTION_TAG_PATTERN,
    PULL_REQUEST_ACTION_TEXT,
    REQUEST_KINDS,
    TRIGGER_ACTOR_SOURCE,
    TRIGGER_KINDS,
    TRIGGER_SENDER_ID,
    TRIGGER_SENDER_NAME,
    UNNAMED_MENTION,
)

_MENTION_TAG = re.compile(MENTION_TAG_PATTERN, re.IGNORECASE)
_LABEL_ATTRIBUTE = re.compile(LABEL_ATTRIBUTE_PATTERN, re.IGNORECASE)
_LINE_BREAK_TAG = re.compile(LINE_BREAK_TAG_PATTERN, re.IGNORECASE)
_ANY_TAG = re.compile(ANY_TAG_PATTERN)
_ENTITY = re.compile(ENTITY_PATTERN)
_EXTRA_BLANK_LINES = re.compile(EXTRA_BLANK_LINES_PATTERN)


@dataclass(frozen=True)
class Inbound:
    chat_id: str
    chat_name: str
    user_id: Optional[str]
    user_name: Optional[str]
    text: str
    message_id: str
    is_bot: bool
    timestamp: datetime.datetime
    # A trigger event: OnePM, not a person, sent it, so the adapter vouches for it.
    trusted: bool = False


def _mention(match: re.Match) -> str:
    label = _LABEL_ATTRIBUTE.search(match.group(1))
    name = label.group(1) if label else match.group(2).strip()
    if not name:
        return UNNAMED_MENTION
    return name if name.startswith("@") else f"@{name}"


def readable_text(content: Optional[str]) -> str:
    """Editor HTML as plain text: mentions as @name, block ends as line breaks."""
    text = _MENTION_TAG.sub(_mention, content or "")
    text = _LINE_BREAK_TAG.sub("\n", text)
    text = _ANY_TAG.sub("", text)
    text = _ENTITY.sub(lambda match: ENTITIES.get(match.group(0), match.group(0)), text)
    return _EXTRA_BLANK_LINES.sub("\n\n", text).strip()


def is_request(event: dict, agent_id: str) -> bool:
    """Whether the event asks the agent something; its own comments never do."""
    return event.get("kind") in REQUEST_KINDS and event.get("actorId") != agent_id


def is_trigger(event: dict) -> bool:
    """A status or pull request event OnePM sent for a trigger an admin set."""
    return event.get("actorSource") == TRIGGER_ACTOR_SOURCE and event.get("kind") in TRIGGER_KINDS


def _status_text(event: dict) -> str:
    status = event.get("status") or {}
    target = status.get("to") or "another status"
    route = f"from {status['from']} to {target}" if status.get("from") else f"to {target}"
    actor = event.get("actorName")
    return f"{actor} moved this task {route}." if actor else f"This task moved {route}."


def _pull_request_text(event: dict) -> str:
    pull = event.get("pullRequest") or {}
    if not pull.get("number"):
        return "A pull request linked to this task changed."
    where = f" ({pull['repository']})" if pull.get("repository") else ""
    what = PULL_REQUEST_ACTION_TEXT.get(pull.get("action"), pull.get("action") or "changed")
    lines = [f"Pull request #{pull['number']}{where} {what}" + (f": {pull['title']}" if pull.get("title") else ".")]
    lines += [line for line in (pull.get("url"), pull.get("branch") and f"Branch: {pull['branch']}") if line]
    return "\n".join(lines)


def trigger_text(event: dict) -> str:
    return _status_text(event) if event.get("kind") == "status" else _pull_request_text(event)


def is_agent_actor(event: dict) -> bool:
    return event.get("actorSource") == AGENT_ACTOR_SOURCE


def needs_task(event: dict) -> bool:
    return not (event.get("taskTitle") and event.get("taskKey")) or (
        event.get("kind") == "assignment" and event.get("text") is None)


def needs_comment(event: dict) -> bool:
    return bool(event.get("commentId")) and (event.get("text") is None or not event.get("actorName"))


def find_comment(comments: list, comment_id: Optional[str]) -> Optional[dict]:
    return next((c for c in comments if isinstance(c, dict) and c.get("id") == comment_id), None)


def task_key(task: Optional[dict], project_slug: Optional[str]) -> Optional[str]:
    number = (task or {}).get("number")
    if not project_slug or not isinstance(number, int):
        return None
    return f"{project_slug.upper()}-{number}"


def chat_name(key: Optional[str], title: Optional[str], task_id: str) -> str:
    return " ".join(part for part in (key, title) if part) or task_id


def _parse_time(value) -> datetime.datetime:
    if isinstance(value, str):
        try:
            return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.datetime.now(datetime.timezone.utc)


def _task_brief(task: Optional[dict]) -> str:
    task = task or {}
    return "\n\n".join(part.strip() for part in (task.get("title"), task.get("description"))
                       if isinstance(part, str) and part.strip())


def event_text(event: dict, task: Optional[dict], comment: Optional[dict]) -> Optional[str]:
    """The message the agent reads; None when there is nothing to answer."""
    for content in (event.get("text"), (comment or {}).get("content")):
        if isinstance(content, str) and readable_text(content):
            return readable_text(content)
    if event.get("commentId"):
        return None  # the comment was deleted before it was read
    brief = _task_brief(task)
    if event.get("kind") == "assignment":
        return "You were assigned this task." + (f"\n\n{brief}" if brief else "")
    if event.get("kind") == "mention":
        return "You were mentioned in this task." + (f"\n\n{brief}" if brief else "")
    return None


def to_inbound(event: dict, task: Optional[dict], comment: Optional[dict],
               project_slug: Optional[str]) -> Optional[Inbound]:
    if is_trigger(event):
        return _trigger_inbound(event, task, project_slug)
    text = event_text(event, task, comment)
    if text is None:
        return None
    task_id = str(event["taskId"])
    key = event.get("taskKey") or task_key(task, project_slug)
    title = event.get("taskTitle") or (task or {}).get("title")
    user = (comment or {}).get("user") or {}
    actor_id = event.get("actorId") or (comment or {}).get("userId")
    return Inbound(
        chat_id=task_id,
        chat_name=chat_name(key, title, task_id),
        user_id=str(actor_id) if actor_id else None,
        user_name=event.get("actorName") or user.get("name") or actor_id,
        text=text,
        message_id=str(event.get("commentId") or event["id"]),
        is_bot=is_agent_actor(event),
        timestamp=_parse_time(event.get("createdAt")),
    )


def _trigger_inbound(event: dict, task: Optional[dict], project_slug: Optional[str]) -> Inbound:
    task_id = str(event["taskId"])
    key = event.get("taskKey") or task_key(task, project_slug)
    title = event.get("taskTitle") or (task or {}).get("title")
    return Inbound(
        chat_id=task_id,
        chat_name=chat_name(key, title, task_id),
        user_id=TRIGGER_SENDER_ID,
        user_name=TRIGGER_SENDER_NAME,
        text=trigger_text(event),
        message_id=str(event["id"]),
        is_bot=False,
        timestamp=_parse_time(event.get("createdAt")),
        trusted=True,
    )
