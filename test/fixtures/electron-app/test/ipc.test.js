const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ipcRenderer } = require("./helpers/fake-electron.js");

test("settings can be reset", async () => {
  const result = await ipcRenderer.invoke("settings:reset");
  assert.equal(result.ok, true);
});
