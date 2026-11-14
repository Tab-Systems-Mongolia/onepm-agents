import { errorMessage } from "../lib/errorMessage.mjs";
import { formatProjectContext } from "../lib/projectContext.mjs";

const settled = (outcome) =>
  outcome.status === "fulfilled" ? outcome.value : undefined;

// Reads the agent's project with its own key: who it is, then the project,
// its columns and its GitHub repositories. Gives up after timeoutMs so the
// session isn't held up; the server then starts with plain instructions.
export const loadProjectContext = async ({ client, timeoutMs, log }) => {
  const controller = new AbortController();
  const init = { signal: controller.signal };
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });

  const load = async () => {
    const self = await client.self(init);
    const [project, columns, repositories] = await Promise.allSettled([
      client.project(self.projectId, init),
      client.columns(self.projectId, init),
      client.repositories(self.projectId, init),
    ]);
    return {
      self,
      summary: formatProjectContext({
        self,
        project: settled(project),
        columns: settled(columns),
        repositories: settled(repositories),
      }),
    };
  };

  try {
    return await Promise.race([load(), timeout]);
  } catch (error) {
    log(`starting without the project summary: ${errorMessage(error)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
};
