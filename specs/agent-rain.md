# The Matrix rains your agents' output

**Sentence:** a backdrop can draw live text, and The Matrix's rain is made of
everything the agents on this machine are producing, mirrored like the film's
code.

Sean, 2026-10-28: "for the matrix code rain could you make it rain the tokens
from all your current active agents? that would be super sick"; then
"Mirrored, like the film" and "Everything they produce" (replies, commands,
thinking and tool output).

## Shape

Two pieces joined by one socket.

1. **The feed** is a small user service, `cinema-feed`, with one job: send
   the plugin the newest plaintext the agents on this machine produced. It
   follows the session logs that already exist and grow as agents work:
   Claude Code's `~/.claude/projects/**/*.jsonl`, child agents' logs
   included, and Codex's `~/.codex/sessions/**/*.jsonl` (T3 Code threads run
   on these two). A log is followed while it was written in the last ten
   minutes; on discovery it starts from its last 64 KiB, then reads only
   appended complete lines, and starts over when a log is replaced or
   truncated.
   - **What it takes**, one small adapter per format, each record once from
     its canonical place (never by matching text, since an agent can repeat
     itself): Claude Code's assistant text, plaintext thinking and tool
     inputs, and the tool results that come back (a string or text blocks);
     Codex's `response_item` records of these types only: `message` with
     role `assistant` (its `output_text`), `function_call` (`arguments`),
     `function_call_output` (`output`), `custom_tool_call` (`input`) and
     `custom_tool_call_output` (`output`, a string or `input_text` blocks).
     Not developer instructions or user prompts, the replayed API request
     records, IDs, signatures or encrypted reasoning (Codex's reasoning is
     encrypted, so "everything" is everything the logs hold as plaintext).
   - **What it sends**: the text cut to printable ASCII (others become a
     space) into a 16 KiB ring, and the ring as one complete snapshot: a
     version, a generation that rises with each change, the number of valid
     characters (0 to 16384) and the next write position. It sends with
     `MSG_DONTWAIT` to a Unix datagram socket the plugin owns, at most four
     times a second, and drops a snapshot it cannot send. With no log
     written in the last ten minutes it sends an empty snapshot, and every
     five seconds it sends the current one again so the plugin knows it is
     alive. The text is never written to disk or to its journal.
2. **The plugin reads text**, for any theme. It binds
   `$XDG_RUNTIME_DIR/omarchy-cinema/feed.sock` (mode 0600) as a nonblocking
   datagram socket and adds it to Hyprland's event loop; on readable it
   takes at most eight datagrams, keeps the newest valid snapshot in memory
   and drops malformed ones, and it uploads a changed snapshot as a
   one-channel texture when it next draws. Whether there is text is the
   snapshot's own count (the service sends an empty one once no agent has
   written for ten minutes); whether the service is alive is time: with no
   valid datagram for ten seconds of monotonic time, heartbeats included,
   the plugin treats the feed as empty. The generation only tells a changed
   snapshot from a repeat; any valid datagram replaces the last, so a
   restarted service, counting from zero again, is taken at once.
   The theme ships `glyphs.png`, a 16 by 6 atlas of ASCII 32 to 127 in the
   film's lettering, loaded with the theme; a theme without one does no feed
   work. The contract gains `feed`, `feedCount` (valid characters, 0 for none)
   and `feedPos`, with a helper that returns the character `i` back from the
   newest, and `glyphs`.
3. **The Matrix** draws each falling column from a stretch of the feed,
   newest at the stream's head, through its mirrored atlas, keeping the
   columns' depth, tails, splashes and window interaction; with `feedCount`
   0 it falls back to today's glyphs, so it is never empty.

## What it deletes

Nothing yet. The hashed 3 by 3 glyph builder in The Matrix's shader stays as
the no-feed fallback; if the feed is always present once installed, a later
change can delete it.

## Non-goals

Readable text (mirrored, by Sean's choice); text from anything but agent
logs; any network or agent-side hook (the logs are already written);
per-agent colours; storing the text anywhere but the runtime ring (it is
gone at logout).

## Settled in review (Sol, 2026-10-28)

The join is a nonblocking datagram (a file polled on Hyprland's event loop
would block it); the logs grow in bursts of 1 to 24 seconds, enough to rain
but not token by token; and mirrored text is still exposed text: anything an
agent prints, secrets included, can show on the desktop, which is the
behaviour Sean asked for, so the text stays in memory and the socket is
private to the user.

## Acceptance

1. With agents working, The Matrix's columns carry their text within a
   second of it reaching the logs, mirrored. Once no agent has written for
   ten minutes, or within ten seconds of the service stopping, the rain looks
   as today.
2. Frame cost within 10% of today's Matrix at 2880x1800, measured.
3. Plugin changes tested in a nested Hyprland first, including the service
   absent, restarting and sending malformed snapshots, a ring that wraps,
   and theme switches; the live desktop gets the new plugin and contract
   together at the next login.
