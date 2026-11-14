# OnePM platform for Hermes Agent

This plugin connects a [Hermes Agent](https://github.com/NousResearch/hermes-agent) gateway to OnePM as a OnePM agent. Hermes answers in OnePM with its own model, tools and memory.

- Each OnePM task is one Hermes chat. The chat id is the task id, and the chat name is the task key and title, such as `OPM-12 Fix login`.
- When someone mentions the agent, assigns it a task or comments on its task, Hermes gets a message. The sender's OnePM user id is the user id that Hermes's allowlist checks.
- Hermes's replies are posted as comments on the task. Token-like secrets in a reply are replaced with `[redacted]`.
- While the gateway runs, the agent shows as connected in OnePM.

The plugin uses only the Python standard library and `aiohttp`, which ships with Hermes. You don't install anything extra.

## Before you start

You need:

- Hermes installed, with `hermes gateway` working.
- A OnePM agent and its key. In OnePM, open the project's agents, create an agent, and copy the key. OnePM shows the key once.

## Install

Install from GitHub:

```sh
hermes plugins install Tab-Systems-Mongolia/onepm-agents/hermes/onepm --enable
```

Or copy the plugin folder from a clone of
[Tab-Systems-Mongolia/onepm-agents](https://github.com/Tab-Systems-Mongolia/onepm-agents)
and enable it:

```sh
cp -R onepm-agents/hermes/onepm ~/.hermes/plugins/onepm
hermes plugins enable onepm
```

## Configure

Add the agent key to `~/.hermes/.env`:

```sh
ONEPM_AGENT_KEY=<the agent key>
```

Without `ONEPM_URL` the plugin connects to the hosted OnePM, `https://onepm.tabsystems.tech`. For a self-hosted instance, add its URL too:

```sh
ONEPM_URL=https://onepm.example.com
```

Then allow the OnePM users the agent answers. Hermes ignores everyone else, and it posts nothing on the task for them: a task is a shared chat, so the plugin never shows a pairing code there.

```sh
ONEPM_ALLOWED_USERS=<user id>,<user id>
```

The plugin sets `ONEPM_HOME_CHANNEL=off`, so Hermes doesn't post its "no home channel" notice on a task; set it to a task id if you want cron results delivered there.


To find someone's user id, ask them to mention the agent while the gateway runs. Hermes ignores the message and logs `Unauthorized user: <user id> (<name>) on onepm`. Add that id and restart the gateway.

`GATEWAY_ALLOWED_USERS` also applies, as it does for every platform. Set `ONEPM_ALLOW_ALL_USERS=true` only if everyone who can reach the agent in OnePM may use it.

Comments from other OnePM agents arrive as bot messages. Hermes drops them unless the other agent's user id is in `ONEPM_ALLOWED_USERS`, and its bot loop guard still limits a back-and-forth between agents.

### Triggers

A project admin can set **triggers** on the agent in **Project settings › Agents**: a task assigned to it entering a chosen status, or a linked pull request being opened, merged or closed. They arrive in the task's chat as a message from `OnePM` (user id `onepm`) that says what happened, such as "Pull request #57 (acme/repo) was merged: Fix the board". OnePM sends them, not a person, so the adapter vouches for them and Hermes's allowlist doesn't apply. The agent's own changes never trigger it. Versions before 0.2.0 ignore them.

## Run

```sh
hermes gateway run
```

`hermes status` lists `OnePM` under Platforms once `ONEPM_AGENT_KEY` is set. The gateway log shows `OnePM: connected to <url> as @<handle>`.

On its first start, the plugin skips the agent's earlier events and answers only new ones. It saves its place in `~/.hermes/onepm/cursor.json`, so a restart picks up the events that arrived while the gateway was down. If you change the key or the server, the plugin starts fresh.

If another session connects with the same agent key, or you rotate the key, OnePM closes this connection and the plugin stays offline. Restart the gateway with the new key to reconnect.

## Add the OnePM tools

The plugin carries conversations. To let Hermes read and change tasks, also add the OnePM MCP server to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  onepm:
    url: https://onepm.tabsystems.tech/api/mcp
    headers:
      Authorization: Bearer ${ONEPM_AGENT_KEY}
```

On a self-hosted instance, use its URL followed by `/api/mcp`.

Hermes fills in `${ONEPM_AGENT_KEY}` from your environment, so the key stays in `.env`.

The agent's scopes decide what these tools can do.

## Test

The tests use Hermes's interpreter, because the adapter imports Hermes's gateway modules:

```sh
"$(sed -n 's/^exec \([^ ]*\) .*/\1/p' ~/.local/bin/hermes | head -1)" hermes/tests/run.py
```

Set `HERMES_AGENT_DIR` if Hermes isn't installed at `~/.hermes/hermes-agent`.
