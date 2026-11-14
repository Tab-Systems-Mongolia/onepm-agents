import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import {
  createAccountStatusSink,
  runPassiveAccountLifecycle,
} from "openclaw/plugin-sdk/channel-outbound";
import {
  CHANNEL_ID,
  CHANNEL_LABEL,
  COMMENT_MAX_LENGTH,
  DEFAULT_ACCOUNT_ID,
  ENV_AGENT_KEY,
} from "../constants/onepm.mjs";
import {
  describeOnepmAccount,
  normalizeAllowEntry,
  normalizeTaskTarget,
  resolveOnepmAccount,
} from "../lib/account.mjs";
import { createOnepmClient } from "../services/onepmClient.mjs";
import { postReply } from "../services/postReply.mjs";

const meta = {
  id: CHANNEL_ID,
  label: CHANNEL_LABEL,
  selectionLabel: "OnePM (project agent key)",
  detailLabel: CHANNEL_LABEL,
  docsPath: "/channels/onepm",
  docsLabel: "onepm",
  blurb: "OnePM tasks as group chats: mentions, assignments and comments.",
  markdownCapable: true,
};

const resolveAccount = (cfg) => resolveOnepmAccount(cfg);

// Posts text on a task for the message tool, cron and announces. Replies to
// an inbound event go through the same postReply.
const sendText = async ({ cfg, to, text }) => {
  const account = resolveAccount(cfg);
  const taskId = normalizeTaskTarget(to);
  if (!account.configured)
    throw new Error("OnePM isn't configured (channels.onepm.agentKey)");
  if (!taskId) throw new Error(`not a OnePM task: ${to}`);
  const ids = await postReply({
    client: createOnepmClient(account.baseUrl, account.apiKey),
    taskId,
    text,
    apiKey: account.apiKey,
  });
  return { messageId: ids.at(-1) ?? undefined };
};

const startAccount = async (ctx) => {
  const account = ctx.account;
  if (!account.configured) {
    throw new Error(
      `OnePM needs channels.onepm.agentKey (or ${ENV_AGENT_KEY})`,
    );
  }
  const statusSink = createAccountStatusSink({
    accountId: ctx.accountId,
    setStatus: ctx.setStatus,
  });
  const log = (line) => ctx.log?.info?.(`[onepm] ${line}`);
  if (account.allowFrom.length === 0) {
    log(
      "channels.onepm.allowFrom is empty: every event is dropped until a OnePM user id is added",
    );
  }
  const { startOnepmMonitor } = await import("./monitor.mjs");
  await runPassiveAccountLifecycle({
    abortSignal: ctx.abortSignal,
    start: async () =>
      startOnepmMonitor({
        account,
        cfg: ctx.cfg,
        abortSignal: ctx.abortSignal,
        statusSink,
        log,
      }),
    stop: async (monitor) => monitor.stop(),
  });
};

export const onepmPlugin = createChatChannelPlugin({
  base: {
    id: CHANNEL_ID,
    meta,
    capabilities: { chatTypes: ["group"], media: false, blockStreaming: false },
    reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
    config: {
      listAccountIds: () => [DEFAULT_ACCOUNT_ID],
      defaultAccountId: () => DEFAULT_ACCOUNT_ID,
      resolveAccount,
      inspectAccount: (cfg) => describeOnepmAccount(resolveAccount(cfg)),
      isEnabled: (account) => account.enabled,
      isConfigured: (account) => account.configured,
      unconfiguredReason: () =>
        `set channels.onepm.agentKey (or ${ENV_AGENT_KEY})`,
      describeAccount: (account) => describeOnepmAccount(account),
      hasConfiguredState: ({ cfg, env }) =>
        resolveOnepmAccount(cfg, env ?? process.env).configured,
      resolveAllowFrom: ({ cfg }) => resolveAccount(cfg).allowFrom,
      formatAllowFrom: ({ allowFrom }) =>
        allowFrom.map((entry) => normalizeAllowEntry(entry)).filter(Boolean),
    },
    groups: {
      resolveRequireMention: ({ cfg }) => resolveAccount(cfg).requireMention,
    },
    messaging: {
      targetPrefixes: [CHANNEL_ID, "task"],
      normalizeTarget: normalizeTaskTarget,
      inferTargetChatType: () => "group",
      targetResolver: {
        looksLikeId: (raw) => Boolean(normalizeTaskTarget(raw)),
        hint: "task:<task id>",
      },
    },
    gateway: { startAccount },
  },
  security: {
    dm: {
      channelKey: CHANNEL_ID,
      resolvePolicy: () => "allowlist",
      resolveAllowFrom: (account) => account.allowFrom,
      defaultPolicy: "allowlist",
    },
  },
  outbound: {
    base: {
      deliveryMode: "direct",
      textChunkLimit: COMMENT_MAX_LENGTH,
    },
    attachedResults: {
      channel: CHANNEL_ID,
      sendText: ({ onDeliveryResult: _onDeliveryResult, ...ctx }) =>
        sendText(ctx),
    },
  },
});
