const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const isDev = Boolean(process.env.ELECTRON_START_URL);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 1100,
    minHeight: 760,
    title: "TWRPG Helper",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("save-file:select", async () => {
  const result = await dialog.showOpenDialog({
    title: "세이브 txt 파일 선택",
    properties: ["openFile"],
    filters: [
      { name: "Text files", extensions: ["txt", "j", "pld"] },
      { name: "All files", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePaths.length) return null;

  const filePath = result.filePaths[0];
  const text = await fs.readFile(filePath, "utf8");

  return { path: filePath, text };
});

ipcMain.handle("save-file:read", async (_event, filePath) => {
  if (typeof filePath !== "string" || !filePath) {
    throw new Error("No save file path was provided.");
  }

  const text = await fs.readFile(filePath, "utf8");
  return { path: filePath, text };
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
