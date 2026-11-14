import asyncio
import os
import tempfile
import unittest
from pathlib import Path

from onepm.constants import DEFAULT_GIT_SSH_COMMAND
from onepm.repo_clones import GitResult, RepositoryClones, clone_url, git_env, is_plain_name, repository_names

TEMPLATE = "git@github.com:{owner}/{repo}.git"
HARDENING = [
    "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=", "-c", "protocol.allow=never",
    "-c", "protocol.ssh.allow=always", "-c", "protocol.https.allow=always", "-c", "protocol.file.allow=never",
    "-c", "submodule.recurse=false", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=",
    "-c", "filter.lfs.required=false",
]


class FakeGit:
    """Records git commands; a clone makes the .git folder, as git would."""

    def __init__(self, code=0, stderr="", error=None):
        self.calls = []
        self.code = code
        self.stderr = stderr
        self.error = error

    async def __call__(self, args, timeout):
        self.calls.append(list(args))
        if self.error:
            raise self.error
        if "clone" in args:
            (Path(args[-1]) / ".git").mkdir(parents=True)
        return GitResult(self.code, self.stderr)


class NamesTest(unittest.TestCase):
    def test_accepts_github_names(self):
        for name in ("acme", "my-repo", "repo.js", "under_score", "A1", "git", "gitops", "a.github"):
            self.assertTrue(is_plain_name(name), name)

    def test_rejects_names_that_could_escape_or_inject(self):
        for name in ("..", ".", "../x", "a/b", "b c", "a..b", "-x", "", "x" * 101, None, "ä", "a\nb"):
            self.assertFalse(is_plain_name(name), repr(name))

    def test_rejects_names_git_could_take_for_its_own_metadata(self):
        for name in (".git", ".GIT", "foo.git", "foo.GiT", ".github", ".hidden", "-x"):
            self.assertFalse(is_plain_name(name), name)

    def test_repository_names_need_both_plain(self):
        self.assertEqual(repository_names({"repositoryOwner": "a", "repositoryName": "b"}), ("a", "b"))
        self.assertEqual(repository_names({"repositoryOwner": "a", "repositoryName": "b_c"}), ("a", "b_c"))
        self.assertIsNone(repository_names({"repositoryOwner": "..", "repositoryName": "x"}))
        self.assertIsNone(repository_names({"repositoryOwner": "a", "repositoryName": "b c"}))
        self.assertIsNone(repository_names({"repositoryOwner": "a/b", "repositoryName": "c"}))
        self.assertIsNone(repository_names({"repositoryOwner": "a", "repositoryName": ".git"}))

    def test_an_owner_never_has_an_underscore_so_the_flat_folder_name_is_unambiguous(self):
        # GitHub owners can't contain "_"; without the rule a_/b and a/_b would share a_ __b.
        self.assertIsNone(repository_names({"repositoryOwner": "a_", "repositoryName": "b"}))

    def test_clone_url_fills_the_template(self):
        self.assertEqual(clone_url(TEMPLATE, "acme", "api"), "git@github.com:acme/api.git")
        self.assertEqual(clone_url("https://github.com/{owner}/{repo}.git", "a", "b"), "https://github.com/a/b.git")


class GitEnvTest(unittest.TestCase):
    HOST = {"PATH": "/usr/bin", "HOME": "/home/hermes", "LANG": "C.UTF-8", "SSH_AUTH_SOCK": "/run/agent.sock",
            "AWS_SECRET_ACCESS_KEY": "nope", "ONEPM_AGENT_KEY": "nope", "GIT_DIR": "/elsewhere",
            "GIT_CONFIG_PARAMETERS": "'core.fsmonitor'='x'"}

    def test_keeps_only_what_ssh_needs_and_turns_off_git_config_files(self):
        self.assertEqual(git_env(self.HOST), {
            "PATH": "/usr/bin", "HOME": "/home/hermes", "LANG": "C.UTF-8", "SSH_AUTH_SOCK": "/run/agent.sock",
            "GIT_SSH_COMMAND": DEFAULT_GIT_SSH_COMMAND, "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_ATTR_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
        })

    def test_the_operators_ssh_command_wins(self):
        env = git_env({"PATH": "/bin", "GIT_SSH_COMMAND": "ssh -i /k -o BatchMode=yes"})
        self.assertEqual(env["GIT_SSH_COMMAND"], "ssh -i /k -o BatchMode=yes")
        self.assertNotIn("SSH_AUTH_SOCK", env)
        self.assertNotIn("HOME", env)


class ClonesTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.workspace = Path(self._dir.name) / "repos"
        self.staging = Path(self._dir.name) / "home" / "onepm" / "staging"

    def tearDown(self):
        self._dir.cleanup()

    def _clones(self, git, template=TEMPLATE):
        return RepositoryClones(self.workspace, template, git, staging=self.staging)

    def _sync(self, git, owner="acme", name="api"):
        clones = self._clones(git)
        asyncio.run(clones.sync(owner, name))
        return clones

    def _staged(self):
        return list(self.staging.iterdir()) if self.staging.exists() else []

    def test_clones_hardened_into_private_staging_then_moves_it_into_a_flat_folder(self):
        git = FakeGit()
        clones = self._sync(git)
        (call,) = git.calls
        self.assertEqual(call[:-1], [*HARDENING, "clone", "--quiet", "--no-recurse-submodules", "--",
                                     "git@github.com:acme/api.git"])
        clone_target = Path(call[-1])
        # The sandbox never sees the folder git writes to.
        self.assertTrue(clone_target.is_relative_to(self.staging))
        self.assertFalse(clone_target.is_relative_to(self.workspace))
        self.assertEqual(self.staging.stat().st_mode & 0o777, 0o700)
        self.assertEqual(clones.path_for("acme", "api"), self.workspace / "acme__api")
        self.assertTrue(clones.is_cloned("acme", "api"))
        self.assertEqual(self._staged(), [])

    def test_the_target_appears_only_after_the_clone_succeeds(self):
        target = self.workspace / "acme__api"
        seen = []

        class Watching(FakeGit):
            async def __call__(self, args, timeout):
                seen.append(os.path.lexists(target))
                return await super().__call__(args, timeout)

        self._sync(Watching())
        self.assertEqual(seen, [False])
        self.assertTrue((target / ".git").is_dir())

    def test_a_target_made_during_the_clone_is_left_alone_and_the_staged_copy_removed(self):
        target = self.workspace / "acme__api"

        class Racing(FakeGit):
            async def __call__(self, args, timeout):
                target.mkdir(parents=True)
                (target / "mine.txt").write_text("sandbox")
                return await super().__call__(args, timeout)

        with self.assertLogs("onepm.repo_clones", "WARNING"):
            self._sync(Racing())
        self.assertEqual([path.name for path in target.iterdir()], ["mine.txt"])
        self.assertEqual(self._staged(), [])

    def test_an_empty_target_made_during_the_clone_is_not_replaced(self):
        target = self.workspace / "acme__api"

        class Racing(FakeGit):
            async def __call__(self, args, timeout):
                target.mkdir(parents=True)
                return await super().__call__(args, timeout)

        with self.assertLogs("onepm.repo_clones", "WARNING"):
            self._sync(Racing())
        self.assertEqual(list(target.iterdir()), [])
        self.assertEqual(self._staged(), [])

    def test_staging_on_another_filesystem_falls_back_to_a_sibling_of_the_workspace(self):
        clones = self._clones(FakeGit())
        self.workspace.mkdir(parents=True)
        root = clones.staging_root(same_filesystem=lambda a, b: False)
        self.assertEqual(root, self.workspace.parent / ".repos-onepm-staging")
        self.assertFalse(root.is_relative_to(self.workspace))
        self.assertEqual(clones.staging_root(same_filesystem=lambda a, b: True), self.staging)

    def test_never_runs_git_in_a_clone_that_is_already_there(self):
        clone = self.workspace / "acme__api"
        (clone / ".git").mkdir(parents=True)
        # What a sandboxed agent could plant for the host's next git command.
        (clone / ".git" / "config").write_text("[core]\n\tfsmonitor = touch /tmp/pwned\n")
        git = FakeGit()
        with self.assertLogs("onepm.repo_clones", "DEBUG"):
            self._sync(git)
        self.assertEqual(git.calls, [])

    def test_never_runs_git_in_any_folder_or_link_at_the_path(self):
        folder = self.workspace / "acme__api"
        folder.mkdir(parents=True)
        (folder / "notes.txt").write_text("mine")
        (self.workspace / "acme__web").symlink_to(Path(self._dir.name))
        git = FakeGit()
        self._sync(git)
        self._sync(git, name="web")
        self.assertEqual(git.calls, [])
        self.assertEqual((folder / "notes.txt").read_text(), "mine")

    def test_a_failed_clone_is_logged_without_the_url_and_removed(self):
        git = FakeGit(code=128, stderr="Cloning...\nfatal: could not read from https://tok:opm_secretsecretsecret@x/acme/api\n")
        git_url = "https://tok:opm_secretsecretsecret@x/acme/api"
        clones = self._clones(git, git_url.replace("acme/api", "{owner}/{repo}"))
        with self.assertLogs("onepm.repo_clones", "WARNING") as logs:
            asyncio.run(clones.sync("acme", "api"))
        self.assertIn("exit 128", logs.output[0])
        self.assertNotIn("secret", logs.output[0])
        self.assertFalse(os.path.lexists(self.workspace / "acme__api"))
        self.assertEqual(self._staged(), [])

    def test_a_timeout_is_logged_and_leaves_nothing_behind(self):
        git = FakeGit(error=asyncio.TimeoutError())
        with self.assertLogs("onepm.repo_clones", "WARNING") as logs:
            self._sync(git)
        self.assertIn("timed out", logs.output[0])
        self.assertFalse(os.path.lexists(self.workspace / "acme__api"))
        self.assertEqual(self._staged(), [])

    def test_a_cancelled_clone_leaves_nothing_behind(self):
        git = FakeGit(error=asyncio.CancelledError())
        with self.assertRaises(asyncio.CancelledError):
            self._sync(git)
        self.assertEqual(self._staged(), [])

    def test_missing_git_is_logged(self):
        git = FakeGit(error=FileNotFoundError(2, "No such file or directory"))
        with self.assertLogs("onepm.repo_clones", "WARNING") as logs:
            self._sync(git)
        self.assertIn("couldn't run git", logs.output[0])
