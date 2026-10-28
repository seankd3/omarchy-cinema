#!/usr/bin/env python3
"""Sends the backdrop plugin the newest plaintext the agents on this machine
produced, as a ring of characters, for themes whose backdrop draws text (The
Matrix rains it). specs/agent-rain.md is the contract.

It follows the session logs the agents already write as they work, Claude
Code's (child agents' too) and Codex's (T3 Code threads run on both), takes
each record's text once from its canonical place, and sends the plugin a
complete snapshot over a datagram socket it never waits on. The text lives
only in this process and the plugin; nothing is written anywhere.
"""

import glob
import json
import os
import socket
import struct
import time

HOME = os.path.expanduser("~")
LOGS = [
    os.path.join(HOME, ".claude/projects/**/*.jsonl"),
    os.path.join(HOME, ".codex/sessions/**/*.jsonl"),
]
SOCKET = os.path.join(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"), "omarchy-cinema/feed.sock")

RING = 16384
ACTIVE = 600  # a log written in the last ten minutes is followed
FIRST_READ = 64 * 1024  # a newly followed log starts this far from its end
LOOK_EVERY = 2.0  # seconds between looks for logs
SEND_EVERY = 0.25  # at most four snapshots a second
ALIVE_EVERY = 5.0  # the current snapshot again, so the plugin knows the feed is up
VERSION = b"CFD1"  # magic, then generation u64, count u32, next position u32


class Ring:
    def __init__(self):
        self.chars = bytearray(b" " * RING)
        self.count = 0
        self.pos = 0
        self.generation = 0

    def add(self, text):
        data = text.encode("ascii")
        for byte in data[-RING:]:
            self.chars[self.pos] = byte
            self.pos = (self.pos + 1) % RING
        self.count = min(RING, self.count + len(data))
        self.generation += 1

    def clear(self):
        if self.count:
            self.count = 0
            self.generation += 1

    def snapshot(self):
        return VERSION + struct.pack("<QII", self.generation, self.count, self.pos) + bytes(self.chars)


def printable(text):
    """Printable ASCII, other characters as spaces, runs of space as one."""
    out = "".join(c if " " <= c <= "~" else " " for c in text)
    return " ".join(out.split())


def blocks_text(value):
    """A string, or text blocks ({"type": ..., "text": ...}) joined."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(b.get("text", "") for b in value if isinstance(b, dict) and isinstance(b.get("text"), str))
    return ""


def tool_input(value):
    """A tool's input: its strings, without the JSON around them."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return " ".join(tool_input(v) for v in value.values())
    if isinstance(value, list):
        return " ".join(tool_input(v) for v in value)
    return ""


def claude_text(record):
    """Claude Code: the assistant's text, plaintext thinking and tool inputs,
    and the tool results that come back in user messages."""
    message = record.get("message")
    if not isinstance(message, dict) or not isinstance(message.get("content"), list):
        return []
    out = []
    for block in message["content"]:
        if not isinstance(block, dict):
            continue
        kind = block.get("type")
        if record.get("type") == "assistant":
            if kind == "text":
                out.append(block.get("text", ""))
            elif kind == "thinking":
                out.append(block.get("thinking", ""))
            elif kind == "tool_use":
                out.append(tool_input(block.get("input")))
        elif record.get("type") == "user" and kind == "tool_result":
            out.append(blocks_text(block.get("content")))
    return out


def codex_text(record):
    """Codex: response records of the assistant's messages and of tool calls
    and their outputs; never developer instructions, user prompts or the
    encrypted reasoning."""
    if record.get("type") != "response_item" or not isinstance(record.get("payload"), dict):
        return []
    item = record["payload"]
    kind = item.get("type")
    if kind == "message" and item.get("role") == "assistant":
        return [b.get("text", "") for b in item.get("content", []) if isinstance(b, dict) and b.get("type") == "output_text"]
    if kind == "function_call":
        return [item.get("arguments", "")]
    if kind == "custom_tool_call":
        return [item.get("input", "")]
    if kind in ("function_call_output", "custom_tool_call_output"):
        return [blocks_text(item.get("output"))]
    return []


class Log:
    """A followed log: where it was read to, and a line not yet complete."""

    def __init__(self, path, stat):
        self.path = path
        self.inode = stat.st_ino
        self.offset = max(0, stat.st_size - FIRST_READ)
        self.partial = b""
        self.skip_first = self.offset > 0  # it starts mid-line
        self.adapter = codex_text if "/.codex/" in path else claude_text

    def read(self, stat):
        if stat.st_ino != self.inode or stat.st_size < self.offset:
            # Replaced or truncated: start again from its start.
            self.inode, self.offset, self.partial, self.skip_first = stat.st_ino, 0, b"", False
        if stat.st_size == self.offset:
            return []
        with open(self.path, "rb") as file:
            file.seek(self.offset)
            data = file.read(stat.st_size - self.offset)
        self.offset += len(data)
        lines = (self.partial + data).split(b"\n")
        self.partial = lines.pop()
        if self.skip_first and lines:
            lines.pop(0)
            self.skip_first = False
        out = []
        for line in lines:
            try:
                record = json.loads(line)
            except ValueError:
                continue
            if isinstance(record, dict):
                out.extend(t for t in self.adapter(record) if t)
        return out


def main():
    ring = Ring()
    logs = {}
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    sock.setblocking(False)
    sent_generation, last_send, last_look = -1, 0.0, 0.0
    while True:
        now = time.monotonic()
        if now - last_look >= LOOK_EVERY:
            last_look = now
            wall = time.time()
            active = {}
            for pattern in LOGS:
                for path in glob.iglob(pattern, recursive=True):
                    try:
                        stat = os.stat(path)
                    except OSError:
                        continue
                    if wall - stat.st_mtime <= ACTIVE:
                        active[path] = logs.get(path) or Log(path, stat)
            logs = active
            if not logs:
                ring.clear()

        for log in list(logs.values()):
            try:
                texts = log.read(os.stat(log.path))
            except OSError:
                continue
            for text in texts:
                text = printable(text)
                if text:
                    ring.add(text + " ")

        changed = ring.generation != sent_generation
        if (changed and now - last_send >= SEND_EVERY) or now - last_send >= ALIVE_EVERY:
            try:
                sock.sendto(ring.snapshot(), SOCKET)
            except (BlockingIOError, FileNotFoundError, ConnectionRefusedError, OSError):
                pass  # no plugin listening, or it is busy: the next snapshot replaces this one
            sent_generation, last_send = ring.generation, now
        time.sleep(0.1)


if __name__ == "__main__":
    main()
