// Every capability is a named action with one handler.
const handlers = new Map();

export const bus = {
  register(kind, handler) {
    handlers.set(kind, handler);
  },
  async dispatch(action) {
    const handler = handlers.get(action.kind);
    if (!handler) throw new Error(`no handler for ${action.kind}`);
    return handler(action);
  },
};
