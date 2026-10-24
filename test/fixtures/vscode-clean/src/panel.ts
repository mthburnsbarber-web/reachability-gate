import * as vscode from "vscode";

export class NotesPanel {
  static show(extensionUri: vscode.Uri) {
    const panel = vscode.window.createWebviewPanel("sampleNotes.panel", "Notes", vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [extensionUri],
    });
    panel.webview.html = `<!doctype html>
<button onclick="acquireVsCodeApi().postMessage({ type: 'export' })">Export</button>`;
    panel.webview.onDidReceiveMessage((message) => {
      if (message.type === "export") {
        vscode.commands.executeCommand("sampleNotes.exportAll");
      }
    });
  }
}
