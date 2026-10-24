import { bus } from "./bus.js";
import { notes } from "./notes.js";
import { privateMode } from "./private-mode.js";

bus.register("notes.open", ({ id }) => notes.open(id));
bus.register("notes.search", ({ query }) => notes.search(query));
bus.register("privateMode.enter", () => privateMode.enter());
bus.register("privateMode.exit", () => privateMode.exit());

// While Private Mode is on, only these actions may run.
export const PRIVATE_MODE_ALLOWLIST = new Set(["notes.open", "privateMode.exit"]);
