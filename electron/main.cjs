const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const isDev = Boolean(process.env.ELECTRON_START_URL);

function sanitizeFileName(value) {
  return String(value || "preset")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "preset";
}

function createTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

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

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }

        resolve(stdout);
      },
    );
  });
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

ipcMain.handle("save-file:backup", async (_event, { presetName, text }) => {
  if (typeof text !== "string" || !text) {
    throw new Error("No save text was provided for backup.");
  }

  const backupDir = path.join(app.getPath("userData"), "backup-save");
  await fs.mkdir(backupDir, { recursive: true });

  const fileName = `${createTimestamp()}-${sanitizeFileName(presetName)}.txt`;
  const filePath = path.join(backupDir, fileName);
  await fs.writeFile(filePath, text, "utf8");

  return { path: filePath };
});

ipcMain.handle("load-code:type", async (_event, payload = {}) => {
  if (process.platform !== "win32") {
    throw new Error("Load code auto input is only available on Windows.");
  }

  const codes = Array.isArray(payload.codes)
    ? payload.codes.map((code) => String(code || "").trim()).filter(Boolean)
    : [];

  if (!codes.length) {
    throw new Error("No load codes were provided.");
  }

  const delayMs = Math.max(10, Math.min(Number(payload.delayMs) || 80, 3000));
  const startDelayMs = Math.max(0, Math.min(Number(payload.startDelayMs) || 1200, 10000));
  const windowTitle = String(payload.windowTitle || "Warcraft").trim() || "Warcraft";
  const encodedPayload = Buffer.from(
    JSON.stringify({ codes, delayMs, startDelayMs, windowTitle }),
    "utf8",
  ).toString("base64");

  const script = `
$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedPayload}'))
$payload = $payloadJson | ConvertFrom-Json
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TWRPGWin32 {
  public const int KEYEVENTF_KEYUP = 0x0002;
  public const byte VK_CONTROL = 0x11;
  public const byte VK_RETURN = 0x0D;
  public const byte VK_V = 0x56;
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, UIntPtr dwExtraInfo);
}
"@
function Send-KeyDown([byte]$key) {
  [TWRPGWin32]::keybd_event($key, 0, 0, [UIntPtr]::Zero)
}
function Send-KeyUp([byte]$key) {
  [TWRPGWin32]::keybd_event($key, 0, [TWRPGWin32]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
}
function Press-Key([byte]$key) {
  Send-KeyDown $key
  Start-Sleep -Milliseconds 55
  Send-KeyUp $key
}
function Press-CtrlV {
  Send-KeyDown ([TWRPGWin32]::VK_CONTROL)
  Start-Sleep -Milliseconds 55
  Press-Key ([TWRPGWin32]::VK_V)
  Start-Sleep -Milliseconds 55
  Send-KeyUp ([TWRPGWin32]::VK_CONTROL)
}
$target = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match [regex]::Escape($payload.windowTitle)
} | Select-Object -First 1
if (-not $target) {
  $target = Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -match 'Warcraft|War3|Frozen Throne|Reforged')
  } | Select-Object -First 1
}
if (-not $target) {
  throw "Warcraft 3 window was not found."
}
[TWRPGWin32]::ShowWindowAsync($target.MainWindowHandle, 9) | Out-Null
[TWRPGWin32]::SetForegroundWindow($target.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds ([int]$payload.startDelayMs)
foreach ($code in @($payload.codes)) {
  [System.Windows.Forms.Clipboard]::SetText([string]$code)
  Start-Sleep -Milliseconds 120
  Press-Key ([TWRPGWin32]::VK_RETURN)
  Start-Sleep -Milliseconds ([int]$payload.delayMs)
  Press-CtrlV
  Start-Sleep -Milliseconds ([int]$payload.delayMs)
  Press-Key ([TWRPGWin32]::VK_RETURN)
  Start-Sleep -Milliseconds ([int]$payload.delayMs)
}
Write-Output "typed"
`;

  await runPowerShell(script);
  return { typed: codes.length };
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
