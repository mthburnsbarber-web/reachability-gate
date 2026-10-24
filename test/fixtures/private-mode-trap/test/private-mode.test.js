import { test } from "node:test";
import assert from "node:assert/strict";
import { bus } from "../src/main/bus.js";
import { privateMode } from "../src/main/private-mode.js";
import "../src/main/actions.js";

test("Private Mode can be entered and left", async () => {
  await bus.dispatch({ kind: "privateMode.enter" });
  assert.equal(privateMode.active, true);
  await bus.dispatch({ kind: "privateMode.exit" });
  assert.equal(privateMode.active, false);
});
