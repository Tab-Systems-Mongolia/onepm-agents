"""Reads the agent's project now and then, clones its missing repositories, and summarises it.

A read runs in the background at most once per interval. An event waits a few
seconds at most for the project to be read, never for git, then is delivered
with whatever summary there is, so a slow server or clone never holds up a reply.
"""

import asyncio
import contextlib
import logging
import time
from typing import Callable, Optional

from .constants import CONTEXT_MAX_REPOSITORIES, PROJECT_SYNC_INTERVAL_SECONDS, PROJECT_SYNC_WAIT_SECONDS
from .project_context import RepositoryEntry, format_project_context, one_line
from .repo_clones import RepositoryClones, repository_names

logger = logging.getLogger(__name__)


class ProjectSync:
    def __init__(self, client, self_info: dict, clones: RepositoryClones, sandbox_root: Optional[str], *,
                 interval: float = PROJECT_SYNC_INTERVAL_SECONDS, wait: float = PROJECT_SYNC_WAIT_SECONDS,
                 now: Callable[[], float] = time.monotonic):
        self._client = client
        self._self_info = self_info
        self._clones = clones
        self._sandbox_root = sandbox_root.rstrip("/") if sandbox_root else None
        self._interval = interval
        self._wait = wait
        self._now = now
        self._started_at: Optional[float] = None
        self._task: Optional[asyncio.Task] = None
        self._read_done: Optional[asyncio.Event] = None
        self._loaded = False
        self._project: Optional[dict] = None
        self._columns: Optional[list] = None
        self._repositories: Optional[list] = None

    def start(self) -> None:
        """Starts a read in the background when one is due and none is running."""
        if self._task is not None and not self._task.done():
            return
        now = self._now()
        if self._started_at is not None and now - self._started_at < self._interval:
            return
        self._started_at = now
        self._read_done = asyncio.Event()
        self._task = asyncio.create_task(self._refresh(self._read_done))

    async def ensure_fresh(self) -> None:
        """Starts a read when due, and waits for the project to be read (not for the clones),
        but no longer than the short wait."""
        self.start()
        if self._read_done is not None and not self._read_done.is_set():
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._read_done.wait(), self._wait)

    async def close(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        self._task = None

    def summary(self) -> Optional[str]:
        """The project summary for the agent, or None before the first read finishes."""
        if not self._loaded:
            return None
        entries = None if self._repositories is None else [self._entry(repo) for repo in self._repositories]
        return format_project_context(self._self_info, self._project, self._columns, entries)

    def _entry(self, repository: dict) -> RepositoryEntry:
        owner, name = repository.get("repositoryOwner"), repository.get("repositoryName")
        if repository_names(repository) is None or not self._clones.is_cloned(owner, name):
            return RepositoryEntry(owner, name, None)
        if self._sandbox_root:
            return RepositoryEntry(owner, name, f"{self._sandbox_root}/{self._clones.path_for(owner, name).name}")
        return RepositoryEntry(owner, name, str(self._clones.path_for(owner, name)))

    async def _refresh(self, read_done: asyncio.Event) -> None:
        try:
            await self._read_project()
        except Exception as error:
            logger.warning("OnePM: couldn't read the project: %s", error)
        # The summary is ready once the project is read; clones can take a while longer.
        self._loaded = True
        read_done.set()
        try:
            await self._sync_clones()
        except Exception as error:
            logger.warning("OnePM: couldn't update the repository clones: %s", error)

    async def _read_project(self) -> None:
        project_id = str(self._self_info.get("projectId") or "")
        if not project_id:
            return
        project, columns, repositories = await asyncio.gather(
            self._client.project(project_id), self._client.columns(project_id),
            self._client.repositories(project_id), return_exceptions=True)
        # A piece that couldn't be read keeps its last value.
        for label, value in (("project", project), ("statuses", columns), ("repositories", repositories)):
            if isinstance(value, BaseException):
                logger.warning("OnePM: couldn't read the project's %s: %s", label, value)
        if isinstance(project, dict):
            self._project = project
        if isinstance(columns, list):
            self._columns = columns
        if isinstance(repositories, list):
            self._repositories = [repo for repo in repositories if isinstance(repo, dict)]

    async def _sync_clones(self) -> None:
        for repository in (self._repositories or [])[:CONTEXT_MAX_REPOSITORIES]:
            names = repository_names(repository)
            if names is None:
                logger.warning("OnePM: not cloning a repository with an unusual name: %r", one_line(
                    f"{repository.get('repositoryOwner')}/{repository.get('repositoryName')}"))
                continue
            await self._clones.sync(*names)
