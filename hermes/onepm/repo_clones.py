"""Clones each of the project's repositories once, into a folder the host has just made.

The clones live in a folder shared with the agent's sandbox, so the agent can
change anything in them, .git included. The host therefore never runs git in a
folder the sandbox can reach: an existing clone is skipped, and the agent keeps
it current itself. A new clone is made in a private staging folder (0700, never
mounted) and renamed into the workspace only once git has finished. The clone
gets a minimal environment and config that turns off hooks, fsmonitor,
submodules, LFS filters and transports other than ssh and https.
"""

import asyncio
import contextlib
import logging
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Awaitable, Callable, Mapping, NamedTuple, Optional, Sequence

from .constants import (
    CLONE_FOLDER_SEPARATOR, DEFAULT_GIT_SSH_COMMAND, GIT_CLONE_TIMEOUT_SECONDS, GIT_CONFIG_GLOBAL_ENV,
    GIT_ENV_PASSTHROUGH, GIT_ERROR_MAX_LENGTH, GIT_HARDENED_CONFIG, GIT_HARDENED_ENV, GIT_METADATA_SUFFIX,
    GIT_SSH_COMMAND_ENV, OWNER_FORBIDDEN_CHARACTER, REPOSITORY_NAME_FORBIDDEN_PREFIXES, REPOSITORY_NAME_MAX_LENGTH,
    REPOSITORY_NAME_PATTERN, SSH_AUTH_SOCK_ENV, STAGED_CLONE_NAME, STAGING_DIR_MODE, STAGING_SIBLING_SUFFIX,
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
    """A GitHub owner or repository name safe to put in a path and a URL, and never one git could
    take for its own metadata."""
    return (isinstance(value, str) and len(value) <= REPOSITORY_NAME_MAX_LENGTH and _NAME.fullmatch(value) is not None
            and ".." not in value and not value.startswith(REPOSITORY_NAME_FORBIDDEN_PREFIXES)
            and not value.lower().endswith(GIT_METADATA_SUFFIX))


def repository_names(repository: dict) -> Optional[tuple[str, str]]:
    owner, name = repository.get("repositoryOwner"), repository.get("repositoryName")
    if not (is_plain_name(owner) and is_plain_name(name)) or OWNER_FORBIDDEN_CHARACTER in owner:
        return None
    return owner, name


def clone_url(template: str, owner: str, name: str) -> str:
    return template.replace("{owner}", owner).replace("{repo}", name)


def git_env(environ: Mapping[str, str]) -> dict:
    """Only what git and ssh need. No git config file is read, so nothing in the host's config,
    or put there by someone else, changes what the clone runs."""
    env = {name: environ[name] for name in (*GIT_ENV_PASSTHROUGH, SSH_AUTH_SOCK_ENV) if environ.get(name)}
    env[GIT_SSH_COMMAND_ENV] = environ.get(GIT_SSH_COMMAND_ENV) or DEFAULT_GIT_SSH_COMMAND
    return {**env, **GIT_HARDENED_ENV, GIT_CONFIG_GLOBAL_ENV: os.devnull}


def hardened_config_args() -> list[str]:
    return [arg for setting in GIT_HARDENED_CONFIG for arg in ("-c", setting)]


async def run_git(args: Sequence[str], timeout: float) -> GitResult:
    process = await asyncio.create_subprocess_exec(
        "git", *args, env=git_env(os.environ), stdin=asyncio.subprocess.DEVNULL,
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


def _same_filesystem(first: Path, second: Path) -> bool:
    return first.stat().st_dev == second.stat().st_dev


class RepositoryClones:
    def __init__(self, workspace: Path, url_template: str, git: GitRunner = run_git, *,
                 staging: Optional[Path] = None):
        self.workspace = workspace
        self._url_template = url_template
        self._git = git
        self._staging = staging

    def path_for(self, owner: str, name: str) -> Path:
        return self.workspace / f"{owner}{CLONE_FOLDER_SEPARATOR}{name}"

    def is_cloned(self, owner: str, name: str) -> bool:
        return (self.path_for(owner, name) / ".git").exists()

    def _sibling_staging(self) -> Path:
        return self.workspace.parent / f".{self.workspace.name}{STAGING_SIBLING_SUFFIX}"

    def staging_root(self, same_filesystem: Callable[[Path, Path], bool] = _same_filesystem) -> Path:
        """Where git writes, out of the sandbox's sight. A rename into the workspace needs the same
        filesystem, so a staging folder elsewhere gives way to a sibling of the workspace."""
        if self._staging is not None:
            self._staging.mkdir(mode=STAGING_DIR_MODE, parents=True, exist_ok=True)
            if same_filesystem(self._staging, self.workspace):
                self._staging.chmod(STAGING_DIR_MODE)
                return self._staging
        root = self._sibling_staging()
        root.mkdir(mode=STAGING_DIR_MODE, exist_ok=True)
        root.chmod(STAGING_DIR_MODE)
        return root

    async def sync(self, owner: str, name: str) -> None:
        """Clones the repository when nothing is at its path yet. Anything already there, clone or
        not, is left to the agent. Failures are logged."""
        target = self.path_for(owner, name)
        label = f"{owner}/{name}"
        if os.path.lexists(target):
            logger.debug("OnePM: %s is already there; the agent keeps it current", target)
            return
        self.workspace.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(dir=self.staging_root()))
        try:
            staged = stage / STAGED_CLONE_NAME
            url = clone_url(self._url_template, owner, name)
            args = [*hardened_config_args(), "clone", "--quiet", "--no-recurse-submodules", "--", url, str(staged)]
            if await self._clone(label, url, args):
                self._move_into_place(staged, target, label)
        finally:
            # Whatever didn't make it into the workspace: a failed, timed-out or refused clone.
            shutil.rmtree(stage, ignore_errors=True)

    @staticmethod
    def _move_into_place(staged: Path, target: Path, label: str) -> None:
        try:
            # rename would replace an empty folder, and the sandbox may have made one meanwhile.
            if os.path.lexists(target):
                raise FileExistsError(target)
            os.rename(staged, target)
        except OSError as error:
            logger.warning("OnePM: %s appeared while cloning %s; leaving it alone (%s)", target, label,
                           error.strerror or type(error).__name__)
            return
        logger.info("OnePM: cloned %s", label)

    async def _clone(self, label: str, url: str, args: list) -> bool:
        try:
            result = await self._git(args, GIT_CLONE_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            logger.warning("OnePM: git clone of %s timed out after %ss", label, int(GIT_CLONE_TIMEOUT_SECONDS))
            return False
        except OSError as error:
            logger.warning("OnePM: couldn't run git clone for %s: %s", label, error.strerror or error)
            return False
        if result.code != 0:
            logger.warning("OnePM: git clone of %s failed (exit %s): %s", label, result.code,
                           _last_line(result.stderr, url, label))
            return False
        return True
