import { shell } from "electron";

export function openUrl(url) {
  return shell.openExternal(url);
}
