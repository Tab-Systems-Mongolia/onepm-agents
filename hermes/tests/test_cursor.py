import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from onepm.cursor import CursorStore, skip_history


def _store(directory: str, url="https://pm.example.com", agent_id="agent-1") -> CursorStore:
    return CursorStore(Path(directory) / "onepm" / "cursor.json", url, agent_id)


class CursorStoreTest(unittest.TestCase):
    def test_round_trips_the_sequence(self):
        with tempfile.TemporaryDirectory() as directory:
            store = _store(directory)
            self.assertIsNone(store.read())
            store.write(42)
            self.assertEqual(store.read(), 42)

    def test_ignores_a_cursor_for_another_agent_or_server(self):
        with tempfile.TemporaryDirectory() as directory:
            _store(directory).write(42)
            self.assertIsNone(_store(directory, agent_id="agent-2").read())
            self.assertIsNone(_store(directory, url="https://other.example.com").read())

    def test_ignores_a_damaged_file(self):
        with tempfile.TemporaryDirectory() as directory:
            store = _store(directory)
            store.path.parent.mkdir(parents=True)
            store.path.write_text("{not json")
            self.assertIsNone(store.read())
            store.path.write_text(json.dumps({**store.identity, "sequence": "7"}))
            self.assertIsNone(store.read())


class SkipHistoryTest(unittest.TestCase):
    def test_first_start_pages_to_the_newest_event(self):
        pages = {None: [{"sequence": 1}, {"sequence": 2}], 2: [{"sequence": 5}], 5: []}
        calls = []

        async def fetch(after):
            calls.append(after)
            return pages[after]

        with tempfile.TemporaryDirectory() as directory:
            store = _store(directory)
            self.assertEqual(asyncio.run(skip_history(store, fetch)), 5)
            self.assertEqual(calls, [None, 2, 5])
            self.assertEqual(store.read(), 5)

    def test_no_events_yet_starts_at_zero(self):
        async def fetch(after):
            return []

        with tempfile.TemporaryDirectory() as directory:
            store = _store(directory)
            self.assertEqual(asyncio.run(skip_history(store, fetch)), 0)
            self.assertEqual(store.read(), 0)

    def test_a_saved_cursor_is_kept(self):
        async def fetch(after):
            raise AssertionError("history should not be read")

        with tempfile.TemporaryDirectory() as directory:
            store = _store(directory)
            store.write(9)
            self.assertEqual(asyncio.run(skip_history(store, fetch)), 9)


if __name__ == "__main__":
    unittest.main()
