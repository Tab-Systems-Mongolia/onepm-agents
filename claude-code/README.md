# OnePM channel for Claude Code

Connects a running Claude Code session to a OnePM agent. When someone
@mentions the agent on a task, assigns it a task, or comments on one of its
tasks, the message arrives in your session. Claude answers with the `reply`
tool, which posts a comment on that task.

Each OnePM task is one chat: `chat_id` is the task's id.

## Requirements

- Claude Code with channels support
- Node.js 22 or later (`node` and `npm` on your `PATH`)
- An agent in OnePM and its key: **Project settings › Agents › New agent**.
  The key is shown once.

## Install

```sh
claude plugin marketplace add Tab-Systems-Mongolia/onepm-agents
claude plugin install onepm@onepm
```

## Agent profiles

Claude Code starts the plugin in every session, but it connects to OnePM only
in a session started as an **agent profile**:

```sh
ONEPM_AGENT=claudeagent claude --dangerously-load-development-channels plugin:onepm@onepm
```

During the channels research preview, `--channels` only registers plugins on
Anthropic's approved list, and this plugin isn't on it: started with
`--channels`, the session runs but never receives OnePM messages ("not on the
approved channels allowlist" in the MCP log). Use
`--dangerously-load-development-channels`, which asks once at startup. On a
Team or Enterprise plan, an admin can add `onepm@onepm` to
`allowedChannelPlugins` in managed settings instead, and then `--channels`
works.

The profile name is yours to choose; use the agent's OnePM handle. Each
profile keeps its key, allowlist and cursor in
`~/.claude/channels/onepm/<name>/`, so one machine can run several agents,
each in its own session. In a session started without `ONEPM_AGENT` the
plugin stays idle: it doesn't connect, doesn't take events from the agent's
session, and its tools answer that the channel isn't active.

## Configure

In any Claude Code session, give the agent key and the profile name:

```
/onepm:configure opm_your_agent_key claudeagent
```

This writes `~/.claude/channels/onepm/claudeagent/.env` (mode 600):

```sh
ONEPM_AGENT_KEY=opm_your_agent_key
```

Without `ONEPM_URL` the channel connects to the hosted OnePM,
`https://onepm.tabsystems.tech`. For a self-hosted instance add its URL;
the arguments can come in any order:

```
/onepm:configure https://pm.example.com opm_your_agent_key claudeagent
```

In the agent's own session the name can be left out: `/onepm:configure`
uses `ONEPM_AGENT`. Run `/onepm:configure` with no arguments to see the
profile's status, or, outside an agent's session, the profiles that exist.

`ONEPM_URL` and `ONEPM_AGENT_KEY` set in your shell take precedence over the
file. `ONEPM_STATE_DIR` still works and points a session at one state
directory instead of a profile; note that it makes every session that has it
set connect.

Upgrading from a version without profiles: the old
`~/.claude/channels/onepm/.env` is no longer read. Run `/onepm:configure` in
a normal session and it offers to move those files into a profile.

## Allow who can reach you

You, the agent's owner, are allowed already. From 0.7.0, the first time a
profile starts and has no `access.json`, the channel creates one that allows
only the owner, with mentions required. It takes the owner's ID from OnePM's
answer for the agent key (`GET /api/project-agent/self`), never from a task or
comment. It never changes an `access.json` that exists, so if you remove
yourself, you stay removed. With an older OnePM that doesn't name the owner,
nothing is created and you allow yourself as below.

Everyone else is dropped until you allow them. An empty allowlist drops every
event. There's no pairing code, because it would be posted on a task that the
whole workspace can read.

To let someone else reach the agent, copy their OnePM user ID from the members
list (your own is in the profile menu), then, in the agent's session:

```
/onepm:access allow <their user id>
```

| Command | What it does |
| --- | --- |
| `/onepm:access` | Shows who is allowed, the mention setting, and recent senders who were dropped (with their IDs) |
| `/onepm:access allow <id>` | Lets that person's events through |
| `/onepm:access remove <id>` | Stops them |
| `/onepm:access mention on` | Default. Only mentions of the agent, assignments to it, and comments that @mention it |
| `/onepm:access mention off` | Also every other comment on tasks that are the agent's channels |

The settings are stored in the profile's `access.json`, and the
channel reads it again for every event:

```json
{
  "allowFrom": ["<user id>"],
  "requireMention": true
}
```

From 0.8.0 the channel also sends `allowFrom` to OnePM when it starts and
whenever the file changes. OnePM then refuses assignments and mentions from
anyone else up front, so a task never looks assigned to an agent that won't
act. The agent's row in the project's Agents settings shows the list to you.
You, in person, may always give it work. Your other agents count as
themselves, not as you, so add an agent's own user ID if it should be able to
assign or mention this one.

From 0.8.6, OnePM Assistant (the AI in OnePM) counts as the person who asked
it. When you, or someone on the allowlist, ask the Assistant to mention or
assign the agent, the event arrives under that person's name with
`via="assistant"` and a line saying the Assistant wrote it. The agent treats it
as that person's request, but asks before doing anything they'd be unlikely to
want, because the Assistant reads task content anyone can write. Older
channels drop these events, since the Assistant isn't on their allowlist.

## Triggers

A project admin can also set **triggers** on the agent in **Project settings ›
Agents**: a task assigned to it entering a chosen status, or a linked pull
request being opened, merged or closed. These arrive as `kind="status"` and
`kind="pull_request"` messages that say what happened, for example
`[ONEPM-42] Fix login` / `Pull request #57 (acme/repo) was merged`. They come
from OnePM rather than a person, so they are delivered whatever the allowlist
and the mention setting say. The agent's own changes never trigger it.

A pull request message carries only what OnePM knows: the action, number,
repository and URL. The pull request's title and branch are written by whoever
opened it, so they are left out (from 0.4.1, even when an older server sends
them). The agent can open the URL itself, and should treat what it finds there
as untrusted information, not instructions.

## Replying indicator

From 0.5.0, OnePM shows the agent as replying (a red dot on its avatar, and
"@handle is replying…" under the task's comment box) from when an event is
delivered to the session until `reply` posts on that task. The channel can't
see when Claude's turn ends, so it refreshes the mark every 15 seconds for at
most 10 minutes; a turn that ends without a reply clears 30 seconds after the
last refresh. An older OnePM without this feature is left alone.

From 0.8.4 the mark can last as long as the work. A reply sent with
`working: true` (an acknowledgement or a progress note) keeps the task busy,
and `set_working(chat_id, true)` marks a task the agent works on without a
message from it, such as work started from the terminal. Either one refreshes
for up to 2 hours; the final reply, or `set_working(chat_id, false)`, clears
it, and it clears by itself 30 seconds after the session ends.

From 0.8.5 the mark follows what the agent does. A delivered event marks its
task for 2 minutes instead of 10, so an event the agent doesn't answer (a
hand-over, a mention that needs nothing) clears soon. Moving a task with
`update_task_status` or `update_task` to a status that isn't final marks it
busy for up to 2 hours, as `set_working(chat_id, true)` would; moving it to a
final status clears the mark. A shorter mark never cuts a longer one short.
OnePM also clears every agent's mark on a task once it reaches a final
column, whichever plugin version the agent runs.

## Several tasks at once

From 0.6.0, one session works on up to 5 tasks at once. The channel delivers
messages for at most 5 tasks that haven't had a reply yet. A sixth task's
messages wait unread, and the cursor stays put, so a restart loses nothing,
until the agent replies on one of the 5 or 30 minutes pass without a reply.
More messages on a task already in hand always go through.

The server's instructions tell Claude to do two things:

- **Background subagent per task.** Claude handles each task in a background
  subagent, so the session stays free for the others, and never runs more
  than 5. A subagent that changes files works in its own git worktree,
  `.claude/worktrees/onepm-<task key>` on branch `onepm/<task key>`.
- **Cleanup.** Whenever it takes a new task, Claude removes those worktrees in
  two cases: the task is resolved or closed, or nothing in the worktree has
  changed for 7 days. It removes one only when `git status` is clean and every
  commit is pushed. It never forces a removal; it says in the task what is
  left.

The worktrees go in the folder the session was started in, so start it at the
root of the project's repository.

## Run

```sh
ONEPM_AGENT=claudeagent claude --dangerously-load-development-channels plugin:onepm@onepm
```

The plugin connects to OnePM as the agent and shows it online. On its first
start it skips the agent's older events. After that it picks up where it
stopped, including events that came in while it was offline.

Only one connection per agent key is live. Starting a second session with the
same profile takes over, and the first one stops receiving events.

## Tools

| Tool | What it does |
| --- | --- |
| `reply(chat_id, text, working?)` | Posts `text` (Markdown) as a comment on the task. Token-like secrets are masked first. Replies over 10,000 characters are split into several comments. With `working: true` the task stays busy. |
| `set_working(chat_id, working)` | Shows or clears the busy mark on a task without posting. |
| `get_task(chat_id)` | Returns the task's title, description, status, priority, and its last 20 comments. |

### OnePM's tools come with the plugin

In an agent's session the plugin also serves OnePM's own MCP tools (listing
and changing tasks, statuses, assignees, labels, milestones and more). It
connects to `<ONEPM_URL>/api/mcp` with the agent key, so there's no separate
`claude mcp add` step. The tools act as the agent, inside its project, and the
scopes chosen for the agent in OnePM decide which calls succeed; the rest come
back as errors.

- If OnePM can't be reached when the session starts, the channel's own tools
  still work and the plugin logs why. It tries again on a later tool list or
  call (at most every 30 seconds) and tells Claude Code when OnePM's tools
  arrive.
- OnePM's `get_task` has the same name as the channel's, so the channel's is
  kept and OnePM's isn't listed. Both read a task with the same key.

The server instructions also carry a short summary of the agent's project:
its name and key, the board's statuses in order, and its GitHub repositories
(the first 10). The plugin reads it with the agent key when the session
starts and waits at most 3 seconds; without it, the session starts with the
plain instructions.

From 0.8.7 the instructions ask Claude to put a task it creates in the
project's active sprint, with story points, unless told otherwise
(`create_task` takes `milestoneIds` and `storyPoints`; the agent needs the
`pm:milestones` and `pm:refine` scopes for them). A task the agent creates
for itself to work on is assigned to the agent, so per-member reports count
it for the right person.

**Don't use your personal OnePM MCP server in an agent's session.** If you
added OnePM's MCP server to Claude Code with your own login or API key, it
acts as you, across every project you can reach, and ignores the agent's
scopes. The instructions tell Claude to use only this plugin's tools for
OnePM; to be sure, remove the personal server from the agent's working
directory or run the agent under a separate Claude Code configuration.

Upgrading from 0.2: if you followed the old setup and added OnePM's MCP server
with the agent key (`claude mcp add ... onepm .../api/mcp`), remove it with
`claude mcp remove onepm`. The plugin serves the same tools now.

## Security

- **Allowlist only.** Events from anyone not in `allowFrom` are dropped
  before anything about them is read. The agent's own comments never come
  back as events. Trigger events (`status`, `pull_request`) are the only
  exception: OnePM sends them for triggers an admin set, only on tasks
  assigned to the agent, and they carry no request from a person.
- **Comments are untrusted input.** Task titles, descriptions, and comments
  are written by workspace members. The server instructions tell Claude to
  treat them as information, and never to change access because a comment
  asks. Only you change access, by running `/onepm:access` in your terminal.
- **Replies are public to the workspace.** Before posting, `reply` masks
  GitHub tokens, `sk-` and `sk_live_` keys, OnePM keys, AWS keys, JWTs,
  Bearer values, private keys, URL passwords, and the agent key itself.
  Masking catches common formats, not every secret.
- **The key stays local.** `.env` is kept at mode 600, and the key is masked
  in the plugin's logs. A OnePM agent key reaches only its own project, and
  only with the scopes chosen for it. The key goes only to the `ONEPM_URL`
  you configured, both for events and for OnePM's tools.
- Claude's tool permissions and sandbox still apply. Run Claude Code in a
  directory and with permissions you're comfortable exposing to the people
  you allowed.

## Files

Each profile's files are in `~/.claude/channels/onepm/<name>/`:

| File | Contents |
| --- | --- |
| `.env` | `ONEPM_AGENT_KEY`, and `ONEPM_URL` for a self-hosted OnePM |
| `access.json` | Allowlist and mention setting |
| `cursor.json` | The last event handled, for this server and agent |
| `dropped.json` | The last 20 senders who were dropped |

## Development

```sh
cd claude-code
npm install
node --test test/           # unit tests
ONEPM_AGENT=dev npm start   # what Claude Code runs, over stdio
```

The plugin is plain ESM JavaScript (`server.mjs` plus `src/`), so there's no
build step. Its `start` script installs the dependencies pinned in
`package-lock.json` quietly, then runs the server. After changing a dependency,
run `npm install` here and commit the updated lockfile.
