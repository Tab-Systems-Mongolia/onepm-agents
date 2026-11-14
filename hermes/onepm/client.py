"""The OnePM HTTP API, as an agent key sees it."""

from typing import Any, Optional
from urllib.parse import quote

import aiohttp

from .constants import HTTP_TIMEOUT_SECONDS, KEY_HEADER, NOT_FOUND_STATUS, RATE_LIMITED_STATUS


class OnepmError(Exception):
    def __init__(self, method: str, path: str, status: int):
        super().__init__(f"{method} {path}: {status}")
        self.status = status


class OnepmClient:
    def __init__(self, session: aiohttp.ClientSession, base_url: str, api_key: str):
        self._session = session
        self.base_url = base_url
        self._headers = {KEY_HEADER: api_key, "content-type": "application/json"}

    async def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        async with self._session.request(
            method, f"{self.base_url}/api{path}", json=body, headers=self._headers,
            timeout=aiohttp.ClientTimeout(total=HTTP_TIMEOUT_SECONDS),
        ) as response:
            if response.status >= 400:
                raise OnepmError(method, path, response.status)
            return await response.json(content_type=None)

    async def self_info(self) -> dict:
        return await self._request("GET", "/project-agent/self")

    async def events(self, after: Optional[int]) -> list:
        query = "" if after is None else f"?after={after}"
        return await self._request("GET", f"/project-agent/events{query}")

    async def task(self, task_id: str) -> dict:
        return await self._request("GET", f"/task/{quote(task_id, safe='')}")

    async def comments(self, task_id: str) -> list:
        return await self._request("GET", f"/comment/{quote(task_id, safe='')}")

    async def post_comment(self, task_id: str, content: str) -> dict:
        return await self._request("POST", f"/comment/{quote(task_id, safe='')}", {"content": content})

    async def set_busy(self, task_id: str, busy: bool) -> dict:
        """Shows people the agent is writing a reply on the task."""
        return await self._request("POST", "/project-agent/busy", {"taskId": task_id, "busy": busy})


def is_rate_limited(error: Exception) -> bool:
    return isinstance(error, OnepmError) and error.status == RATE_LIMITED_STATUS


def is_not_found(error: Exception) -> bool:
    return isinstance(error, OnepmError) and error.status == NOT_FOUND_STATUS
