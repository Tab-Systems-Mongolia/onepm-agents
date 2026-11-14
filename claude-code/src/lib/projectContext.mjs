import {
  CONTEXT_MAX_REPOSITORIES,
  CONTEXT_MAX_STATUSES,
  CONTEXT_NAME_MAX_LENGTH,
  PROJECT_CONTEXT_HEADING,
} from "../constants/channel.mjs";

// Workspace-written text goes into the server instructions as one short line.
const oneLine = (value) => {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > CONTEXT_NAME_MAX_LENGTH
    ? `${text.slice(0, CONTEXT_NAME_MAX_LENGTH)}…`
    : text;
};

const capped = (items, max, format) => {
  const shown = items.slice(0, max).map(format);
  const rest = items.length - shown.length;
  return rest > 0
    ? [...shown, `and ${rest} more`].join(", ")
    : shown.join(", ");
};

const projectLine = (self, project) => {
  const key = oneLine(project?.slug ?? self.projectSlug);
  const name = project?.name ? `${oneLine(project.name)} ` : "";
  const keyPart = key ? `(key ${key}, ` : "(";
  return `- Project: ${name}${keyPart}id ${oneLine(self.projectId)}). You are @${oneLine(self.handle)}; ticket IDs look like ${key || "KEY"}-12.`;
};

const statusLine = (columns) =>
  `- Statuses, in board order (a task's status is the column's slug): ${capped(
    columns,
    CONTEXT_MAX_STATUSES,
    (column) =>
      `${oneLine(column.slug)} "${oneLine(column.name)}"${column.isFinal ? " (final)" : ""}`,
  )}`;

const repositoryLine = (repositories) =>
  `- GitHub repositories: ${
    repositories.length
      ? capped(
          repositories,
          CONTEXT_MAX_REPOSITORIES,
          (repository) =>
            `${oneLine(repository.repositoryOwner)}/${oneLine(repository.repositoryName)}`,
        )
      : "none"
  }`;

// A few lines about the agent's project for the server instructions. Pieces
// that couldn't be read are left out.
export const formatProjectContext = ({
  self,
  project,
  columns,
  repositories,
}) =>
  [
    PROJECT_CONTEXT_HEADING,
    projectLine(self, project),
    ...(Array.isArray(columns) && columns.length ? [statusLine(columns)] : []),
    ...(Array.isArray(repositories) ? [repositoryLine(repositories)] : []),
  ].join("\n");
