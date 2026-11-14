import asyncio
import tempfile
import unittest
from pathlib import Path

from onepm.repo_clones import GitResult, RepositoryClones, _git_env, clone_url, is_plain_name, repository_names

TEMPLATE = "git@github.com:{owner}/{repo}.git"


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
        if args[0] == "clone":
            (Path(args[-1]) / ".git").mkdir(parents=True)
        return GitResult(self.code, self.stderr)


class NamesTest(unittest.TestCase):
    def test_accepts_github_names(self):
        for name in ("acme", "my-repo", "repo.js", "under_score", ".github", "A1"):
            self.assertTrue(is_plain_name(name), name)

    def test_rejects_names_that_could_escape_or_inject(self):
        for name in ("..", ".", "../x", "a/b", "b c", "a..b", "-x", "", "x" * 101, None, "ä", "a\nb"):
            self.assertFalse(is_plain_name(name), repr(name))

    def test_repository_names_need_both_plain(self):
        self.assertEqual(repository_names({"repositoryOwner": "a", "repositoryName": "b"}), ("a", "b"))
        self.assertIsNone(repository_names({"repositoryOwner": "..", "repositoryName": "x"}))
        self.assertIsNone(repository_names({"repositoryOwner": "a", "repositoryName": "b c"}))
        self.assertIsNone(repository_names({"repositoryOwner": "a/b", "repositoryName": "c"}))

    def test_git_never_prompts(self):
        env = _git_env()
        self.assertEqual(env["GIT_TERMINAL_PROMPT"], "0")
        self.assertIn("GIT_SSH_COMMAND", env)

    def test_clone_url_fills_the_template(self):
        self.assertEqual(clone_url(TEMPLATE, "acme", "api"), "git@github.com:acme/api.git")
        self.assertEqual(clone_url("https://github.com/{owner}/{repo}.git", "a", "b"), "https://github.com/a/b.git")


class ClonesTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.workspace = Path(self._dir.name) / "repos"

    def tearDown(self):
        self._dir.cleanup()

    def _sync(self, git, owner="acme", name="api"):
        clones = RepositoryClones(self.workspace, TEMPLATE, git)
        asyncio.run(clones.sync(owner, name))
        return clones

    def test_clones_a_missing_repository_over_ssh(self):
        git = FakeGit()
        clones = self._sync(git)
        target = str(self.workspace / "acme" / "api")
        self.assertEqual(git.calls, [["clone", "--quiet", "--", "git@github.com:acme/api.git", target]])
        self.assertTrue(clones.is_cloned("acme", "api"))

    def test_only_fetches_a_repository_that_is_there(self):
        (self.workspace / "acme" / "api" / ".git").mkdir(parents=True)
        git = FakeGit()
        self._sync(git)
        target = str(self.workspace / "acme" / "api")
        self.assertEqual(git.calls, [["-C", target, "fetch", "--prune", "--quiet", "origin"]])
        for word in ("reset", "checkout", "pull", "clean", "merge"):
            self.assertNotIn(word, git.calls[0])

    def test_leaves_a_folder_that_is_not_a_clone_alone(self):
        folder = self.workspace / "acme" / "api"
        folder.mkdir(parents=True)
        (folder / "notes.txt").write_text("mine")
        git = FakeGit()
        with self.assertLogs("onepm.repo_clones", "WARNING"):
            self._sync(git)
        self.assertEqual(git.calls, [])
        self.assertEqual((folder / "notes.txt").read_text(), "mine")

    def test_a_failed_clone_is_logged_without_the_url_and_removed(self):
        git = FakeGit(code=128, stderr="Cloning...\nfatal: could not read from https://tok:opm_secretsecretsecret@x/acme/api\n")
        git_url = "https://tok:opm_secretsecretsecret@x/acme/api"
        clones = RepositoryClones(self.workspace, git_url.replace("acme/api", "{owner}/{repo}"), git)
        with self.assertLogs("onepm.repo_clones", "WARNING") as logs:
            asyncio.run(clones.sync("acme", "api"))
        self.assertIn("exit 128", logs.output[0])
        self.assertNotIn("secret", logs.output[0])
        self.assertFalse((self.workspace / "acme" / "api").exists())

    def test_a_timeout_is_logged_and_does_not_raise(self):
        git = FakeGit(error=asyncio.TimeoutError())
        with self.assertLogs("onepm.repo_clones", "WARNING") as logs:
            self._sync(git)
        self.assertIn("timed out", logs.output[0])

    def test_missing_git_is_logged(self):
        git = FakeGit(error=FileNotFoundError(2, "No such file or directory"))
        with self.assertLogs("onepm.repo_clones", "WARNING") as logs:
            self._sync(git)
        self.assertIn("couldn't run git", logs.output[0])
