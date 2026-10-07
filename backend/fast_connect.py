"""urlopen, который не застревает на недоступном адресе хоста.

Из Yandex Cloud имя Supabase разрешается в два адреса Cloudflare, и один из
них не принимает соединения (октябрь 2026: 8.6.112.0). Стандартный urlopen
ждёт на нём весь тайм-аут запроса — 10–20 с — и только потом пробует второй
адрес. Пара таких запросов не укладывается в 30 с функции, клиент получает
504, и очередь подходов на телефоне стоит.

Здесь на подключение к каждому адресу отводится несколько секунд, а не
отвечающий адрес процесс запоминает и следующие запросы начинает с живых.
Тайм-аут чтения ответа остаётся тем, что передал вызывающий.
"""

from __future__ import annotations

import http.client
import socket
import time
import urllib.request
from typing import Any, Dict, Optional, Tuple

CONNECT_TIMEOUT_S = 3.0
# Сколько не начинать с адреса, который не ответил. Отложенный адрес всё
# равно пробуется, если живые тоже не ответили.
DEAD_ADDRESS_TTL_S = 300.0

_dead_until: Dict[str, float] = {}


def _create_connection(
    address: Tuple[str, int],
    timeout: Any = socket._GLOBAL_DEFAULT_TIMEOUT,
    source_address: Optional[Tuple[str, int]] = None,
) -> socket.socket:
    host, port = address
    infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
    now = time.monotonic()
    # Сортировка устойчивая: среди живых сохраняется порядок от DNS.
    infos.sort(key=lambda info: _dead_until.get(info[4][0], 0.0) > now)
    read_timeout = None if timeout is socket._GLOBAL_DEFAULT_TIMEOUT else timeout
    connect_timeout = CONNECT_TIMEOUT_S if read_timeout is None else min(read_timeout, CONNECT_TIMEOUT_S)

    last_error: Optional[OSError] = None
    for family, socktype, proto, _, sockaddr in infos:
        sock = socket.socket(family, socktype, proto)
        try:
            sock.settimeout(connect_timeout)
            if source_address:
                sock.bind(source_address)
            sock.connect(sockaddr)
        except OSError as error:
            sock.close()
            _dead_until[sockaddr[0]] = time.monotonic() + DEAD_ADDRESS_TTL_S
            last_error = error
            continue
        _dead_until.pop(sockaddr[0], None)
        sock.settimeout(read_timeout)
        return sock
    raise last_error or OSError(f"getaddrinfo returned no addresses for {host}")


class _HTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._create_connection = _create_connection


class _HTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req: urllib.request.Request) -> http.client.HTTPResponse:
        return self.do_open(_HTTPSConnection, req, context=self._context)


_opener = urllib.request.build_opener(_HTTPSHandler())


def urlopen(request: urllib.request.Request, timeout: float) -> Any:
    """Как urllib.request.urlopen, но с отдельным коротким тайм-аутом подключения."""
    return _opener.open(request, timeout=timeout)
