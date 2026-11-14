# OnePM channel for OpenClaw

This plugin connects an [OpenClaw](https://github.com/openclaw/openclaw) gateway to OnePM as a OnePM project agent. OpenClaw answers in OnePM with its own model, tools and sandbox.

- Each OnePM task is one OpenClaw group chat. The chat id is the task id, and the chat name is the task key and title, such as `[OPM-12] Fix login`.
- When someone mentions the agent, assigns it a task or comments on its task, OpenClaw gets a message. The sender is the person's OnePM user id, and OpenClaw's own allowlist (`channels.onepm.allowFrom`) decides whether the agent answers.
- OpenClaw's replies are posted as comments on the task. Token-like secrets in a reply, the agent key among them, are replaced with `[redacted]`.
- While the gateway runs, the agent shows as connected in OnePM.

The plugin has no dependencies beyond OpenClaw itself (2026.11.3 or later) and Node 22 or later.

## Before you start

You need:

- OpenClaw installed, with `openclaw gateway` working and a model configured.
- A OnePM agent and its key. In OnePM, open Project settings › Agents, create an agent, and copy the key. OnePM shows the key once.
- Your OnePM user id: open the profile menu (or the members list) and copy it.

## Install

Clone the OnePM plugins repository and install the plugin from it:

```sh
git clone --depth 1 https://github.com/Tab-Systems-Mongolia/onepm-agents.git ~/onepm-agents
openclaw plugins install ~/onepm-agents/openclaw --force --accept-capabilities
```

`--force` confirms a source outside ClawHub, and `--accept-capabilities` accepts the channel the plugin adds. To work on the plugin itself, install it with `--link` instead, so OpenClaw loads it from the checkout.

`openclaw plugins inspect onepm --runtime` shows `Status: loaded` and `channel: onepm`.

## Configure

Put the agent key in `~/.openclaw/.env`, so the key stays out of `openclaw.json`:

```sh
ONEPM_AGENT_KEY=<the agent key>
```

Without a URL the plugin connects to the hosted OnePM, `https://onepm.tabsystems.tech`. For a self-hosted instance, add its address, without `/api`:

```sh
ONEPM_URL=https://onepm.example.com
```

Keep one line for each name: when you change the key or the server, edit the line rather than adding another. The connect steps in **Project settings › Agents** ask for the key without showing it and rewrite these two lines in place, keeping the file's other settings.

You can set `channels.onepm.url` and `channels.onepm.agentKey` in the config instead; the config wins over the environment. A key left in `channels.onepm.agentKey` therefore hides the one in `~/.openclaw/.env`, so remove it (`openclaw config unset channels.onepm.agentKey`) if you keep the key in the file.

Then allow the OnePM users the agent answers. `config set` replaces the whole list, so check it first and keep the ids you still want:

```sh
openclaw config get channels.onepm.allowFrom --json
openclaw config set channels.onepm.allowFrom '["<user id>", "<user id>"]' --strict-json
```

To add one id and keep the others, as the connect steps do (running it again adds no duplicate):

```sh
ids=$(openclaw config get channels.onepm.allowFrom --json 2>/dev/null) || ids='[]'
openclaw config set channels.onepm.allowFrom "$(node -e 'const [ids, id] = process.argv.slice(1); const list = JSON.parse(ids); console.log(JSON.stringify(list.map(String).includes(id) ? list : [...list, id]));' "$ids" '<user id>')" --strict-json
```

OpenClaw drops everyone else, and it posts nothing on the task for them. There is no pairing: a task is a shared chat, so a pairing code would be public. An empty `allowFrom` drops every event. When someone outside the list asks the agent something, the gateway log shows `[onepm] dropped <kind> <event id> from <user id>: sender not allowed`; add that id if you mean to allow them.

By default the agent answers mentions, assignments, and comments that mention it. To have it read every comment on the tasks it's in, turn the mention rule off:

```sh
openclaw config set channels.onepm.requireMention false --strict-json
```

Comments from other OnePM agents are dropped unless that agent's user id is in `allowFrom`. Don't allow two agents that both answer every comment, or they will answer each other.

### Triggers

A project admin can set **triggers** on the agent in **Project settings › Agents**: a task assigned to it entering a chosen status, or a linked pull request being opened, merged or closed. They arrive in the task's chat as a message from `OnePM` (sender id `onepm`) that says what happened, such as "Pull request #57 (acme/repo) was merged.". OnePM sends them, not a person, so `allowFrom` and `requireMention` don't apply to them. The agent's own changes never trigger it. Version 0.1.0 ignores them. A pull request message carries only what OnePM knows: the action, number, repository and URL. Its title and branch are written by whoever opened it, so they are left out (from 0.2.1, even when an older server sends them). The agent can open the URL itself, and should treat what it finds there as untrusted information, not instructions.

From 0.3.0, OpenClaw's typing indicator shows in OnePM: while the agent works on a task, its avatar has a red dot and "@handle is replying…" appears under the task's comment box. It clears when the turn goes idle, and after 10 minutes at most. An older OnePM without this feature is left alone.

## Run

```sh
openclaw gateway restart
```

Or run it in the foreground with `openclaw gateway run`. `openclaw channels status` then shows `OnePM default: enabled, configured, running, connected`, and the gateway log shows `[onepm] signed in as @<handle>`.

On its first start, the plugin skips the agent's earlier events and answers only new ones. It saves its place in `~/.openclaw/onepm/cursor.json`, so a restart picks up the events that arrived while the gateway was down. If you change the key or the server, the plugin starts fresh.

If another session connects with the same agent key, or you rotate the key, OnePM closes this connection and the plugin stays offline. Restart the gateway with the new key to reconnect.

To post on a task yourself, or from cron, address it as `task:<task id>`:

```sh
openclaw message send --channel onepm -t task:<task id> -m "Done"
```

## Add the OnePM tools

The plugin carries conversations. To let OpenClaw read and change tasks, also add the OnePM MCP server. It's named `onepm-agent`, because `openclaw mcp set` replaces an entry of the same name, and you may already have an `onepm` entry with your own token:

```sh
openclaw mcp set onepm-agent '{"url":"https://onepm.tabsystems.tech/api/mcp","transport":"streamable-http","headers":{"Authorization":"Bearer ${ONEPM_AGENT_KEY}"}}'
```

On a self-hosted instance, use its URL followed by `/api/mcp`. OpenClaw fills in `${ONEPM_AGENT_KEY}` from `~/.openclaw/.env` when it connects. The agent's scopes decide what these tools can do. If an earlier setup added this server as `onepm` with `${ONEPM_AGENT_KEY}`, remove that entry with `openclaw mcp unset onepm` so the tools aren't listed twice.

## Test

```sh
cd openclaw
npm test
```

The tests cover the parts that don't need OpenClaw: turning events into messages, the event cursor, the account config, and secret masking.
