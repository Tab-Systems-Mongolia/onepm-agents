import asyncio
import os
import tempfile
import unittest
from pathlib import Path

from gateway.config import Platform, PlatformConfig
from gateway.platform_registry import PlatformEntry, platform_registry

from onepm import adapter as onepm_adapter
from onepm.client import OnepmError
from onepm.constants import REDACTED
from onepm.cursor import CursorStore

KEY = "opm_" + "s" * 24


class _Ctx:
    """The part of Hermes's plugin context register() uses."""

    def register_platform(self, **kwargs):
        platform_registry.register(PlatformEntry(source="plugin", **kwargs))


class _FakeClient:
    def __init__(self, events, comments=(), task=None):
        self.pages = [list(events), []]
        self._comments = list(comments)
        self._task = task or {"title": "Fix login", "number": 12}
        self.posted = []
        self.post_error = None
        self.fetched = []

    async def events(self, after):
        return self.pages.pop(0) if self.pages else []

    async def task(self, task_id):
        self.fetched.append(("task", task_id))
        return self._task

    async def comments(self, task_id):
        self.fetched.append(("comments", task_id))
        return self._comments

    async def post_comment(self, task_id, content):
        if self.post_error:
            raise self.post_error
        self.posted.append((task_id, content))
        return {"id": "c-new"}


def _event(**fields):
    return {"sequence": 1, "id": "ev-1", "kind": "comment", "taskId": "task-1", "commentId": "c-1",
            "actorId": "user-1", "actorSource": "browser", "createdAt": "2026-11-14T10:00:00Z", **fields}


class AdapterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        onepm_adapter.register(_Ctx())

    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        os.environ.update(ONEPM_URL="https://pm.example.com/", ONEPM_AGENT_KEY=KEY)
        self.adapter = onepm_adapter.OnepmAdapter(PlatformConfig(enabled=True))
        self.adapter._self_info = {"id": "agent-1", "handle": "bot", "projectSlug": "onepm"}
        self.adapter._cursor = CursorStore(Path(self._dir.name) / "cursor.json", "u", "agent-1")
        self.adapter._sequence = 0
        self.received = []

        async def capture(event):
            self.received.append(event)

        self.adapter.handle_message = capture

    def tearDown(self):
        self._dir.cleanup()
        for name in ("ONEPM_URL", "ONEPM_AGENT_KEY"):
            os.environ.pop(name, None)

    def test_registers_the_onepm_platform(self):
        self.assertTrue(platform_registry.is_registered("onepm"))
        self.assertEqual(self.adapter.platform, Platform("onepm"))
        self.assertEqual(self.adapter.base_url, "https://pm.example.com")

    def test_url_defaults_to_the_hosted_onepm(self):
        os.environ.pop("ONEPM_URL", None)
        adapter = onepm_adapter.OnepmAdapter(PlatformConfig(enabled=True))
        self.assertEqual(adapter.base_url, "https://onepm.tabsystems.tech")
        self.assertTrue(onepm_adapter.validate_config(None))
        self.assertEqual(platform_registry.get("onepm").required_env, ["ONEPM_AGENT_KEY"])

    def test_the_key_is_still_required(self):
        os.environ.pop("ONEPM_AGENT_KEY", None)
        self.assertFalse(onepm_adapter.validate_config(None))

    def test_no_home_channel_notice_is_posted_on_tasks(self):
        # Hermes posts a "no home channel" notice into the first chat unless
        # ONEPM_HOME_CHANNEL is set; on OnePM that chat is a public task.
        self.assertEqual(os.environ.get("ONEPM_HOME_CHANNEL"), "off")
        self.adapter._client = _FakeClient([], [])
        result = asyncio.run(self.adapter.send("off", "cron result"))
        self.assertFalse(result.success)
        self.assertEqual(self.adapter._client.posted, [])

    def test_a_comment_event_becomes_a_message_event(self):
        comment = {"id": "c-1", "content": "@bot look?", "userId": "user-1", "user": {"name": "Saraa"}}
        self.adapter._client = _FakeClient([_event()], [comment])
        asyncio.run(self.adapter._drain_once())
        (event,) = self.received
        self.assertEqual(event.text, "@bot look?")
        self.assertEqual(event.message_id, "c-1")
        self.assertEqual(event.source.chat_id, "task-1")
        self.assertEqual(event.source.chat_name, "ONEPM-12 Fix login")
        self.assertEqual(event.source.chat_type, "group")
        self.assertEqual((event.source.user_id, event.source.user_name), ("user-1", "Saraa"))
        self.assertEqual(self.adapter._cursor.read(), 1)

    def test_own_and_release_events_are_skipped_but_advance_the_cursor(self):
        events = [_event(sequence=1, actorId="agent-1"), _event(sequence=2, id="ev-2", kind="finished"),
                  _event(sequence=3, id="ev-3", commentId="c-3")]
        own = {"id": "c-3", "content": "my reply", "userId": "agent-1"}
        self.adapter._client = _FakeClient(events, [own])
        asyncio.run(self.adapter._drain_once())
        self.assertEqual(self.received, [])
        self.assertEqual(self.adapter._cursor.read(), 3)

    def test_the_same_comment_twice_is_delivered_once(self):
        events = [_event(sequence=1, kind="mention", text="hi"), _event(sequence=2, id="ev-2", text="hi")]
        self.adapter._client = _FakeClient(events)
        asyncio.run(self.adapter._drain_once())
        self.assertEqual(len(self.received), 1)

    def test_a_sender_hermes_would_refuse_is_skipped_before_anything_is_fetched(self):
        checks = []

        def allowlist(user_id, chat_type=None, chat_id=None, **extra):
            checks.append((user_id, chat_type, chat_id, extra))
            return user_id == "user-2"

        self.adapter.set_authorization_check(allowlist)
        events = [_event(sequence=1, actorSource="agent"),
                  _event(sequence=2, id="ev-2", commentId="c-2", actorId="user-2")]
        comment = {"id": "c-2", "content": "@bot hi", "userId": "user-2", "user": {"name": "Bat"}}
        client = self.adapter._client = _FakeClient(events, [comment])
        asyncio.run(self.adapter._drain_once())
        self.assertEqual(checks, [("user-1", "group", "task-1", {"is_bot": True}),
                                  ("user-2", "group", "task-1", {})])
        self.assertEqual(client.fetched, [("task", "task-1"), ("comments", "task-1")])
        self.assertEqual([event.source.user_id for event in self.received], ["user-2"])
        self.assertEqual(self.adapter._cursor.read(), 2)

    def test_a_refused_sender_is_logged_with_their_id_so_it_can_be_allowlisted(self):
        self.adapter.set_authorization_check(lambda *args, **kwargs: False)
        self.adapter._client = _FakeClient([_event(sequence=1, actorId="user-9", actorName="Robin")])
        with self.assertLogs("onepm.adapter", level="WARNING") as logs:
            asyncio.run(self.adapter._drain_once())
        self.assertEqual(logs.output,
                         ["WARNING:onepm.adapter:Unauthorized user: user-9 (Robin) on onepm"])

    def test_an_event_without_an_actor_is_still_fetched(self):
        self.adapter.set_authorization_check(lambda *args, **kwargs: False)
        comment = {"id": "c-1", "content": "@bot hi", "userId": "user-1", "user": {"name": "Saraa"}}
        client = self.adapter._client = _FakeClient([_event(actorId=None)], [comment])
        asyncio.run(self.adapter._drain_once())
        self.assertEqual(client.fetched, [("task", "task-1"), ("comments", "task-1")])
        self.assertEqual(len(self.received), 1)

    def test_a_trigger_is_delivered_past_the_allowlist_as_onepm(self):
        checks = []

        def allowlist(user_id, chat_type=None, chat_id=None, **extra):
            checks.append(user_id)
            return False

        self.adapter.set_authorization_check(allowlist)
        trigger = _event(kind="status", commentId=None, actorId="user-9", actorSource="trigger",
                         taskKey="ONEPM-12", taskTitle="Fix login",
                         status={"from": "In Progress", "to": "Test"})
        client = self.adapter._client = _FakeClient([trigger])
        asyncio.run(self.adapter._drain_once())
        self.assertEqual(checks, [])
        self.assertEqual(client.fetched, [])
        (event,) = self.received
        self.assertEqual(event.text, "This task moved from In Progress to Test.")
        self.assertEqual((event.source.user_id, event.source.user_name), ("onepm", "OnePM"))
        self.assertTrue(event.source.role_authorized)
        self.assertEqual(self.adapter._cursor.read(), 1)

    def test_a_person_is_never_vouched_for(self):
        comment = {"id": "c-1", "content": "@bot look?", "userId": "user-1", "user": {"name": "Saraa"}}
        self.adapter._client = _FakeClient([_event()], [comment])
        asyncio.run(self.adapter._drain_once())
        self.assertFalse(self.received[0].source.role_authorized)

    def test_an_unknown_kind_is_skipped(self):
        self.adapter._client = _FakeClient([_event(kind="review_requested", actorSource="trigger")])
        asyncio.run(self.adapter._drain_once())
        self.assertEqual(self.received, [])
        self.assertEqual(self.adapter._cursor.read(), 1)

    def test_an_unreadable_task_is_skipped(self):
        client = _FakeClient([_event(kind="assignment", commentId=None)])

        async def missing(task_id):
            raise OnepmError("GET", "/task/task-1", 404)

        client.task = missing
        self.adapter._client = client
        asyncio.run(self.adapter._drain_once())
        self.assertEqual(self.received, [])
        self.assertEqual(self.adapter._cursor.read(), 1)

    def test_send_posts_a_masked_comment(self):
        client = self.adapter._client = _FakeClient([])
        result = asyncio.run(self.adapter.send("task-1", f"done, key {KEY} and ghp_{'a' * 30}"))
        self.assertTrue(result.success)
        self.assertEqual(result.message_id, "c-new")
        self.assertEqual(client.posted, [("task-1", f"done, key {REDACTED} and {REDACTED}")])

    def test_send_reports_a_rate_limit(self):
        client = self.adapter._client = _FakeClient([])
        client.post_error = OnepmError("POST", "/comment/task-1", 429)
        result = asyncio.run(self.adapter.send("task-1", "hi"))
        self.assertFalse(result.success)
        self.assertFalse(result.retryable)
        self.assertIn("rate limited", result.error)


if __name__ == "__main__":
    unittest.main()
