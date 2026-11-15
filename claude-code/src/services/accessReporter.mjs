import { WILDCARD } from "../constants/onepm.mjs";
import { isNotFound } from "./onepmClient.mjs";

// Tells OnePM who may assign or mention the agent, from access.json, so it
// refuses everyone else up front instead of the session dropping their
// events. Sends only when the list differs from the last one OnePM took; a
// failed send is retried at the next sync. An older OnePM without the route
// answers 404, and then nothing more is sent.
export const createAccessReporter = ({ client, log }) => {
  let sent = null;
  let unsupported = false;
  let sending = false;

  const sync = async (access) => {
    if (unsupported || sending) return;
    // OnePM takes named users only: a wildcard would be refused.
    const allowFrom = [...new Set(access.allowFrom)]
      .filter((id) => !id.includes(WILDCARD))
      .sort();
    const key = JSON.stringify(allowFrom);
    if (key === sent) return;
    sending = true;
    try {
      await client.reportAccess(allowFrom);
      sent = key;
      log(`told OnePM who may reach the agent (${allowFrom.length})`);
    } catch (error) {
      if (isNotFound(error)) {
        unsupported = true;
        log("this OnePM doesn't take the agent's allowlist; skipping");
        return;
      }
      log(
        `couldn't report the allowlist: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      sending = false;
    }
  };

  return { sync };
};
