const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("twrpgFileApi", {
  selectSaveFile: () => ipcRenderer.invoke("save-file:select"),
  readSaveFile: (filePath) => ipcRenderer.invoke("save-file:read", filePath),
});
