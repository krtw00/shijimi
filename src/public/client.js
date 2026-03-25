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
      window.open(uri, '_blank', 'noopener,noreferrer');
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
        const selection = terminal.getSelection();

        if (selection && navigator.clipboard) {
          navigator.clipboard.writeText(selection).catch(() => {});
        }

        return false;
      }

      if (event.ctrlKey && event.shiftKey && key === 'v') {
        if (!navigator.clipboard) {
          return false;
        }

        navigator.clipboard.readText().then((text) => {
          if (text) {
            sendMessage({ type: 'input', data: text });
          }
        }).catch(() => {});
        return false;
      }

      return true;
    });

    window.addEventListener('copy', (event) => {
      const selection = terminal.getSelection();

      if (!selection || !event.clipboardData) {
        return;
      }

      event.clipboardData.setData('text/plain', selection);
      event.preventDefault();
    });

    window.addEventListener('paste', (event) => {
      const text = event.clipboardData ? event.clipboardData.getData('text') : '';

      if (!text) {
        return;
      }

      sendMessage({ type: 'input', data: text });
      event.preventDefault();
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
