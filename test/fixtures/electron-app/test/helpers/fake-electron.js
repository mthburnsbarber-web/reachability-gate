const notes = require("../../src/main/notes.js");

const handlers = {
  "settings:reset": () => notes.resetSettings(),
};

module.exports = {
  ipcRenderer: {
    invoke: async (channel, ...args) => handlers[channel](...args),
  },
};
