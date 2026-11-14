import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SERVER_VERSION } from "../constants/channel.mjs";
import { MCP_CLIENT_NAME, MCP_PATH } from "../constants/onepm.mjs";

// An MCP client on OnePM's /api/mcp, signed in with the agent key.
export const connectRemoteMcp = async ({ baseUrl, apiKey, timeoutMs }) => {
  const client = new Client({ name: MCP_CLIENT_NAME, version: SERVER_VERSION });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}${MCP_PATH}`),
    { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } },
  );
  try {
    await client.connect(transport, { timeout: timeoutMs });
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
  return client;
};
