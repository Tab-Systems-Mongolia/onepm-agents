import unittest

from onepm.constants import RECONNECT_MAX_SECONDS, RECONNECT_MIN_SECONDS
from onepm.socket_link import message_type, reconnect_delay, socket_url


class SocketLinkTest(unittest.TestCase):
    def test_socket_url_swaps_the_scheme(self):
        self.assertEqual(socket_url("https://pm.example.com"), "wss://pm.example.com/api/ws/agent")
        self.assertEqual(socket_url("http://localhost:1337"), "ws://localhost:1337/api/ws/agent")

    def test_backoff_doubles_up_to_the_cap(self):
        middle = lambda: 0.5  # noqa: E731 - no jitter
        self.assertEqual(reconnect_delay(1, middle), RECONNECT_MIN_SECONDS)
        self.assertEqual(reconnect_delay(3, middle), RECONNECT_MIN_SECONDS * 4)
        self.assertEqual(reconnect_delay(50, middle), RECONNECT_MAX_SECONDS)
        self.assertLess(reconnect_delay(1, lambda: 0.0), RECONNECT_MIN_SECONDS)
        self.assertGreater(reconnect_delay(1, lambda: 1.0), RECONNECT_MIN_SECONDS)

    def test_message_type(self):
        self.assertEqual(message_type('{"type":"AGENT_EVENT","eventId":"e"}'), "AGENT_EVENT")
        self.assertIsNone(message_type("not json"))
        self.assertIsNone(message_type("[1]"))


if __name__ == "__main__":
    unittest.main()
