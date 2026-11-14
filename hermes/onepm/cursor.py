"""The last event sequence handled, kept on disk across gateway restarts."""

import json
import logging
import os
from pathlib import Path
from typing import Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

FetchEvents = Callable[[Optional[int]], Awaitable[list]]


class CursorStore:
    """One JSON file per Hermes home. A cursor written for another server or
    agent is ignored, so a new key starts fresh instead of skipping events."""

    def __init__(self, path: Path, url: str, agent_id: str):
        self.path = path
        self.identity = {"url": url, "agentId": agent_id}

    def read(self) -> Optional[int]:
        try:
            stored = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            logger.warning("OnePM: unreadable cursor at %s; starting from now", self.path)
            return None
        if not isinstance(stored, dict) or any(stored.get(k) != v for k, v in self.identity.items()):
            return None
        sequence = stored.get("sequence")
        return sequence if isinstance(sequence, int) and not isinstance(sequence, bool) else None

    def write(self, sequence: int) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        partial = self.path.with_suffix(".tmp")
        partial.write_text(json.dumps({**self.identity, "sequence": sequence}), encoding="utf-8")
        os.replace(partial, self.path)


async def skip_history(store: CursorStore, fetch_events: FetchEvents) -> int:
    """On the first start, page to the newest event so only new ones are answered."""
    existing = store.read()
    if existing is not None:
        return existing
    last = 0
    page = await fetch_events(None)
    while page:
        last = page[-1].get("sequence", last)
        page = await fetch_events(last)
    store.write(last)
    return last
