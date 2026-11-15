"""OnePM platform adapter for the Hermes gateway.

Each OnePM task is a chat (chat_id = task id). The agent socket keeps the
agent "connected" in OnePM and wakes a reader that pages the agent's events
from a cursor kept on disk; every mention, assignment or comment becomes an
inbound message whose user id is the OnePM user id, so Hermes's own
allowlist (ONEPM_ALLOWED_USERS) decides who the agent answers. Replies are
posted as comments with token-like secrets masked.
"""

import asyncio
import contextlib
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

import aiohttp

from gateway.config import Platform
from gateway.platforms.base import BasePlatformAdapter, SendResult
from gateway.platforms.helpers import MessageDeduplicator

from .compat import MessageEvent, MessageType, cancel_task, display_kwargs, get_scoped_secret, sender_authorized
from .client import OnepmClient, OnepmError, is_not_found, is_rate_limited
from .constants import (
    ALLOW_ALL_ENV, ALLOWED_USERS_ENV, BUSY_REFRESH_SECONDS, CURSOR_DIR, CURSOR_FILE, DEDUP_SIZE, DEDUP_TTL_SECONDS, DEFAULT_URL,
    DEFAULT_GIT_URL_TEMPLATE, DEFAULT_WORKSPACE_DIR, DISPLAY_TIER, DRAIN_RETRY_SECONDS, GIT_URL_TEMPLATE_ENV, HOME_CHANNEL_ENV, KEY_ENV,
    MAX_COMMENT_LENGTH, NO_HOME_CHANNEL, PLATFORM_LABEL, PLATFORM_NAME, UNAUTHORIZED_STATUSES, URL_ENV, WORKSPACE_ENV,
    STAGING_DIR, WORKSPACE_IN_SANDBOX_ENV,
)
from .cursor import CursorStore, skip_history
from .events import (
    Inbound, allows_everyone, borrows_owner, chat_name, find_comment, is_agent_actor, is_request, is_trigger, needs_comment,
    needs_task, reported_allow_from, task_key, to_inbound,
)
from .masking import mask_secrets
from .project_sync import ProjectSync
from .repo_clones import RepositoryClones
from .socket_link import run_socket

logger = logging.getLogger(__name__)

# MessageEvent.channel_prompt is Hermes's per-channel ephemeral system prompt.
_HAS_CHANNEL_PROMPT = "channel_prompt" in getattr(MessageEvent, "__dataclass_fields__", {})

PLATFORM_HINT = (
    "You are talking on OnePM, a project manager. Each chat is one OnePM task: the chat id is the "
    "task id and the chat name is the task key and title. Your replies are posted as comments on "
    "that task, which everyone on the project can read, so keep them focused and never include "
    "secrets. Markdown is supported. To mention someone in a reply, write "
    "<kaneo-mention id=\"<user id>\" label=\"<name>\">@<name></kaneo-mention>; the sender's id is the "
    "message's user_id, others come from list_workspace_members. If the OnePM MCP server is "
    "configured, use its tools to read or update the task."
)


def _settings() -> tuple[str, str]:
    # Without ONEPM_URL the agent connects to the hosted OnePM.
    url = (get_scoped_secret(URL_ENV, "") or "").strip().rstrip("/") or DEFAULT_URL
    key = (get_scoped_secret(KEY_ENV, "") or "").strip()
    return url, key


def _cursor_path():
    from hermes_constants import get_hermes_home
    return get_hermes_home() / CURSOR_DIR / CURSOR_FILE


def _setting(name: str) -> str:
    return (get_scoped_secret(name, "") or "").strip()


def _clones() -> RepositoryClones:
    from hermes_constants import get_hermes_home
    workspace = _setting(WORKSPACE_ENV)
    path = Path(workspace).expanduser() if workspace else get_hermes_home() / CURSOR_DIR / DEFAULT_WORKSPACE_DIR
    return RepositoryClones(path, _setting(GIT_URL_TEMPLATE_ENV) or DEFAULT_GIT_URL_TEMPLATE,
                            staging=get_hermes_home() / CURSOR_DIR / STAGING_DIR)


