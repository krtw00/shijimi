const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('node-pty');

const DEFAULT_CONFIG = {
  shell: '/bin/zsh',
  font: {
    family: 'Hack Nerd Font Mono, Noto Sans Mono CJK JP, monospace',
    size: 14,
  },
  theme: {
    background: '#020408',
    foreground: '#e6edf3',
    cursor: '#e6edf3',
  },
  scrollback: 5000,
};

const CONFIG_DIR = path.join(os.homedir(), '.config', 'shijimi');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

let appConfig = loadConfig() || mergeConfig(DEFAULT_CONFIG, {});
let mainWindow = null;
let shellProcess = null;
let rendererReady = false;
let pendingEvents = [];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfig(base, override) {
  const merged = { ...base };

  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      merged[key] = mergeConfig(base[key], value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return null;
    }

    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!isPlainObject(parsed)) {
      return null;
    }

    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch {
    return null;
  }
}

function resolveShell(configuredShell) {
  if (configuredShell && fs.existsSync(configuredShell)) {
    return configuredShell;
  }

  if (process.env.SHELL && fs.existsSync(process.env.SHELL)) {
    return process.env.SHELL;
  }

  return DEFAULT_CONFIG.shell;
}

function sendToRenderer(channel, payload) {
  if (!rendererReady) {
    pendingEvents.push({ channel, payload });
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

function markRendererReady() {
  if (rendererReady) {
    return;
  }

  rendererReady = true;

  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingEvents = [];
    return;
  }

  for (const event of pendingEvents) {
    mainWindow.webContents.send(event.channel, event.payload);
  }

  pendingEvents = [];
}

function stopShell() {
  if (!shellProcess) {
    return;
  }

  shellProcess.kill();
  shellProcess = null;
}

function startShell() {
  if (shellProcess) {
    return;
  }

  const shell = resolveShell(appConfig.shell);

  shellProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: os.homedir(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
    },
  });

  shellProcess.onData((data) => {
    sendToRenderer('pty:data', data);
  });

  shellProcess.onExit(({ exitCode }) => {
    sendToRenderer('pty:exit', { code: exitCode });
    shellProcess = null;
  });
}

function createWindow() {
  rendererReady = false;
  pendingEvents = [];
  let configWatcher = null;
  let reloadConfigTimer = null;
  const iconPath = path.join(__dirname, 'icon.png');

  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    icon: iconPath,
    backgroundColor: appConfig.theme.background,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    startShell();
  });

  if (fs.existsSync(CONFIG_DIR) && fs.existsSync(CONFIG_PATH)) {
    try {
      configWatcher = fs.watch(CONFIG_PATH, (eventType) => {
        if (eventType !== 'change') {
          return;
        }

        if (reloadConfigTimer !== null) {
          clearTimeout(reloadConfigTimer);
        }

        reloadConfigTimer = setTimeout(() => {
          reloadConfigTimer = null;

          const nextConfig = loadConfig();

          if (!nextConfig) {
            return;
          }

          appConfig = nextConfig;

          if (!mainWindow || mainWindow.isDestroyed()) {
            return;
          }

          mainWindow.webContents.send('config:updated', appConfig);
        }, 300);
      });
    } catch {
      configWatcher = null;
    }
  }

  mainWindow.on('closed', () => {
    if (reloadConfigTimer !== null) {
      clearTimeout(reloadConfigTimer);
      reloadConfigTimer = null;
    }

    if (configWatcher) {
      configWatcher.close();
      configWatcher = null;
    }

    mainWindow = null;
    stopShell();
  });
}

ipcMain.on('pty:write', (_event, data) => {
  markRendererReady();

  if (!shellProcess || typeof data !== 'string') {
    return;
  }

  shellProcess.write(data);
});

ipcMain.on('pty:resize', (_event, size = {}) => {
  markRendererReady();

  if (!shellProcess) {
    return;
  }

  const cols = Number(size.cols);
  const rows = Number(size.rows);

  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
    return;
  }

  shellProcess.resize(cols, rows);
});

ipcMain.handle('config:get', () => appConfig);
ipcMain.handle('shell:openExternal', (_event, url) => shell.openExternal(url));

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  appConfig = loadConfig() || mergeConfig(DEFAULT_CONFIG, {});
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  stopShell();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
