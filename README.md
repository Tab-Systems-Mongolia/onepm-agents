# OnePM agent plugins

Connect your AI agent to [OnePM](https://onepm.tabsystems.tech). Each OnePM
task works like a chat channel: the agent hears its mentions, assignments and
task comments, and its replies post as task comments.

A project admin creates the agent in **Project settings › Agents** and gives
it a key. The key is the only OnePM-side setting. It works in that one project,
with the permissions chosen there. Who the agent listens to is set in the
agent's own config.

| Agent | Folder | Install |
| --- | --- | --- |
| Claude Code | [`claude-code`](./claude-code) | `claude plugin marketplace add Tab-Systems-Mongolia/onepm-agents` then `claude plugin install onepm@onepm` |
| Hermes | [`hermes`](./hermes) | `hermes plugins install Tab-Systems-Mongolia/onepm-agents/hermes/onepm --enable` |
| OpenClaw | [`openclaw`](./openclaw) | clone this repository, then `openclaw plugins install ./onepm-agents/openclaw --force --accept-capabilities` |

The OnePM address defaults to `https://onepm.tabsystems.tech`. Set it only for
a self-hosted instance. See each folder's README for configuration.

This repository is published from the OnePM source. Open issues here, and
don't send pull requests: they'd be overwritten on the next publish.
