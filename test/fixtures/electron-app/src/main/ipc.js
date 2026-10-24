const { ipcMain } = require("electron");
const notes = require("./notes.js");

function registerIpc(win) {
  ipcMain.handle("notes:list", () => notes.list());
  ipcMain.handle("notes:save", (_event, note) => notes.save(note));
  ipcMain.handle("notes:purge", () => notes.purgeAll());
  ipcMain.handle("settings:reset", () => notes.resetSettings());
  ipcMain.on("window:minimize", () => win.minimize());
  ipcMain.on("privacy:toggle", () => win.webContents.send("privacy:changed", notes.togglePrivacy()));
}

module.exports = { registerIpc };
