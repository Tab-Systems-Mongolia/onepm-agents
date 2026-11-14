import unittest

from onepm.events import find_comment, is_request, needs_comment, needs_task, readable_text, to_inbound

AGENT = "agent-1"


def _event(**fields):
    return {"sequence": 3, "id": "ev-1", "kind": "comment", "taskId": "task-1", "commentId": "c-1",
            "actorId": "user-1", "actorSource": "browser", "createdAt": "2026-11-14T10:00:00.000Z", **fields}


TASK = {"title": "Fix login", "number": 12, "description": "It fails on Safari."}
COMMENT = {"id": "c-1", "content": "@bot can you look?", "userId": "user-1", "user": {"name": "Saraa"}}


class IsRequestTest(unittest.TestCase):
    def test_requests_are_mentions_assignments_and_comments(self):
        for kind in ("mention", "assignment", "comment"):
            self.assertTrue(is_request(_event(kind=kind), AGENT))
        for kind in ("finished", "unassigned", "other"):
            self.assertFalse(is_request(_event(kind=kind), AGENT))

    def test_the_agents_own_comments_are_skipped(self):
        self.assertFalse(is_request(_event(actorId=AGENT), AGENT))


class ToInboundTest(unittest.TestCase):
    def test_a_comment_from_an_older_server(self):
        inbound = to_inbound(_event(), TASK, COMMENT, "onepm")
        self.assertEqual(inbound.chat_id, "task-1")
        self.assertEqual(inbound.chat_name, "ONEPM-12 Fix login")
        self.assertEqual((inbound.user_id, inbound.user_name), ("user-1", "Saraa"))
        self.assertEqual(inbound.text, "@bot can you look?")
        self.assertEqual(inbound.message_id, "c-1")
        self.assertFalse(inbound.is_bot)
        self.assertEqual(inbound.timestamp.isoformat(), "2026-11-14T10:00:00+00:00")

    def test_fields_on_the_event_win_and_need_no_lookups(self):
        event = _event(actorName="Bat", taskTitle="Fix login", taskKey="OPM-12", text="please check")
        self.assertFalse(needs_task(event))
        self.assertFalse(needs_comment(event))
        inbound = to_inbound(event, None, None, None)
        self.assertEqual(inbound.chat_name, "OPM-12 Fix login")
        self.assertEqual((inbound.user_name, inbound.text), ("Bat", "please check"))

    def test_an_older_event_needs_the_task_and_comment(self):
        self.assertTrue(needs_task(_event()))
        self.assertTrue(needs_comment(_event()))

    def test_an_assignment_carries_the_task(self):
        event = _event(kind="assignment", commentId=None)
        self.assertFalse(needs_comment(event))
        inbound = to_inbound(event, TASK, None, "onepm")
        self.assertEqual(inbound.text, "You were assigned this task.\n\nFix login\n\nIt fails on Safari.")
        self.assertEqual(inbound.message_id, "ev-1")
        self.assertEqual(inbound.user_name, "user-1")

    def test_a_mention_in_the_description(self):
        inbound = to_inbound(_event(kind="mention", commentId=None), TASK, None, None)
        self.assertTrue(inbound.text.startswith("You were mentioned in this task."))
        self.assertEqual(inbound.chat_name, "Fix login")

    def test_a_deleted_comment_is_dropped(self):
        self.assertIsNone(to_inbound(_event(), TASK, None, "onepm"))

    def test_another_agent_is_marked_as_a_bot(self):
        self.assertTrue(to_inbound(_event(actorSource="agent"), TASK, COMMENT, None).is_bot)

    def test_without_a_title_the_chat_is_named_by_its_id(self):
        inbound = to_inbound(_event(text="hi"), None, None, None)
        self.assertEqual(inbound.chat_name, "task-1")


class ReadableTextTest(unittest.TestCase):
    def test_mentions_become_at_names(self):
        self.assertEqual(
            readable_text('<p><kaneo-mention id="a1" label="claude">@claude</kaneo-mention> look</p>'),
            "@claude look")
        self.assertEqual(readable_text('<kaneo-mention id="a1" label="@bat"></kaneo-mention>'), "@bat")
        self.assertEqual(readable_text('<kaneo-mention id="a1">Saraa</kaneo-mention>'), "@Saraa")
        self.assertEqual(readable_text('<kaneo-mention id="a1"></kaneo-mention> hi'), "@someone hi")

    def test_block_ends_and_breaks_become_lines(self):
        self.assertEqual(
            readable_text("<h2>Plan</h2><p>one<br>two<br/>three</p><ul><li>a</li><li>b</li></ul>"),
            "Plan\none\ntwo\nthree\na\nb")

    def test_other_tags_are_dropped_and_entities_decoded(self):
        self.assertEqual(
            readable_text('<p><strong>a &amp; b</strong> &lt;x&gt; &quot;q&quot; it&#39;s&nbsp;ok</p>'),
            "a & b <x> \"q\" it's ok")

    def test_blank_lines_collapse_and_ends_are_trimmed(self):
        self.assertEqual(readable_text("  <p>one</p><p></p><p></p><p></p><p>two</p>\n"), "one\n\ntwo")

    def test_plain_text_and_none(self):
        self.assertEqual(readable_text("@bot can you look?"), "@bot can you look?")
        self.assertEqual(readable_text(None), "")

    def test_the_inbound_message_reads_as_plain_text(self):
        html = '<p><kaneo-mention id="a1" label="bot">@bot</kaneo-mention> please &amp; thanks</p>'
        self.assertEqual(to_inbound(_event(text=html), TASK, None, None).text, "@bot please & thanks")
        comment = {**COMMENT, "content": html}
        self.assertEqual(to_inbound(_event(), TASK, comment, None).text, "@bot please & thanks")

    def test_a_comment_with_no_words_is_not_a_message(self):
        self.assertIsNone(to_inbound(_event(text="<p></p>"), TASK, {**COMMENT, "content": "<p><br></p>"}, None))


class FindCommentTest(unittest.TestCase):
    def test_finds_by_id(self):
        self.assertIs(find_comment([{"id": "x"}, COMMENT], "c-1"), COMMENT)
        self.assertIsNone(find_comment([{"id": "x"}], "c-1"))


if __name__ == "__main__":
    unittest.main()
