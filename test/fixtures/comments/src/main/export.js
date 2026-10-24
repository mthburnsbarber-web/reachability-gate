import { writeFile } from "node:fs/promises";

export function exportAll(notes = []) {
  return writeFile("notes-export.md", notes.map((note) => `- ${note.text}`).join("\n"));
}
