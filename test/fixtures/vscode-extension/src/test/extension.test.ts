import * as assert from "assert";
import * as vscode from "vscode";

suite("Sample Notes", () => {
  test("reindex runs", async () => {
    await vscode.commands.executeCommand("sampleNotes.reindex");
    assert.ok(true);
  });
});
