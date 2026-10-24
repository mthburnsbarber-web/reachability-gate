import * as vscode from "vscode";

interface Note {
  id: string;
  title: string;
}

export class NotesTree implements vscode.TreeDataProvider<Note> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private notes: Note[] = [];

  get count() {
    return this.notes.length;
  }

  getTreeItem(note: Note): vscode.TreeItem {
    const item = new vscode.TreeItem(note.title);
    item.command = { command: "sampleNotes.openNote", title: "Open Note", arguments: [note.id] };
    return item;
  }

  getChildren(): Note[] {
    return this.notes;
  }

  refresh() {
    this.changed.fire();
  }

  focus() {
    return vscode.commands.executeCommand("sampleNotes.list.focus");
  }

  create() {
    this.notes.push({ id: String(Date.now()), title: "Untitled" });
    this.refresh();
  }

  open(id: string) {
    const note = this.notes.find((n) => n.id === id);
    if (note) vscode.window.showInformationMessage(note.title);
  }
}
