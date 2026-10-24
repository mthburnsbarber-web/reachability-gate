const path = require("node:path");
const { app, BrowserWindow, ipcMain, Menu, Tray } = require("electron");
const { registerIpc } = require("./ipc.js");

let win;
let tray;

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: { preload: path.join(__dirname, "../preload/index.js") },
  });
  win.loadFile(path.join(__dirname, "../renderer/index.html"));
  registerIpc(win);

  tray = new Tray(path.join(__dirname, "../../assets/tray.png"));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Toggle Privacy Blur", click: () => ipcMain.emit("privacy:toggle") },
      { role: "quit" },
    ]),
  );
});
