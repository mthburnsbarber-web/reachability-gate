import * as vscode from "vscode";
import { NotesPanel } from "./panel";
import { NotesTree } from "./tree";

export function activate(context: vscode.ExtensionContext) {
  const tree = new NotesTree();

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = "$(note) Notes";
  status.command = "sampleNotes.showStats";
  status.show();

  context.subscriptions.push(
    status,
    vscode.window.registerTreeDataProvider("sampleNotes.list", tree),
    vscode.commands.registerCommand("sampleNotes.openPanel", () => {
      NotesPanel.show(context.extensionUri);
      vscode.commands.executeCommand("sampleNotes.focusList");
    }),
    vscode.commands.registerCommand("sampleNotes.focusList", () => tree.focus()),
    vscode.commands.registerCommand("sampleNotes.refresh", () => tree.refresh()),
    vscode.commands.registerCommand("sampleNotes.showStats", () => showStats(tree)),
    vscode.commands.registerCommand("sampleNotes.createFirst", () => tree.create()),
    vscode.commands.registerCommand("sampleNotes.openNote", (id: string) => tree.open(id)),
    vscode.commands.registerCommand("sampleNotes.exportAll", exportAll),
  );
}

function showStats(tree: NotesTree) {
  vscode.window.showInformationMessage(`${tree.count} notes`);
}

async function exportAll() {
  const uri = await vscode.window.showSaveDialog({ filters: { Markdown: ["md"] } });
  if (uri) await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode("# Notes\n"));
}

export function deactivate() {}
