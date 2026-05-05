const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("twrpgFileApi", {
  selectSaveFile: () => ipcRenderer.invoke("save-file:select"),
  readSaveFile: (filePath) => ipcRenderer.invoke("save-file:read", filePath),
  backupSaveFile: (payload) => ipcRenderer.invoke("save-file:backup", payload),
  typeLoadCodes: (payload) => ipcRenderer.invoke("load-code:type", payload),
  platform: process.platform,
});
