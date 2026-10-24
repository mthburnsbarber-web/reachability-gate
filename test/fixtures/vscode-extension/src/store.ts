import * as vscode from "vscode";

interface Note {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
}

export class NotesStore {
  constructor(private readonly state: vscode.Memento) {}

  private get notes(): Note[] {
    return this.state.get<Note[]>("notes", []);
  }

  async add(title: string) {
    await this.state.update("notes", [...this.notes, { id: String(Date.now()), title, pinned: false, archived: false }]);
  }

  async capture() {
    const text = vscode.window.activeTextEditor?.document.getText(vscode.window.activeTextEditor.selection);
    if (text) await this.add(text.slice(0, 80));
  }

  async archiveAll() {
    await this.state.update("notes", this.notes.map((note) => ({ ...note, archived: true })));
  }

  async pinActive() {
    const [first, ...rest] = this.notes;
    if (first) await this.state.update("notes", [{ ...first, pinned: true }, ...rest]);
  }

  async reindex() {
    await this.state.update("notes", [...this.notes].sort((a, b) => a.title.localeCompare(b.title)));
  }
}
