"""Keeps a clone of each of the project's repositories: clone what's missing, fetch what's there.

A clone that exists is only ever fetched. Nothing here resets, checks out,
pulls or otherwise touches a working tree, so the agent's local work is safe.
"""

import asyncio
import contextlib
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Awaitable, Callable, NamedTuple, Optional, Sequence

from .constants import (
    GIT_CLONE_TIMEOUT_SECONDS, GIT_ERROR_MAX_LENGTH, GIT_FETCH_TIMEOUT_SECONDS, GIT_SSH_COMMAND, REPOSITORY_NAME_MAX_LENGTH,
    REPOSITORY_NAME_PATTERN,
)
from .masking import mask_secrets

logger = logging.getLogger(__name__)

_NAME = re.compile(REPOSITORY_NAME_PATTERN)


class GitResult(NamedTuple):
    code: int
    stderr: str


# (args after "git", timeout) -> result; raises asyncio.TimeoutError on a timeout.
GitRunner = Callable[[Sequence[str], float], Awaitable[GitResult]]


def is_plain_name(value) -> bool:
    """A GitHub owner or repository name safe to put in a path and a URL."""
    return (isinstance(value, str) and len(value) <= REPOSITORY_NAME_MAX_LENGTH and _NAME.fullmatch(value) is not None
            and ".." not in value and value != "." and not value.startswith("-"))


def repository_names(repository: dict) -> Optional[tuple[str, str]]:
    owner, name = repository.get("repositoryOwner"), repository.get("repositoryName")
    return (owner, name) if is_plain_name(owner) and is_plain_name(name) else None


def clone_url(template: str, owner: str, name: str) -> str:
    return template.replace("{owner}", owner).replace("{repo}", name)


def _git_env() -> dict:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    env.setdefault("GIT_SSH_COMMAND", GIT_SSH_COMMAND)
    return env


async def run_git(args: Sequence[str], timeout: float) -> GitResult:
    process = await asyncio.create_subprocess_exec(
        "git", *args, env=_git_env(), stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        with contextlib.suppress(ProcessLookupError):
            process.kill()
        with contextlib.suppress(Exception):
            await asyncio.wait_for(process.wait(), timeout=5)
        raise
    return GitResult(process.returncode, stderr.decode(errors="replace"))


def _last_line(text: str, url: str, label: str) -> str:
    # The URL may carry a token from ONEPM_GIT_URL_TEMPLATE.
    lines = [line for line in (text.replace(url, label) if url else text).splitlines() if line.strip()]
    return mask_secrets(lines[-1].strip() if lines else "")[:GIT_ERROR_MAX_LENGTH]


class RepositoryClones:
    def __init__(self, workspace: Path, url_template: str, git: GitRunner = run_git):
        self.workspace = workspace
        self._url_template = url_template
        self._git = git

    def path_for(self, owner: str, name: str) -> Path:
        return self.workspace / owner / name

    def is_cloned(self, owner: str, name: str) -> bool:
        return (self.path_for(owner, name) / ".git").exists()

    async def sync(self, owner: str, name: str) -> None:
        """Clones the repository when it's missing, otherwise fetches it. Failures are logged."""
        path = self.path_for(owner, name)
        label = f"{owner}/{name}"
        if self.is_cloned(owner, name):
            await self._run(label, "", ["-C", str(path), "fetch", "--prune", "--quiet", "origin"],
                            GIT_FETCH_TIMEOUT_SECONDS, "fetch")
        elif path.exists():
            logger.warning("OnePM: %s exists and isn't a git clone; leaving it alone", path)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            url = clone_url(self._url_template, owner, name)
            if not await self._run(label, url, ["clone", "--quiet", "--", url, str(path)],
                                   GIT_CLONE_TIMEOUT_SECONDS, "clone"):
                # Only what this clone created: the path didn't exist before it.
                shutil.rmtree(path, ignore_errors=True)

    async def _run(self, label: str, url: str, args: list, timeout: float, action: str) -> bool:
        try:
            result = await self._git(args, timeout)
        except asyncio.TimeoutError:
            logger.warning("OnePM: git %s of %s timed out after %ss", action, label, int(timeout))
            return False
        except OSError as error:
            logger.warning("OnePM: couldn't run git %s for %s: %s", action, label, error.strerror or error)
            return False
        if result.code != 0:
            logger.warning("OnePM: git %s of %s failed (exit %s): %s", action, label, result.code,
                           _last_line(result.stderr, url, label))
            return False
        logger.info("OnePM: %s %s", "cloned" if action == "clone" else "fetched", label)
        return True
