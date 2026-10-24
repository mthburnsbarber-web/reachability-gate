import { app, BrowserWindow, globalShortcut, Menu, Tray } from "electron";
import { bus } from "./bus.js";
import { privateMode } from "./private-mode.js";
import "./actions.js";

let panel;
let tray;

// The tray icon and the hotkey both toggle the panel.
// In Private Mode the same gesture leaves Private Mode instead.
function togglePanel() {
  if (privateMode.active) {
    bus.dispatch({ kind: "privateMode.exit" });
    return;
  }
  if (panel.isVisible()) panel.hide();
  else panel.show();
}

app.whenReady().then(() => {
  panel = new BrowserWindow({ width: 420, height: 560, show: false });
  panel.loadFile("src/renderer/index.html");

  tray = new Tray("assets/tray.png");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Private Mode", click: () => bus.dispatch({ kind: "privateMode.enter" }) },
      { role: "quit" },
    ]),
  );
  tray.on("click", togglePanel);
  globalShortcut.register("CommandOrControl+Shift+Space", togglePanel);
});
