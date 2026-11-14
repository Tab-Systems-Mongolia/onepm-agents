import { createChannelInboundEnvelopeBuilderAsync } from "openclaw/plugin-sdk/channel-inbound";
import { defineStableChannelIngressIdentity } from "openclaw/plugin-sdk/channel-ingress-runtime";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import { CHANNEL_ID, CHANNEL_LABEL } from "../constants/onepm.mjs";
import { normalizeAllowEntry, taskTarget } from "../lib/account.mjs";
import {
  addressesAgent,
  formatEvent,
  ingressPolicy,
} from "../lib/eventMessage.mjs";
import { dispatchTurn } from "../services/dispatchTurn.mjs";
import { getOnepmRuntime } from "./runtime.mjs";

// The sender is the event's actorId: the OnePM server, reached with the
// agent's key, says who acted, so the id is bound to the sender.
export const onepmIngressIdentity = defineStableChannelIngressIdentity({
  key: "onepm-user-id",
  authentication: "verified",
  normalizeEntry: (entry) => normalizeAllowEntry(entry) || null,
  normalizeSubject: (value) => normalizeAllowEntry(value),
  sensitivity: "pii",
  isWildcardEntry: (entry) => normalizeAllowEntry(entry) === "*",
  resolveEntryId: ({ entryIndex }) => `onepm-entry-${entryIndex + 1}`,
});

// Every task is a group chat (chat id = task id) and OnePM has no direct
// messages, so only the group gates apply. There is no pairing: a code
// posted on a task would be public. A sender outside allowFrom is dropped
// without an answer. A trigger event is from OnePM itself and passes.
const resolveAccess = ({ core, cfg, account, event, wasMentioned, route }) => {
  const policy = ingressPolicy(account, event);
  return core.channel.inbound.ingress
    .createResolver({
      channelId: CHANNEL_ID,
      accountId: account.accountId,
      identity: onepmIngressIdentity,
      cfg,
      readStoreAllowFrom: async () => [],
    })
    .message({
      subject: { stableId: normalizeAllowEntry(policy.senderId) },
      conversation: { kind: "group", id: event.taskId },
      ...(route
        ? {
            contextBinding: {
              agentId: route.agentId,
              sessionKey: route.sessionKey,
              messageId: String(event.id),
              inboundEventKind: "user_request",
            },
          }
        : {}),
      route: [],
      mentionFacts: {
        canDetectMention: true,
        wasMentioned,
        hasAnyMention: wasMentioned,
      },
      dmPolicy: "allowlist",
      groupPolicy: "allowlist",
      policy: {
        groupAllowFromFallbackToAllowFrom: true,
        activation: {
          requireMention: policy.requireMention,
          allowTextCommands: false,
        },
      },
      allowFrom: policy.allowFrom,
      groupAllowFrom: policy.allowFrom,
      command: { allowTextCommands: false, hasControlCommand: false },
    });
};

const routeFor = (cfg, account, taskId) =>
  resolveAgentRoute({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: { kind: "group", id: taskId },
  });

// Asked before the task or comment is read: would OpenClaw take anything
// from this sender at all? Mentions are assumed, so only the sender counts.
export const admitsSender = async ({ cfg, account, event }) => {
  const access = await resolveAccess({
    core: getOnepmRuntime(),
    cfg,
    account,
    event,
    wasMentioned: true,
  });
  return access.ingress.admission === "dispatch";
};

// One OnePM event → one OpenClaw turn, if OpenClaw's allowlist and mention
// gate admit it. The agent's reply goes back through `postReply`.
export const handleOnepmInbound = async ({
  cfg,
  account,
  self,
  event,
  details,
  postReply,
  typing,
  log,
  statusSink,
}) => {
  const core = getOnepmRuntime();
  const message = formatEvent(event, details);
  const wasMentioned = addressesAgent(event, details.text, self);
  const route = routeFor(cfg, account, message.chatId);
  const access = await resolveAccess({
    core,
    cfg,
    account,
    event,
    wasMentioned,
    route,
  });
  if (access.ingress.admission !== "dispatch") {
    log(
      `dropped ${event.kind} ${event.id} from ${event.actorId} (${access.ingress.admission}${
        access.ingress.reasonCode ? `: ${access.ingress.reasonCode}` : ""
      })`,
    );
    return { dispatched: false };
  }
  statusSink?.({ lastInboundAt: message.timestamp });
  const body = (await createChannelInboundEnvelopeBuilderAsync({ cfg, route }))(
    {
      channel: CHANNEL_LABEL,
      from: message.chatLabel,
      timestamp: message.timestamp,
      body: message.body,
    },
  );
  const target = taskTarget(message.chatId);
  const ctxPayload = core.channel.inbound.buildContext({
    channelIngress: access,
    channel: CHANNEL_ID,
    accountId: route.accountId,
    messageId: message.messageId,
    timestamp: message.timestamp,
    from: target,
    sender: {
      id: message.senderId,
      ...(message.senderName ? { name: message.senderName } : {}),
    },
    conversation: {
      kind: "group",
      id: message.chatId,
      label: message.chatLabel,
    },
    route: {
      agentId: route.agentId,
      dmScope: route.dmScope,
      accountId: route.accountId,
      routeSessionKey: route.sessionKey,
    },
    reply: { to: target, originatingTo: target },
    message: {
      body,
      bodyForAgent: message.body,
      rawBody: message.body,
      commandBody: message.body,
    },
    access: {
      commands: { authorized: false },
      mentions: { canDetectMention: true, wasMentioned },
    },
    extra: { GroupSubject: message.chatLabel },
  });
  const dispatch = () =>
    core.channel.inbound.dispatch({
      cfg,
      channel: CHANNEL_ID,
      accountId: account.accountId,
      route: { agentId: route.agentId, sessionKey: route.sessionKey },
      ctxPayload,
      delivery: {
        deliver: async (payload) => {
          const text = [payload.text, ...(payload.mediaUrls ?? [])]
            .filter(Boolean)
            .join("\n\n");
          if (!text.trim()) return;
          await postReply(message.chatId, text);
          statusSink?.({ lastOutboundAt: Date.now() });
        },
        onError: (error, info) => {
          log(
            `${info?.kind ?? "reply"} to task ${message.chatId} failed: ${String(error)}`,
          );
        },
      },
      // OnePM shows the agent replying on the task while the turn runs.
      replyPipeline: typing ? { typing } : {},
      replyOptions: {},
      record: {
        onRecordError: (error) => {
          log(`couldn't update session meta: ${String(error)}`);
        },
      },
    });
  await dispatchTurn({
    dispatch,
    log,
    label: `${event.kind} ${event.id} on ${message.chatLabel}`,
  });
  return { dispatched: true };
};
