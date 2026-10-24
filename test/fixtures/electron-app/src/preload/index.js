const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notes", {
  list: () => ipcRenderer.invoke("notes:list"),
  save: (note) => ipcRenderer.invoke("notes:save", note),
  minimize: () => ipcRenderer.send("window:minimize"),
  onPrivacyChanged: (callback) => ipcRenderer.on("privacy:changed", (_event, value) => callback(value)),
});
