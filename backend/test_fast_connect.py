import socket
import unittest
import urllib.request
from unittest.mock import patch

import fast_connect


DEAD_IP = "127.0.0.2"


class FastConnectTests(unittest.TestCase):
    def setUp(self):
        fast_connect._dead_until.clear()
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.bind(("127.0.0.1", 0))
        # Ядро завершает рукопожатие само: accept() для connect не нужен.
        self.server.listen(8)
        self.port = self.server.getsockname()[1]
        self.attempts = []
        attempts = self.attempts

        class RecordingSocket(socket.socket):
            def connect(self, address):
                attempts.append(address[0])
                return super().connect(address)

        patches = [
            patch.object(fast_connect, "CONNECT_TIMEOUT_S", 0.5),
            patch.object(fast_connect.socket, "socket", RecordingSocket),
            patch.object(fast_connect.socket, "getaddrinfo", side_effect=self._addresses),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        self.addCleanup(self.server.close)

    def _addresses(self, *_args, **_kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (DEAD_IP, self.port + 1)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", self.port)),
        ]

    def test_skips_unreachable_address_and_keeps_read_timeout(self):
        sock = fast_connect._create_connection(("supabase.example", 443), 7)
        self.addCleanup(sock.close)

        self.assertEqual(self.attempts, [DEAD_IP, "127.0.0.1"])
        self.assertEqual(sock.getpeername()[1], self.port)
        self.assertEqual(sock.gettimeout(), 7)

    def test_next_connection_starts_with_live_address(self):
        fast_connect._create_connection(("supabase.example", 443), 7).close()
        self.attempts.clear()

        fast_connect._create_connection(("supabase.example", 443), 7).close()

        self.assertEqual(self.attempts, ["127.0.0.1"])

    def test_raises_when_no_address_answers(self):
        self.server.close()
        with self.assertRaises(OSError):
            fast_connect._create_connection(("supabase.example", 443), 7)

    def test_opener_uses_patched_https_handler(self):
        https = [h for h in fast_connect._opener.handlers if isinstance(h, urllib.request.HTTPSHandler)]
        self.assertEqual([type(h) for h in https], [fast_connect._HTTPSHandler])


if __name__ == "__main__":
    unittest.main()
