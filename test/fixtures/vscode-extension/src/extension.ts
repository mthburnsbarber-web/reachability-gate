import * as vscode from "vscode";
import { NotesStore } from "./store";

export function activate(context: vscode.ExtensionContext) {
  const store = new NotesStore(context.globalState);

  context.subscriptions.push(
    // Listed in contributes.commands, so it is in the Command Palette.
    vscode.commands.registerCommand("sampleNotes.newNote", async () => {
      const title = await vscode.window.showInputBox({ prompt: "Note title" });
      if (title) await store.add(title);
    }),

    // Not in contributes.commands, but bound to a key. That is enough.
    vscode.commands.registerCommand("sampleNotes.quickCapture", () => store.capture()),

    // Contributed, then hidden from the palette, and in no menu or keybinding.
    vscode.commands.registerCommand("sampleNotes.archiveAll", () => store.archiveAll()),

    // In an editor/title menu entry, but missing from contributes.commands.
    vscode.commands.registerCommand("sampleNotes.pinNote", () => store.pinActive()),

    // Registered, never contributed. Only the test suite calls it.
    vscode.commands.registerCommand("sampleNotes.reindex", () => store.reindex()),
  );

  // vscode.commands.registerCommand("sampleNotes.importLegacy", () => store.importLegacy());
}

export function deactivate() {}
