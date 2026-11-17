// One tool list for Claude: the channel's own tools, then OnePM's (remote is
// null in an idle session). A call goes to whichever has the name.
// onRemoteResult sees each OnePM call and its result, e.g. to follow status.
export const createToolRouter = ({
  definitions,
  local,
  remote,
  onRemoteResult = () => {},
}) => {
  const localNames = new Set(definitions.map(({ name }) => name));

  return {
    list: async () => [...definitions, ...(remote ? await remote.list() : [])],
    call: async (name, args) => {
      if (!localNames.has(name) && remote) {
        const result = await remote.call(name, args);
        onRemoteResult(name, args, result);
        if (result) return result;
      }
      return local.call(name, args);
    },
  };
};
