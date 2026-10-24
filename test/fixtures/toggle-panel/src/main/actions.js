import { bus } from "./bus.js";
import { notes } from "./notes.js";
import { privateMode } from "./private-mode.js";

bus.register("notes.open", ({ id }) => notes.open(id));
bus.register("privateMode.enter", () => privateMode.enter());
bus.register("privateMode.exit", () => privateMode.exit());