class OnepmAdapter(BasePlatformAdapter):
    MAX_MESSAGE_LENGTH = MAX_COMMENT_LENGTH

    def __init__(self, config, **kwargs):
        super().__init__(config=config, platform=Platform(PLATFORM_NAME))
        self.base_url, self._api_key = _settings()
        self._session: Optional[aiohttp.ClientSession] = None
        self._client: Optional[OnepmClient] = None
        self._self_info: dict = {}
        self._cursor: Optional[CursorStore] = None
        self._sequence: Optional[int] = None
        self._wake = asyncio.Event()
        self._socket_task: Optional[asyncio.Task] = None
        self._drain_task: Optional[asyncio.Task] = None
        self._dedup = MessageDeduplicator(max_size=DEDUP_SIZE, ttl_seconds=DEDUP_TTL_SECONDS)
        self._chat_names: Dict[str, str] = {}
        # Typing shows the agent "replying" on the task in OnePM: when each
        # chat was last marked, and the chats already answered this turn.
        self._busy_marked: Dict[str, float] = {}
        self._replied: set[str] = set()
        self._busy_supported = True
        self._now = time.monotonic
        # The project summary and repository clones; set up once connected.
        self._project_sync: Optional[ProjectSync] = None

    @property
    def name(self) -> str:
        return PLATFORM_LABEL

    @property
    def agent_id(self) -> str:
        return str(self._self_info.get("id") or "")

    def _fail(self, code: str, message: str, *, retryable: bool) -> bool:
        self._set_fatal_error(code, message, retryable=retryable)
        return False

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        if not (self.base_url and self._api_key):
            return self._fail("config_missing", f"{KEY_ENV} must be set", retryable=False)
        self._session = aiohttp.ClientSession()
        self._client = OnepmClient(self._session, self.base_url, self._api_key)
        try:
            self._self_info = await self._client.self_info()
        except OnepmError as error:
            await self._close_session()
            retryable = error.status not in UNAUTHORIZED_STATUSES
            return self._fail("auth_failed" if not retryable else "connect_failed", str(error), retryable=retryable)
        except Exception as error:
            await self._close_session()
            logger.error("OnePM: couldn't reach %s: %s", self.base_url, error)
            return self._fail("connect_failed", str(error), retryable=True)
        if not self.agent_id:
            await self._close_session()
            return self._fail("auth_failed", "The key isn't an agent's key", retryable=False)
        if not self._acquire_platform_lock(PLATFORM_NAME, f"{self.base_url}:{self.agent_id}",
                                           f"OnePM agent @{self._self_info.get('handle', self.agent_id)}"):
            await self._close_session()
            return False
        self._cursor = CursorStore(_cursor_path(), self.base_url, self.agent_id)
        try:
            self._sequence = await skip_history(self._cursor, self._client.events)
        except Exception as error:
            self._release_platform_lock()
            await self._close_session()
            return self._fail("connect_failed", f"Couldn't read events: {error}", retryable=True)
        await self._report_access()
        self._project_sync = ProjectSync(self._client, self._self_info, _clones(),
                                         _setting(WORKSPACE_IN_SANDBOX_ENV) or None)
        self._project_sync.start()
        self._drain_task = asyncio.create_task(self._drain_loop())
        self._socket_task = asyncio.create_task(
            run_socket(self._session, self.base_url, self._api_key, self._wake.set, self._on_replaced))
        self._mark_connected()
        logger.info("OnePM: connected to %s as @%s", self.base_url, self._self_info.get("handle"))
        self._wire_plugin_handlers(None)
        return True

    async def _report_access(self) -> None:
        """Tells OnePM who may assign or mention the agent, so it refuses everyone else up front. The
        list comes from the environment, which only changes with a restart, so once per connect."""
        if allows_everyone(_setting(ALLOW_ALL_ENV)):
            logger.warning("OnePM: %s can't be passed to OnePM, which takes named users only; only %s "
                           "and the owner can assign or mention the agent there", ALLOW_ALL_ENV, ALLOWED_USERS_ENV)
        allow_from = reported_allow_from(_setting(ALLOWED_USERS_ENV), self._self_info.get("ownerId"))
        try:
            await self._client.report_access(allow_from)
        except Exception as error:  # An older OnePM has no such route (404); nothing else depends on it.
            logger.warning("OnePM: couldn't report who may reach the agent: %s", error)

    async def disconnect(self) -> None:
        with contextlib.suppress(Exception):
            self._release_platform_lock()
        self._mark_disconnected()
        await cancel_task(self._socket_task)
        await cancel_task(self._drain_task)
        self._socket_task = self._drain_task = None
        if self._project_sync is not None:
            await self._project_sync.close()
            self._project_sync = None
        await self._close_session()

    async def _close_session(self) -> None:
        if self._session is not None:
            with contextlib.suppress(Exception):
                await self._session.close()
        self._session = None

    async def _on_replaced(self) -> None:
        self._set_fatal_error("connection_replaced",
                              "Another session or a new key took over this OnePM agent", retryable=False)
        await self._notify_fatal_error()

    # ── Inbound ──────────────────────────────────────────────────────────

    async def _drain_loop(self) -> None:
        while True:
            await self._wake.wait()
            self._wake.clear()
            try:
                await self._drain_once()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning("OnePM: couldn't read events: %s", error)
                await asyncio.sleep(DRAIN_RETRY_SECONDS)
                self._wake.set()

    async def _drain_once(self) -> None:
        while page := await self._client.events(self._sequence):
            for event in page:
                try:
                    await self._handle_event(event)
                except OnepmError as error:
                    # A task or comment the key can no longer read: skip it rather than stall.
                    if error.status >= 500 or is_rate_limited(error):
                        raise
                    logger.warning("OnePM: skipping event %s: %s", event.get("id"), error)
                self._sequence = event["sequence"]
                self._cursor.write(self._sequence)

    async def _handle_event(self, event: dict) -> None:
        if not is_request(event, self.agent_id) or self._refuses_sender(event):
            return
        inbound = await self._inbound_for(event)
        if inbound is None or self._dedup.is_duplicate(inbound.message_id):
            return
        self._chat_names[inbound.chat_id] = inbound.chat_name
        await self._dispatch(inbound)

    def _refuses_sender(self, event: dict) -> bool:
        """Whether Hermes's allowlist would refuse the sender, asked before the task or comment is
        read so a refused user can't make the agent fetch anything. The check is the one the
        gateway registers (set_authorization_check); with no actor or no check, handle_message
        decides as before. A trigger has no sender to check: OnePM sent it."""
        actor_id = event.get("actorId")
        if not actor_id or is_trigger(event):
            return False
        if borrows_owner(event, self._self_info.get("ownerId")):
            logger.warning("OnePM: dropped an agent's event named as the owner (%s)", actor_id)
            return True
        refused = sender_authorized(
            self, str(actor_id), "group", str(event["taskId"]), is_bot=is_agent_actor(event)) is False
        if refused:
            # handle_message logs this for other platforms; the refusal here comes first, so say
            # it here: it's how the owner finds an id to add to ONEPM_ALLOWED_USERS.
            logger.warning("Unauthorized user: %s (%s) on onepm", actor_id, event.get("actorName") or "?")
        return refused

    async def _inbound_for(self, event: dict) -> Optional[Inbound]:
        task_id = str(event["taskId"])
        task = await self._client.task(task_id) if needs_task(event) else None
        comment = None
        if needs_comment(event):
            comment = find_comment(await self._client.comments(task_id), event.get("commentId"))
            if comment and comment.get("userId") == self.agent_id:
                return None
        return to_inbound(event, task, comment, self._self_info.get("projectSlug"))

    async def _dispatch(self, inbound: Inbound) -> None:
        source = self.build_source(
            chat_id=inbound.chat_id, chat_name=inbound.chat_name, chat_type="group",
            user_id=inbound.user_id, user_name=inbound.user_name, is_bot=inbound.is_bot,
            message_id=inbound.message_id, role_authorized=inbound.trusted)
        extra = {}
        if self._project_sync is not None and _HAS_CHANNEL_PROMPT:
            # Throttled, and never holds the message up for long: a slow read or clone finishes later.
            await self._project_sync.ensure_fresh()
            # An ephemeral system prompt: sent with each turn but kept out of the transcript.
            extra["channel_prompt"] = self._project_sync.summary()
        await self.handle_message(MessageEvent(
            text=inbound.text, message_type=MessageType.TEXT, source=source,
            message_id=inbound.message_id, timestamp=inbound.timestamp, **extra))

    # ── Outbound ─────────────────────────────────────────────────────────

    async def send(self, chat_id: str, content: str, reply_to: Optional[str] = None,
                   metadata: Optional[Dict[str, Any]] = None) -> SendResult:
        if chat_id == NO_HOME_CHANNEL:
            return SendResult(success=False, error="No OnePM home channel is set", retryable=False)
        if self._client is None:
            return SendResult(success=False, error="Not connected", retryable=True)
        text = mask_secrets(content, [self._api_key])
        try:
            comment = await self._client.post_comment(chat_id, text)
        except OnepmError as error:
            if is_rate_limited(error):
                return SendResult(success=False, error="OnePM rate limited this agent's replies")
            return SendResult(success=False, error=str(error), retryable=error.status >= 500)
        except (aiohttp.ClientError, asyncio.TimeoutError) as error:
            return SendResult(success=False, error=str(error), retryable=True)
        comment_id = comment.get("id") if isinstance(comment, dict) else None
        # OnePM ends "replying" when the comment lands; a refresh already on
        # its way could bring it back, so say so too.
        self._replied.add(chat_id)
        if self._busy_marked.pop(chat_id, None) is not None:
            await self._set_busy(chat_id, False)
        return SendResult(success=True, message_id=str(comment_id) if comment_id else None)

    async def _set_busy(self, chat_id: str, busy: bool) -> None:
        if not self._busy_supported or self._client is None:
            return
        try:
            await self._client.set_busy(chat_id, busy)
        except OnepmError as error:
            if is_not_found(error):
                # An older OnePM without the busy route: stop asking.
                self._busy_supported = False
                logger.info("OnePM: this server can't show the agent replying; skipping that")
            elif not is_rate_limited(error):
                logger.debug("OnePM: couldn't mark %s busy=%s: %s", chat_id, busy, error)
        except (aiohttp.ClientError, asyncio.TimeoutError) as error:
            logger.debug("OnePM: couldn't mark %s busy=%s: %s", chat_id, busy, error)

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        """Shows the agent replying on the task, refreshed every BUSY_REFRESH_SECONDS."""
        if chat_id == NO_HOME_CHANNEL or chat_id in self._replied:
            return
        last = self._busy_marked.get(chat_id)
        now = self._now()
        if last is not None and now - last < BUSY_REFRESH_SECONDS:
            return
        self._busy_marked[chat_id] = now
        await self._set_busy(chat_id, True)

    async def stop_typing(self, chat_id: str) -> None:
        """The turn ended: no longer replying there."""
        self._replied.discard(chat_id)
        if self._busy_marked.pop(chat_id, None) is not None:
            await self._set_busy(chat_id, False)

    async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:
        name = self._chat_names.get(chat_id)
        if name is None and self._client is not None:
            with contextlib.suppress(Exception):
                task = await self._client.task(chat_id)
                name = chat_name(task_key(task, self._self_info.get("projectSlug")), task.get("title"), chat_id)
                self._chat_names[chat_id] = name
        return {"name": name or chat_id, "type": "group", "chat_id": chat_id}


# ── Plugin registration ──────────────────────────────────────────────────

def check_requirements() -> bool:
    """aiohttp ships with Hermes; configured means the agent key is set (the URL has a default)."""
    return all(_settings())


def validate_config(config) -> bool:
    return all(_settings())


def is_connected(config) -> bool:
    return validate_config(config)


def _env_enablement() -> Optional[dict]:
    url, key = _settings()
    return {"url": url} if url and key else None


def register(ctx):
    os.environ.setdefault(HOME_CHANNEL_ENV, NO_HOME_CHANNEL)
    ctx.register_platform(
        name=PLATFORM_NAME,
        label=PLATFORM_LABEL,
        adapter_factory=OnepmAdapter,
        check_fn=check_requirements,
        validate_config=validate_config,
        is_connected=is_connected,
        required_env=[KEY_ENV],
        install_hint="No extra packages needed (aiohttp ships with Hermes)",
        env_enablement_fn=_env_enablement,
        allowed_users_env=ALLOWED_USERS_ENV,
        allow_all_env=ALLOW_ALL_ENV,
        max_message_length=MAX_COMMENT_LENGTH,
        emoji="📋",
        platform_hint=PLATFORM_HINT,
        **display_kwargs(DISPLAY_TIER),
    )
