const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const pty = require('node-pty');
const { WebSocket, WebSocketServer } = require('ws');
const { DEFAULT_CONFIG, loadConfig } = require('./config');

function whichSync(cmd) {
  try {
    return execFileSync('which', [cmd], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function detectClipboard() {
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;

  if (isWayland && whichSync('wl-copy')) {
    return {
      copy: ['wl-copy'],
      paste: ['wl-paste', '--no-newline'],
    };
  }

  if (whichSync('xclip')) {
    return {
      copy: ['xclip', '-selection', 'clipboard'],
      paste: ['xclip', '-selection', 'clipboard', '-o'],
    };
  }

  if (whichSync('xsel')) {
    return {
      copy: ['xsel', '--clipboard', '--input'],
      paste: ['xsel', '--clipboard', '--output'],
    };
  }

  return null;
}

function clipboardWrite(clipboard, text) {
  if (!clipboard) return;
  const [cmd, ...args] = clipboard.copy;
  const child = execFile(cmd, args, () => {});
  child.stdin.write(text);
  child.stdin.end();
}

function clipboardRead(clipboard) {
  if (!clipboard) return Promise.resolve('');
  const [cmd, ...args] = clipboard.paste;
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', timeout: 2000 }, (err, stdout) => {
      resolve(err ? '' : stdout);
    });
  });
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const XTERM_DIR = path.join(__dirname, '..', 'node_modules', '@xterm');
const ICON_PNG_PATH = path.join(__dirname, 'icon.png');
const ICON_SVG_PATH = path.join(__dirname, 'icon.svg');

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function isWithinRoot(rootPath, targetPath) {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`);
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

function resolveAssetPath(requestUrl) {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/') {
    return path.join(PUBLIC_DIR, 'index.html');
  }

  if (pathname === '/favicon.ico' || pathname === '/icon.png') {
    return ICON_PNG_PATH;
  }

  if (pathname === '/icon.svg') {
    return ICON_SVG_PATH;
  }

  if (pathname.startsWith('/xterm/')) {
    const assetPath = path.resolve(XTERM_DIR, `.${pathname.slice('/xterm'.length)}`);

    if (isWithinRoot(XTERM_DIR, assetPath)) {
      return assetPath;
    }

    return null;
  }

  const assetPath = path.resolve(PUBLIC_DIR, `.${pathname}`);

  if (isWithinRoot(PUBLIC_DIR, assetPath)) {
    return assetPath;
  }

  return null;
}

function serveFile(request, response) {
  const assetPath = resolveAssetPath(request.url || '/');

  if (!assetPath || !fs.existsSync(assetPath) || fs.statSync(assetPath).isDirectory()) {
    response.writeHead(404);
    response.end();
    return;
  }

  const extension = path.extname(assetPath);

  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
  });

  fs.createReadStream(assetPath).pipe(response);
}

function sendMessage(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function createServer() {
  return new Promise((resolve, reject) => {
    const config = loadConfig();
    const clipboard = detectClipboard();
    const server = http.createServer(serveFile);
    const wss = new WebSocketServer({ noServer: true });
    let activeSocket = null;
    let shellProcess = null;
    let shutdownPromise = null;

    const shutdown = () => {
      if (shutdownPromise) {
        return shutdownPromise;
      }

      shutdownPromise = new Promise((shutdownResolve) => {
        if (activeSocket) {
          const socket = activeSocket;
          activeSocket = null;

          if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
            socket.close();
          }
        }

        if (shellProcess) {
          const currentShell = shellProcess;
          shellProcess = null;
          currentShell.kill();
        }

        wss.close();

        if (server.listening) {
          server.close(() => shutdownResolve());
          return;
        }

        shutdownResolve();
      });

      return shutdownPromise;
    };

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1');

      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });

    wss.on('connection', (socket) => {
      if (activeSocket) {
        socket.close();
        return;
      }

      activeSocket = socket;
      sendMessage(socket, { type: 'config', config });

      const shell = resolveShell(config.shell);

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
        sendMessage(socket, { type: 'data', data });
      });

      shellProcess.onExit(({ exitCode }) => {
        shellProcess = null;
        sendMessage(socket, { type: 'exit', code: exitCode });
        socket.close();
        shutdown();
      });

      socket.on('message', (raw) => {
        if (!shellProcess) {
          return;
        }

        let message = null;

        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }

        if (!message || typeof message.type !== 'string') {
          return;
        }

        if (message.type === 'input' && typeof message.data === 'string') {
          shellProcess.write(message.data);
          return;
        }

        if (message.type === 'resize') {
          const cols = Number(message.cols);
          const rows = Number(message.rows);

          if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
            shellProcess.resize(cols, rows);
          }

          return;
        }

        if (message.type === 'clipboard-write' && typeof message.data === 'string') {
          clipboardWrite(clipboard, message.data);
          return;
        }

        if (message.type === 'clipboard-read') {
          clipboardRead(clipboard).then((text) => {
            sendMessage(socket, { type: 'clipboard-content', data: text });
          });
          return;
        }

        if (message.type === 'open-url' && typeof message.url === 'string') {
          try {
            const parsed = new URL(message.url);
            if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
              execFile('xdg-open', [message.url], () => {});
            }
          } catch {}
        }
      });

      socket.on('close', () => {
        if (activeSocket === socket) {
          activeSocket = null;
        }

        if (shellProcess) {
          const currentShell = shellProcess;
          shellProcess = null;
          currentShell.kill();
        }

        shutdown();
      });
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Failed to acquire listening port'));
        return;
      }

      resolve({
        port: address.port,
        close: shutdown,
      });
    });
  });
}

module.exports = {
  createServer,
};
