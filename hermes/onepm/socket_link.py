"""The agent WebSocket: it shows the agent as connected in OnePM and wakes
the event reader. Mirrors the 0.9 connector's socket handling."""

import asyncio
import contextlib
import json
import logging
import random
import time
from typing import Awaitable, Callable

import aiohttp

from .constants import (
    AGENT_EVENT_MESSAGE, CONNECTION_REPLACED_MESSAGE, KEY_HEADER, RECONNECT_JITTER, RECONNECT_MAX_SECONDS,
    RECONNECT_MIN_SECONDS, RECONNECT_STABLE_SECONDS, REPLACED_CLOSE_CODE, SOCKET_KEEPALIVE_MESSAGE,
    SOCKET_PATH, SOCKET_PING_SECONDS, SOCKET_WAKE_SECONDS,
)

logger = logging.getLogger(__name__)


def socket_url(base_url: str) -> str:
    return ("ws" + base_url[len("http"):] if base_url.startswith("http") else base_url) + SOCKET_PATH


def reconnect_delay(failures: int, rand: Callable[[], float] = random.random) -> float:
    """Exponential backoff with jitter, capped."""
    base = min(RECONNECT_MAX_SECONDS, RECONNECT_MIN_SECONDS * (2 ** max(0, failures - 1)))
    return base * (1 + RECONNECT_JITTER * (2 * rand() - 1))


def message_type(raw: str) -> str | None:
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    kind = parsed.get("type") if isinstance(parsed, dict) else None
    return kind if isinstance(kind, str) else None


async def _keepalive(ws: aiohttp.ClientWebSocketResponse, on_wake: Callable[[], None]) -> None:
    ticks_per_wake = max(1, round(SOCKET_WAKE_SECONDS / SOCKET_PING_SECONDS))
    tick = 0
    while not ws.closed:
        await asyncio.sleep(SOCKET_PING_SECONDS)
        tick += 1
        with contextlib.suppress(Exception):
            await ws.send_str(SOCKET_KEEPALIVE_MESSAGE)
        if tick % ticks_per_wake == 0:
            on_wake()


async def _session(ws: aiohttp.ClientWebSocketResponse, on_wake: Callable[[], None]) -> bool:
    """Read one open socket until it closes; True when another session replaced it."""
    keepalive = asyncio.create_task(_keepalive(ws, on_wake))
    replaced = False
    try:
        on_wake()
        async for message in ws:
            if message.type != aiohttp.WSMsgType.TEXT:
                continue
            kind = message_type(message.data)
            if kind == AGENT_EVENT_MESSAGE:
                on_wake()
            elif kind == CONNECTION_REPLACED_MESSAGE:
                replaced = True
    finally:
        keepalive.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await keepalive
    return replaced or ws.close_code == REPLACED_CLOSE_CODE


async def run_socket(session: aiohttp.ClientSession, base_url: str, api_key: str,
                     on_wake: Callable[[], None], on_replaced: Callable[[], Awaitable[None]]) -> None:
    """Keep the socket open, reconnecting with backoff, until replaced or cancelled."""
    url = socket_url(base_url)
    failures = 0
    while True:
        opened_at = None
        try:
            async with session.ws_connect(url, headers={KEY_HEADER: api_key},
                                          heartbeat=SOCKET_PING_SECONDS) as ws:
                opened_at = time.monotonic()
                logger.info("OnePM: socket connected")
                if await _session(ws, on_wake):
                    logger.warning("OnePM: replaced by another session or a new key; staying offline")
                    await on_replaced()
                    return
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.warning("OnePM: socket error: %s", error)
        stable = opened_at is not None and time.monotonic() - opened_at >= RECONNECT_STABLE_SECONDS
        failures = 1 if stable else failures + 1
        delay = reconnect_delay(failures)
        logger.info("OnePM: socket closed; reconnecting in %.1fs", delay)
        await asyncio.sleep(delay)
