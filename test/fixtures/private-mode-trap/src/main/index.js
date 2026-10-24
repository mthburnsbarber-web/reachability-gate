import { app } from "electron";
import "./actions.js";
import { createTray } from "./tray.js";

app.whenReady().then(() => {
  createTray("assets/tray.png");
});
