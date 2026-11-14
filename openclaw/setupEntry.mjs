import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { onepmPlugin } from "./src/channel/plugin.mjs";

export default defineSetupPluginEntry(onepmPlugin);
