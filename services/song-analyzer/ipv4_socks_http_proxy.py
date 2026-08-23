"""Local-only HTTP CONNECT bridge that forces WARP's SOCKS route to IPv4.

YouTube can bind a temporary media URL to the address that requested it. The
WARP SOCKS endpoint otherwise prefers IPv6, which some Google video endpoints
reject. This bridge resolves the destination to a public IPv4 address first,
then asks WARP to connect to that exact address. It accepts HTTPS CONNECT only,
listens on loopback, and cannot be used to reach private networks.
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
import struct
from typing import Optional, Tuple

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 40001
SOCKS_HOST = "127.0.0.1"
SOCKS_PORT = 40000
HEADER_LIMIT = 16 * 1024


async def public_ipv4(host: str, port: int) -> Tuple[str, int]:
    loop = asyncio.get_running_loop()
    answers = await loop.getaddrinfo(host, port, family=socket.AF_INET, type=socket.SOCK_STREAM)
    for _family, _type, _protocol, _canonname, address in answers:
        ip = ipaddress.ip_address(address[0])
        if ip.is_global:
            return str(ip), address[1]
    raise OSError("No public IPv4 destination is available.")


async def socks_connect(host: str, port: int) -> Tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    destination, destination_port = await public_ipv4(host, port)
    reader, writer = await asyncio.open_connection(SOCKS_HOST, SOCKS_PORT)
    writer.write(b"\x05\x01\x00")
    await writer.drain()
    if await reader.readexactly(2) != b"\x05\x00":
        raise OSError("The private SOCKS route rejected authentication.")
    writer.write(b"\x05\x01\x00\x01" + socket.inet_aton(destination) + struct.pack("!H", destination_port))
    await writer.drain()
    version, result, _reserved, address_type = await reader.readexactly(4)
    if version != 5 or result != 0:
        raise OSError("The private SOCKS route rejected the destination.")
    if address_type == 1:
        await reader.readexactly(4)
    elif address_type == 3:
        await reader.readexactly((await reader.readexactly(1))[0])
    elif address_type == 4:
        await reader.readexactly(16)
    else:
        raise OSError("The private SOCKS route returned an invalid address.")
    await reader.readexactly(2)
    return reader, writer


async def relay(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            chunk = await reader.read(64 * 1024)
            if not chunk:
                break
            writer.write(chunk)
            await writer.drain()
    finally:
        try:
            writer.write_eof()
        except (AttributeError, OSError):
            pass


async def handle(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
    upstream_writer: Optional[asyncio.StreamWriter] = None
    established = False
    try:
        request_line = await asyncio.wait_for(client_reader.readline(), timeout=10)
        if len(request_line) > HEADER_LIMIT:
            raise ValueError("Request line is too large.")
        method, authority, _version = request_line.decode("ascii").strip().split(" ", 2)
        if method.upper() != "CONNECT":
            raise ValueError("Only HTTPS CONNECT is supported.")
        host, separator, port_text = authority.rpartition(":")
        if not separator or not host or int(port_text) != 443:
            raise ValueError("Only public HTTPS destinations are supported.")
        received = len(request_line)
        while True:
            line = await asyncio.wait_for(client_reader.readline(), timeout=10)
            received += len(line)
            if received > HEADER_LIMIT:
                raise ValueError("Request headers are too large.")
            if line in {b"\r\n", b"\n", b""}:
                break
        upstream_reader, upstream_writer = await asyncio.wait_for(socks_connect(host, 443), timeout=20)
        client_writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await client_writer.drain()
        established = True
        await asyncio.gather(relay(client_reader, upstream_writer), relay(upstream_reader, client_writer))
    except Exception:
        if not established and not client_writer.is_closing():
            client_writer.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
            try:
                await client_writer.drain()
            except (ConnectionError, OSError):
                pass
    finally:
        if upstream_writer is not None:
            upstream_writer.close()
        client_writer.close()


async def main() -> None:
    server = await asyncio.start_server(handle, LISTEN_HOST, LISTEN_PORT)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
