import { COMMENT_MAX_LENGTH } from "../constants/onepm.mjs";
import { splitReply } from "../lib/eventMessage.mjs";
import { maskSecrets } from "../lib/maskSecrets.mjs";

// Posts the agent's text as one or more comments on the task. Token-like
// secrets, the agent key among them, are masked first: every member of the
// project reads the task.
export const postReply = async ({ client, taskId, text, apiKey }) => {
  const parts = splitReply(
    maskSecrets(text ?? "", [apiKey]),
    COMMENT_MAX_LENGTH,
  );
  const ids = [];
  for (const part of parts) {
    const comment = await client.postComment(taskId, part);
    ids.push(comment?.id ?? null);
  }
  return ids;
};
