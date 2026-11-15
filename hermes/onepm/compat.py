"""Hermes APIs the plugin uses that older releases lack or keep elsewhere.

Hermes 0.21.0 has no ``gateway.platforms._shared`` or ``gateway.platforms.event``
module and no ``helpers.cancel_task``; later releases add them. Each import
falls back to the older equivalent, so one plugin runs on both.
"""

import asyncio
import contextlib
import os
from typing import Any, Optional

try:
    from gateway.platforms._shared import get_scoped_secret
except ImportError:  # Hermes before profile secret scopes: one profile per process.
    def get_scoped_secret(name: str, default: Any = None, **_: Any) -> Any:
        return os.getenv(name, default)

try:
    from gateway.platforms.event import MessageEvent, MessageType
except ImportError:
    from gateway.platforms.base import MessageEvent, MessageType

try:
    from gateway.platform_registry import PlatformEntry as _PlatformEntry
    _ENTRY_FIELDS = set(getattr(_PlatformEntry, "__dataclass_fields__", {}))
except ImportError:
    _ENTRY_FIELDS = set()


def display_kwargs(tier: str) -> dict:
    """``display_tier`` for ``register_platform``, left out where Hermes doesn't know it yet."""
    return {"display_tier": tier} if "display_tier" in _ENTRY_FIELDS else {}

try:
    from gateway.platforms.helpers import cancel_task
except ImportError:
    async def cancel_task(task: Optional[asyncio.Task]) -> None:
        """Cancel *task* and wait for it to unwind; a no-op for None or a finished task."""
        if task is None or task.done():
            return
        task.cancel()
        if task is not asyncio.current_task():
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

def sender_authorized(adapter: Any, user_id: str, chat_type: str, chat_id: str, *,
                      is_bot: bool) -> Optional[bool]:
    """``adapter._is_sender_authorized``, passing ``is_bot`` only where Hermes accepts it.

    Hermes 0.21.0 takes no ``is_bot``; there a bot sender is checked like a person.
    """
    if is_bot:
        try:
            return adapter._is_sender_authorized(user_id, chat_type, chat_id, is_bot=True)
        except TypeError:
            pass
    return adapter._is_sender_authorized(user_id, chat_type, chat_id)


__all__ = ["MessageEvent", "MessageType", "cancel_task", "get_scoped_secret", "sender_authorized"]
