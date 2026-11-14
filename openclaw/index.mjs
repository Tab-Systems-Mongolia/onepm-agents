import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { onepmPlugin } from "./src/channel/plugin.mjs";
import { setOnepmRuntime } from "./src/channel/runtime.mjs";

export default defineChannelPluginEntry({
  id: "onepm",
  name: "OnePM",
  description: "OnePM tasks as an OpenClaw channel for a project agent",
  plugin: onepmPlugin,
  setRuntime: setOnepmRuntime,
});
