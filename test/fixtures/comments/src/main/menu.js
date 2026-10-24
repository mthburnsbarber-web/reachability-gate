import { Menu } from "electron";
import { bus } from "./bus.js";

export const menu = Menu.buildFromTemplate([
  { label: "Help", click: () => bus.dispatch({ kind: "help.open" }) }, // kind: "export.run"
  { label: "Docs", click: () => bus.dispatch({ kind: "docs.open" }) },
  { label: "Check link", click: () => bus.dispatch({ kind: "link.check", text: "http://example.com" }) },
  { label: "Label", click: () => bus.dispatch({ kind: "label.show" }) },
  /* { label: "Export", click: () => bus.dispatch({ kind: "export.run" }) }, */
]);
