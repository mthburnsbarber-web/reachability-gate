import { Menu, Tray } from "electron";
import { bus } from "./bus.js";

export function createTray(iconPath) {
  const tray = new Tray(iconPath);
  const menu = Menu.buildFromTemplate([
    { label: "New Note", click: () => bus.dispatch({ kind: "notes.open", id: null }) },
    { label: "Private Mode", click: () => bus.dispatch({ kind: "privateMode.enter" }) },
    // { label: "Leave Private Mode", click: () => bus.dispatch({ kind: "privateMode.exit" }) },
    { type: "separator" },
    { role: "quit" },
  ]);
  tray.setContextMenu(menu);
  return tray;
}
