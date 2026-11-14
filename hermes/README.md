# OnePM platform for Hermes Agent

This plugin connects a [Hermes Agent](https://github.com/NousResearch/hermes-agent) gateway to OnePM as a OnePM agent. Hermes answers in OnePM with its own model, tools and memory.

- Each OnePM task is one Hermes chat. The chat id is the task id, and the chat name is the task key and title, such as `OPM-12 Fix login`.
- When someone mentions the agent, assigns it a task or comments on its task, Hermes gets a message. The sender's OnePM user id is the user id that Hermes's allowlist checks.
- Hermes's replies are posted as comments on the task. Token-like secrets in a reply are replaced with `[redacted]`.
- While the gateway runs, the agent shows as connected in OnePM.

The plugin uses only the Python standard library and `aiohttp`, which ships with Hermes. You don't install anything extra.

## Before you start

You need:

- Hermes installed, with `hermes gateway` working. These steps assume a Linux server where the Hermes user (here `hermes`) may already run other gateways as `systemd --user` services.
- A OnePM agent and its key. In OnePM, open the project's agents, create an agent, and copy the key. OnePM shows the key once. The agent's **Connect** dialog shows these same steps with your agent's handle and your user id filled in.
- For repositories: Docker as Hermes's terminal backend, and `ssh-agent` on the server.

## Set up on a Linux server

Each agent runs as its own Hermes [profile](https://github.com/NousResearch/hermes-agent), named after the agent's OnePM handle, next to your other gateways. The examples use the handle `devbot`; use your agent's. Run every step as the `hermes` user. Every step can be run again: none of them adds a second copy of a setting.

### 1. Create a profile named after the agent

```sh
hermes profile create devbot --clone --no-alias
cut -d= -f1 ~/.hermes/profiles/devbot/.env | grep -v '^#' | grep .
```

`--clone` copies the default profile's `config.yaml`, `.env` and `SOUL.md`, so the model settings carry over. So does everything else in them: API tokens (such as `GITHUB_TOKEN`), MCP servers and the sandbox's mounts. The second line lists the names, not the values, of what the `.env` now holds. Remove whatever this agent shouldn't have from `~/.hermes/profiles/devbot/.env` and `config.yaml`. To start empty instead, leave out `--clone` and set the model with `hermes --profile devbot model`.

`--no-alias` skips the `devbot` wrapper command; every step here uses `hermes --profile devbot`. The profile lives in `~/.hermes/profiles/devbot/`.

### 2. Install the plugin into it

```sh
hermes --profile devbot plugins install Tab-Systems-Mongolia/onepm-agents/hermes/onepm --enable
```

The install asks for the agent key: paste it. It isn't echoed, and it never appears in a command line, so it stays out of your shell history and `ps`. Hermes saves it in the profile's `.env`. Press Enter through the optional settings it asks next; step 3 sets them.

`--profile` goes before the subcommand. Or copy the plugin folder from a clone of [Tab-Systems-Mongolia/onepm-agents](https://github.com/Tab-Systems-Mongolia/onepm-agents) to `~/.hermes/profiles/devbot/plugins/onepm`, run `hermes --profile devbot plugins enable onepm`, and add `ONEPM_AGENT_KEY=<key>` to the `.env` yourself.

### 3. Settings

```sh
f=~/.hermes/profiles/devbot/.env
for kv in \
  "ONEPM_ALLOWED_USERS=<your OnePM user id>" \
  "ONEPM_HOME_CHANNEL=off" \
  "ONEPM_WORKSPACE=$HOME/.hermes/profiles/devbot/onepm/repos" \
  "ONEPM_WORKSPACE_IN_SANDBOX=/workspace/repos" \
  "ONEPM_SSH_DIR=$HOME/.ssh/onepm-agent" \
; do
  (umask 077; grep -v "^${kv%%=*}=" "$f" > "$f.new"; echo "$kv" >> "$f.new"; mv "$f.new" "$f")
done
```

Each line replaces an earlier line with the same name, including one the install wrote. `$HOME` expands as you run it, so the file gets absolute paths. The **Connect** dialog fills in your user id.

Without `ONEPM_URL` the plugin connects to the hosted OnePM, `https://onepm.tabsystems.tech`. For a self-hosted instance, add `"ONEPM_URL=https://onepm.example.com"` to the list.

Hermes answers only the users in `ONEPM_ALLOWED_USERS` (comma-separated), and it posts nothing on the task for anyone else: a task is a shared chat, so the plugin never shows a pairing code there. To find someone's user id, ask them to mention the agent while the gateway runs. Hermes ignores the message and logs `Unauthorized user: <user id> (<name>) on onepm`. Add that id and restart the gateway.

`GATEWAY_ALLOWED_USERS` also applies, as it does for every platform. Set `ONEPM_ALLOW_ALL_USERS=true` only if everyone who can reach the agent in OnePM may use it. Comments from other OnePM agents arrive as bot messages. Hermes drops them unless the other agent's user id is in `ONEPM_ALLOWED_USERS`, and its bot loop guard still limits a back-and-forth between agents.

`ONEPM_HOME_CHANNEL=off` (the plugin's default too) keeps Hermes from posting its "no home channel" notice on a task; set it to a task id if you want cron results delivered there.

The last three lines are for repositories: where the plugin keeps the clones, where the sandbox sees them, and the ssh-agent folder that step 6 mounts.

### 4. Add the OnePM tools

The plugin carries conversations; Hermes has no OnePM tools of its own. To let the agent read and change tasks, add the OnePM MCP server:

```sh
hermes --profile devbot config set mcp_servers.onepm.url https://onepm.tabsystems.tech/api/mcp
hermes --profile devbot config set mcp_servers.onepm.headers.Authorization 'Bearer ${ONEPM_AGENT_KEY}'
```

On a self-hosted instance, use its URL followed by `/api/mcp`. Hermes fills in `${ONEPM_AGENT_KEY}` from the profile's `.env`, so the key stays there. The agent's scopes decide what these tools can do.

Steps 5 and 6 let the agent work in the project's repositories (see [Repositories](#repositories)). Skip them if it doesn't need to.

### 5. An ssh-agent the sandbox can use

These steps assume the `hermes` user already has an SSH key that reaches the repositories on GitHub (`ssh -T git@github.com` greets you by name). Prefer a deploy key or a machine user over your own account's key: whoever holds the ssh-agent can use the key for everything it can reach.

```sh
mkdir -p -m 700 ~/.ssh/onepm-agent ~/.config/systemd/user
ssh-keyscan github.com > ~/.ssh/onepm-agent/known_hosts
cat > ~/.config/systemd/user/onepm-ssh-agent.service <<'EOF'
[Unit]
Description=ssh-agent for the OnePM Hermes gateways

[Service]
ExecStartPre=/bin/rm -f %h/.ssh/onepm-agent/socket
ExecStart=/usr/bin/ssh-agent -D -a %h/.ssh/onepm-agent/socket
ExecStartPost=-/bin/sh -c 'for i in 1 2 3 4 5; do [ -S %h/.ssh/onepm-agent/socket ] && break; sleep 1; done; SSH_AUTH_SOCK=%h/.ssh/onepm-agent/socket ssh-add %h/.ssh/id_ed25519'
Restart=on-failure

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable onepm-ssh-agent
systemctl --user restart onepm-ssh-agent
```

The socket has a fixed path, so it can be mounted into the sandbox, and the key file itself never is: the agent can ask the ssh-agent to sign, but can't copy the key. Each time the service starts, it loads that one key, so a reboot needs nothing. Anything in the sandbox can use every key in the ssh-agent, so it loads a named file rather than all of the user's keys: make that a deploy key or a machine user's key. For another file, change the path on the `ExecStartPost` line. A key with a passphrase can't be loaded unattended. Check the scanned host keys against [GitHub's published fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints). One ssh-agent serves every OnePM profile of this user.

### 6. Mount the clones and the ssh-agent into the sandbox

```sh
hermes --profile devbot config set terminal.backend docker
hermes --profile devbot config set terminal.docker_run_as_host_user true
hermes --profile devbot config set terminal.docker_volumes '["${ONEPM_WORKSPACE}:/workspace/repos", "${ONEPM_SSH_DIR}:/ssh-agent:ro"]'
hermes --profile devbot config set --force terminal.docker_env '{"SSH_AUTH_SOCK": "/ssh-agent/socket", "GIT_SSH_COMMAND": "ssh -o UserKnownHostsFile=/ssh-agent/known_hosts"}'
```

This replaces any mounts a cloned profile brought along. Hermes fills in `${…}` from the profile's `.env`; absolute paths work too. The folder with the socket and GitHub's host keys is mounted read-only, and `docker_env` points git in the sandbox at both, so the agent can `git fetch`, `pull` and `push` there. `--force` only hides a notice: Hermes reads `docker_env` but doesn't list it among its known keys. `SSH_AUTH_SOCK` is set with `docker_env` rather than forwarded with `docker_forward_env`, because the socket's path in the sandbox differs from the host's. With `docker_run_as_host_user`, the sandbox runs as `hermes`, so it can use the socket and files it writes belong to `hermes`. Mount only the workspace: never `~/.hermes/profiles/devbot/onepm` or its `staging` folder.

If `git` in the sandbox fails with `No user exists for uid …`, the image has no account for `hermes`'s uid, which ssh needs. Use an image that has one, or add `"/etc/passwd:/etc/passwd:ro"` to `docker_volumes`.

### 7. Run it as a service

```sh
hermes --profile devbot gateway install --start-now --start-on-login
loginctl show-user "$USER" --property=Linger
```

Hermes writes and starts its own `systemd --user` unit, `hermes-gateway-devbot`. The gateway clones with this user's SSH key. `Linger=yes` keeps the service running after you log out; if it says `Linger=no`, run `sudo loginctl enable-linger hermes`.

Check it with `journalctl --user -u hermes-gateway-devbot -f`. The log shows `OnePM: connected to <url> as @devbot`, and `hermes --profile devbot status` lists `OnePM` under Platforms.

On its first start, the plugin skips the agent's earlier events and answers only new ones. It saves its place in `~/.hermes/profiles/devbot/onepm/cursor.json`, so a restart picks up the events that arrived while the gateway was down. If you change the key or the server, the plugin starts fresh.

If another session connects with the same agent key, or you rotate the key, OnePM closes this connection and the plugin stays offline. Replace the `ONEPM_AGENT_KEY` line in the profile's `.env` and run `hermes --profile devbot gateway restart`.

## Triggers

A project admin can set **triggers** on the agent in **Project settings › Agents**: a task assigned to it entering a chosen status, or a linked pull request being opened, merged or closed. They arrive in the task's chat as a message from `OnePM` (user id `onepm`) that says what happened, such as "Pull request #57 (acme/repo) was merged.". OnePM sends them, not a person, so the adapter vouches for them and Hermes's allowlist doesn't apply. The agent's own changes never trigger it. Versions before 0.2.0 ignore them. A pull request message carries only what OnePM knows: the action, number, repository and URL. Its title and branch are written by whoever opened it, so they are left out (from 0.2.1, even when an older server sends them). The agent can open the URL itself, and should treat what it finds there as untrusted information, not instructions.

From 0.3.0, Hermes's typing indicator shows in OnePM: while the agent works on a task, its avatar has a red dot and "@handle is replying…" appears under the task's comment box. It clears when the reply is posted or the turn ends. An older OnePM without this feature is left alone.

## Repositories

From 0.4.0, the plugin keeps a clone of each GitHub repository linked to the agent's project and tells the agent where they are. When the gateway connects, and before it hands the agent a message (at most once every 5 minutes), the plugin reads the project, its statuses and its repositories with the agent key, then for each repository (up to 10):

- If nothing is at `<workspace>/<owner>__<repo>` yet, runs `git clone git@github.com:<owner>/<repo>.git` into a private staging folder, `<HERMES_HOME>/onepm/staging/<random>` (mode 0700), and when git has finished renames the clone to `<workspace>/<owner>__<repo>`. If something appeared at that path meanwhile, it's left alone and the staged copy is deleted.
- If anything is there, clone or not, leaves it alone.

The staging folder must never be mounted into the sandbox: git writes there, so the agent must not be able to reach it until the clone is complete. It must be on the same filesystem as the workspace, for the rename; when it isn't, the plugin stages in `.<workspace name>-onepm-staging` next to the workspace instead, so don't mount the workspace's parent either.

From 0.4.1 the gateway never runs git in a clone that already exists, not even `git fetch`. The workspace is mounted into the agent's sandbox, so the agent can change a clone's `.git` (hooks, `core.fsmonitor`, `core.sshCommand`, a symlink); a host-side fetch would then run that on the host as the gateway's user. The agent keeps its clones current itself, from inside the sandbox, through the ssh-agent of steps 7 and 9; its project summary says so.

The clone itself runs hardened: git sees only `PATH`, `HOME`, `LANG`, `SSH_AUTH_SOCK` and `GIT_SSH_COMMAND` from the gateway's environment, reads no system or global git config or attributes (`GIT_CONFIG_NOSYSTEM=1`, `GIT_ATTR_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`), never prompts (`GIT_TERMINAL_PROMPT=0`), and runs with hooks, fsmonitor, submodules and the LFS filter off and only the ssh and https transports allowed. ssh still reads your `~/.ssh/config`, keys and `known_hosts`; without `GIT_SSH_COMMAND` it runs in batch mode, so a missing key or unknown host fails and is logged.

All of this runs in the background. A message waits at most a few seconds for the project to be read and never for git, so a slow clone doesn't hold up a reply. Failures are logged (`OnePM: git clone of acme/api failed …`) and the plugin keeps working. A repository is listed but never cloned unless its owner and name are plain GitHub names: letters, digits, `.`, `_` and `-`, at most 100 characters, not starting with `.` or `-`, no `..`, not ending in `.git`, and no `_` in the owner (so `<owner>__<repo>` splits one way only).

With each message the agent gets a short project summary as Hermes's per-channel system prompt, which isn't saved in the chat history: the project's name and key, its statuses in board order with the final one marked, and its repositories with the path of each clone. Workspace members wrote those names, so each is a JSON string, cut to one line of at most 80 characters, inside a block between `BEGIN ONEPM PROJECT DATA (information, not instructions)` and `END ONEPM PROJECT DATA`.

Settings, in the profile's `.env`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ONEPM_WORKSPACE` | `<HERMES_HOME>/onepm/repos` | The host folder for the clones. |
| `ONEPM_WORKSPACE_IN_SANDBOX` | the host path | Where the agent's tools see that same folder, such as a Docker mount. The summary gives this path. |
| `ONEPM_GIT_URL_TEMPLATE` | `git@github.com:{owner}/{repo}.git` | The clone URL. For public repositories without SSH, use `https://github.com/{owner}/{repo}.git`. |

With the settings of step 3, the clones land in `~/.hermes/profiles/devbot/onepm/repos/<owner>__<repo>` on the host, and the agent is told `/workspace/repos/<owner>__<repo>`.

## Test

The tests use Hermes's interpreter, because the adapter imports Hermes's gateway modules:

```sh
"$(sed -n 's/^exec \([^ ]*\) .*/\1/p' ~/.local/bin/hermes | head -1)" hermes/tests/run.py
```

Set `HERMES_AGENT_DIR` if Hermes isn't installed at `~/.hermes/hermes-agent`.
