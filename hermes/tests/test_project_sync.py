import asyncio
import tempfile
import unittest
from pathlib import Path

from onepm.client import OnepmError
from onepm.project_sync import ProjectSync
from onepm.repo_clones import RepositoryClones
from test_repo_clones import TEMPLATE, FakeGit

SELF = {"id": "agent-1", "projectId": "p-1", "projectSlug": "OPM", "handle": "bot"}


def _repo(owner, name):
    return {"id": f"{owner}-{name}", "repositoryOwner": owner, "repositoryName": name, "isActive": True}


class FakeProjectClient:
    def __init__(self, repositories=(), hang=False):
        self.repos = list(repositories)
        self.reads = 0
        self.hang = hang
        self.columns_error = None

    async def project(self, project_id):
        self.reads += 1
        if self.hang:
            await asyncio.Event().wait()
        return {"id": project_id, "name": "OnePM", "slug": "OPM"}

    async def columns(self, project_id):
        if self.columns_error:
            raise self.columns_error
        return [{"slug": "to-do", "name": "To do"}, {"slug": "done", "name": "Done", "isFinal": True}]

    async def repositories(self, project_id):
        return self.repos


class Clock:
    def __init__(self):
        self.value = 1000.0

    def __call__(self):
        return self.value


class ProjectSyncTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.workspace = Path(self._dir.name) / "repos"
        self.git = FakeGit()
        self.clock = Clock()

    def tearDown(self):
        self._dir.cleanup()

    def _sync(self, client, sandbox="/workspace/projects", wait=1.0):
        clones = RepositoryClones(self.workspace, TEMPLATE, self.git)
        return ProjectSync(client, SELF, clones, sandbox, interval=300, wait=wait, now=self.clock)

    def test_clones_missing_repositories_and_leaves_present_ones_alone(self):
        (self.workspace / "acme__old" / ".git").mkdir(parents=True)
        sync = self._sync(FakeProjectClient([_repo("acme", "new"), _repo("acme", "old")]))

        async def run():
            sync.start()
            await sync._task

        asyncio.run(run())
        self.assertEqual(len(self.git.calls), 1)
        self.assertIn("clone", self.git.calls[0])
        self.assertTrue((self.workspace / "acme__new" / ".git").is_dir())
        summary = sync.summary()
        self.assertIn('"acme/new" at "/workspace/projects/acme__new", "acme/old" at "/workspace/projects/acme__old"',
                      summary)
        self.assertIn('"done" "Done" (final)', summary)

    def test_without_a_sandbox_path_the_agent_gets_the_host_path(self):
        sync = self._sync(FakeProjectClient([_repo("acme", "api")]), sandbox=None)

        async def run():
            sync.start()
            await sync._task

        asyncio.run(run())
        self.assertIn(f'"acme/api" at "{self.workspace / "acme__api"}"', sync.summary())

    def test_unusual_names_are_listed_but_never_cloned(self):
        client = FakeProjectClient([_repo("..", "x"), _repo("a", "b c"), _repo("acme", ".git"), _repo("acme", "api")])
        sync = self._sync(client)

        async def run():
            sync.start()
            await sync._task

        with self.assertLogs("onepm.project_sync", "WARNING"):
            asyncio.run(run())
        self.assertEqual(len(self.git.calls), 1)
        self.assertIn("git@github.com:acme/api.git", self.git.calls[0])
        self.assertIn('"../x" (no local copy)', sync.summary())
        self.assertIn('"a/b c" (no local copy)', sync.summary())
        self.assertIn('"acme/.git" (no local copy)', sync.summary())
        self.assertFalse((Path(self._dir.name) / "x").exists())

    def test_syncs_at_most_ten_repositories(self):
        sync = self._sync(FakeProjectClient([_repo("acme", f"r{index}") for index in range(12)]))

        async def run():
            sync.start()
            await sync._task

        asyncio.run(run())
        self.assertEqual(len(self.git.calls), 10)

    def test_reads_at_most_once_per_interval(self):
        client = FakeProjectClient()
        sync = self._sync(client)

        async def run():
            await sync.ensure_fresh()
            await sync._task
            await sync.ensure_fresh()
            self.clock.value += 299
            await sync.ensure_fresh()
            self.assertEqual(client.reads, 1)
            self.clock.value += 2
            await sync.ensure_fresh()
            await sync._task
            self.assertEqual(client.reads, 2)

        asyncio.run(run())

    def test_a_slow_read_does_not_hold_the_caller(self):
        sync = self._sync(FakeProjectClient(hang=True), wait=0.05)

        async def run():
            await asyncio.wait_for(sync.ensure_fresh(), timeout=1)
            self.assertIsNone(sync.summary())
            await sync.close()

        asyncio.run(run())

    def test_a_piece_that_fails_is_left_out(self):
        client = FakeProjectClient()
        client.columns_error = OnepmError("GET", "/column/p-1", 403)
        sync = self._sync(client)

        async def run():
            sync.start()
            await sync._task

        with self.assertLogs("onepm.project_sync", "WARNING"):
            asyncio.run(run())
        self.assertNotIn("statuses", sync.summary())
        self.assertIn("\nGitHub repositories: none\n", sync.summary())
