import { API_KEY_HEADER, RATE_LIMITED_STATUS } from "../constants/onepm.mjs";

export class OnepmHttpError extends Error {
  constructor(method, path, status) {
    super(`${method} ${path}: HTTP ${status}`);
    this.status = status;
  }
}

export const createOnepmClient = (baseUrl, apiKey, fetchImpl = fetch) => {
  const request = async (path, init = {}) => {
    const method = init.method ?? "GET";
    const response = await fetchImpl(`${baseUrl}/api${path}`, {
      ...init,
      method,
      headers: { "content-type": "application/json", [API_KEY_HEADER]: apiKey },
    });
    if (!response.ok) throw new OnepmHttpError(method, path, response.status);
    return response.json();
  };
  const id = (value) => encodeURIComponent(value);

  return {
    // init carries an optional abort signal.
    self: (init) => request("/project-agent/self", init),
    project: (projectId, init) => request(`/project/${id(projectId)}`, init),
    columns: (projectId, init) => request(`/column/${id(projectId)}`, init),
    repositories: (projectId, init) =>
      request(`/github-repository/project/${id(projectId)}`, init),
    events: (after) =>
      request(
        `/project-agent/events${after === null ? "" : `?after=${after}`}`,
      ),
    task: (taskId) => request(`/task/${id(taskId)}`),
    comments: (taskId) => request(`/comment/${id(taskId)}`),
    postComment: (taskId, content) =>
      request(`/comment/${id(taskId)}`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }),
  };
};

export const isRateLimited = (error) =>
  error instanceof OnepmHttpError && error.status === RATE_LIMITED_STATUS;
