window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('terminal');
  const TerminalCtor = window.Terminal;
  const FitAddonCtor = window.FitAddon && (window.FitAddon.FitAddon || window.FitAddon);
  const WebLinksAddonCtor = window.WebLinksAddon && (window.WebLinksAddon.WebLinksAddon || window.WebLinksAddon);
  const WebglAddonCtor = window.WebglAddon && (window.WebglAddon.WebglAddon || window.WebglAddon);
  const isNativeWebview = Boolean(
    window.webkit &&
    window.webkit.messageHandlers &&
    window.webkit.messageHandlers.external
  );
  const canUseResizeObserver = typeof ResizeObserver === 'function';

  if (!container || !TerminalCtor || !FitAddonCtor || !WebLinksAddonCtor) {
    throw new Error('xterm.js assets failed to load');
  }

  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  const pendingData = [];
  let terminal = null;
  let fitAddon = null;
  let resizeObserver = null;
  let handleWindowResize = null;
  let resizeFrame = null;
  let hasExited = false;

  const sendMessage = (payload) => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(payload));
  };

  // --- Clipboard helpers (navigator.clipboard fallback to server-side) ---

  const copyToClipboard = (text) => {
    if (!text) return Promise.resolve();
    if (navigator.clipboard) {
      return navigator.clipboard.writeText(text).catch(() => {
        sendMessage({ type: 'clipboard-write', data: text });
      });
    }
    sendMessage({ type: 'clipboard-write', data: text });
    return Promise.resolve();
  };

  let pendingPasteResolve = null;

  const readClipboard = () => {
    if (navigator.clipboard) {
      return navigator.clipboard.readText().catch(() => readClipboardViaServer());
    }
    return readClipboardViaServer();
  };

  const readClipboardViaServer = () =>
    new Promise((resolve) => {
      pendingPasteResolve = resolve;
      sendMessage({ type: 'clipboard-read' });
      setTimeout(() => {
        if (pendingPasteResolve === resolve) {
          pendingPasteResolve = null;
          resolve('');
        }
      }, 2000);
    });

  // --- Context menu ---

  const menu = document.createElement('div');
  menu.id = 'shijimi-ctx-menu';
  menu.style.cssText = 'display:none;position:fixed;z-index:9999;background:#1e1e2e;border:1px solid #45475a;border-radius:6px;padding:4px 0;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,.5);font-family:system-ui,sans-serif;font-size:13px;color:#cdd6f4;';
  document.body.appendChild(menu);

  const addMenuItem = (label, shortcut, action) => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:6px 12px;cursor:default;display:flex;justify-content:space-between;gap:24px;';
    item.innerHTML = `<span>${label}</span><span style="color:#6c7086">${shortcut}</span>`;
    item.addEventListener('mouseenter', () => { item.style.background = '#313244'; });
    item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      hideMenu();
      action();
    });
    menu.appendChild(item);
    return item;
  };

  let menuCopyItem = null;

  const buildMenu = () => {
    menu.innerHTML = '';
    menuCopyItem = addMenuItem('コピー', 'Ctrl+Shift+C', () => {
      if (terminal) copyToClipboard(terminal.getSelection());
    });
    addMenuItem('ペースト', 'Ctrl+Shift+V', doPaste);
    addMenuItem('すべて選択', 'Ctrl+Shift+A', () => {
      if (terminal) terminal.selectAll();
    });
  };

  const showMenu = (x, y) => {
    buildMenu();
    const hasSelection = terminal && terminal.getSelection();
    menuCopyItem.style.opacity = hasSelection ? '1' : '.4';
    menuCopyItem.style.pointerEvents = hasSelection ? 'auto' : 'none';
    menu.style.display = 'block';
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 4) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 4) + 'px';
  };

  const hideMenu = () => { menu.style.display = 'none'; };

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY);
  });

  document.addEventListener('mousedown', (e) => {
    if (!menu.contains(e.target)) hideMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideMenu();
  });

  // --- Paste helper (bracket paste mode) ---

  const doPaste = () => {
    readClipboard().then((text) => {
      if (!text || !terminal) return;
      const wrapped = text.includes('\n')
        ? `\x1b[200~${text}\x1b[201~`
        : text;
      sendMessage({ type: 'input', data: wrapped });
    });
  };

  const resolveConfig = (source) => ({
    font: {
      family: source.font && source.font.family ? source.font.family : 'Hack Nerd Font Mono, Noto Sans Mono CJK JP, monospace',
      size: source.font && source.font.size ? source.font.size : 14,
    },
    theme: {
      background: source.theme && source.theme.background ? source.theme.background : '#020408',
      foreground: source.theme && source.theme.foreground ? source.theme.foreground : '#e6edf3',
      cursor: source.theme && source.theme.cursor ? source.theme.cursor : '#e6edf3',
    },
    scrollback: Number.isInteger(source.scrollback) ? source.scrollback : 5000,
  });

  const fitAndResize = () => {
    if (!terminal || !fitAddon) {
      return;
    }

    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame);
    }

    resizeFrame = requestAnimationFrame(() => {
      fitAddon.fit();

      if (terminal.cols > 0 && terminal.rows > 0) {
        sendMessage({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
      }

      resizeFrame = null;
    });
  };

  const applyBackground = (theme) => {
    document.documentElement.style.backgroundColor = theme.background;
    document.body.style.backgroundColor = theme.background;
  };

  const writeExitMessage = (code) => {
    if (!terminal || hasExited) {
      return;
    }

    hasExited = true;
    terminal.writeln('');
    terminal.writeln(`[shijimi] shell exited with code ${code}`);
  };

  const initializeTerminal = (rawConfig) => {
    if (terminal) {
      return;
    }

    const config = resolveConfig(rawConfig || {});

    terminal = new TerminalCtor({
      cursorBlink: true,
      fontFamily: config.font.family,
      fontSize: config.font.size,
      scrollback: config.scrollback,
      theme: config.theme,
    });

    fitAddon = new FitAddonCtor();
    const webLinksAddon = new WebLinksAddonCtor((_event, uri) => {
      sendMessage({ type: 'open-url', url: uri });
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(container);

    if (WebglAddonCtor && !isNativeWebview) {
      try {
        const webglAddon = new WebglAddonCtor();
        if (typeof webglAddon.onContextLoss === 'function') {
          webglAddon.onContextLoss(() => {
            webglAddon.dispose();
            fitAndResize();
          });
        }
        terminal.loadAddon(webglAddon);
      } catch {}
    }

    applyBackground(config.theme);

    terminal.onData((data) => {
      sendMessage({ type: 'input', data });
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') {
        return true;
      }

      const key = event.key.toLowerCase();

      if (event.ctrlKey && event.shiftKey && key === 'c') {
        copyToClipboard(terminal.getSelection());
        return false;
      }

      if (event.ctrlKey && event.shiftKey && key === 'v') {
        doPaste();
        return false;
      }

      if (event.ctrlKey && event.shiftKey && key === 'a') {
        terminal.selectAll();
        return false;
      }

      return true;
    });

    // Auto-copy on selection
    terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) copyToClipboard(selection);
    });

    if (canUseResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        fitAndResize();
      });

      resizeObserver.observe(container);
    } else {
      handleWindowResize = () => {
        fitAndResize();
      };
      window.addEventListener('resize', handleWindowResize);
    }

    fitAndResize();
    terminal.focus();

    while (pendingData.length > 0) {
      terminal.write(pendingData.shift());
    }
  };

  socket.addEventListener('message', (event) => {
    let message = null;

    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!message || typeof message.type !== 'string') {
      return;
    }

    if (message.type === 'config') {
      initializeTerminal(message.config || {});
      return;
    }

    if (message.type === 'clipboard-content' && typeof message.data === 'string') {
      if (pendingPasteResolve) {
        pendingPasteResolve(message.data);
        pendingPasteResolve = null;
      }
      return;
    }

    if (message.type === 'data' && typeof message.data === 'string') {
      if (!terminal) {
        pendingData.push(message.data);
        return;
      }

      terminal.write(message.data);
      return;
    }

    if (message.type === 'exit') {
      writeExitMessage(message.code);
      if (typeof window.shijimiClose === 'function') {
        window.shijimiClose();
      }
    }
  });

  socket.addEventListener('close', () => {
    if (terminal && !hasExited) {
      terminal.writeln('');
      terminal.writeln('[shijimi] disconnected');
    }
  });

  window.addEventListener('beforeunload', () => {
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame);
    }

    if (resizeObserver) {
      resizeObserver.disconnect();
    }

    if (handleWindowResize) {
      window.removeEventListener('resize', handleWindowResize);
    }

    socket.close();

    if (terminal) {
      terminal.dispose();
    }
  });
});
