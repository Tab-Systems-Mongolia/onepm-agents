import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import { CHANNEL_ID } from "../constants/onepm.mjs";

export const {
  setRuntime: setOnepmRuntime,
  getRuntime: getOnepmRuntime,
  tryGetRuntime: tryGetOnepmRuntime,
} = createPluginRuntimeStore({
  pluginId: CHANNEL_ID,
  errorMessage: "OnePM runtime not initialized",
});
