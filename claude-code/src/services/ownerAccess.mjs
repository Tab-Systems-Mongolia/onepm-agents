import { ownerAccess } from "../lib/access.mjs";
import { errorMessage } from "../lib/errorMessage.mjs";

// On a profile's first start, lets the agent's owner reach it without running
// /onepm:access. `self` is the server's answer to GET /project-agent/self for
// this agent's key, the only source trusted for the owner's id. An existing
// access.json is never touched, so an owner who removed themself stays out.
export const allowOwnerOnFirstStart = ({ state, self, log }) => {
  if (state.hasAccessFile()) return false;
  const access = ownerAccess(self);
  if (!access) {
    log(
      `the server didn't say who owns this agent, so ${state.accessPath} is left as it is; run /onepm:access allow <your user id> to reach it`,
    );
    return false;
  }
  try {
    if (!state.createAccessIfMissing(access)) return false;
  } catch (error) {
    log(`couldn't write ${state.accessPath}: ${errorMessage(error)}`);
    return false;
  }
  log(
    `allowed the agent's owner (${access.allowFrom[0]}) in ${state.accessPath}; /onepm:access manages it from now on`,
  );
  return true;
};
