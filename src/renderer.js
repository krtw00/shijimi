window.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('terminal');
  const loadedConfig = await window.shijimi.config.get();
  const resolveConfig = (source) => ({
    font: {
      family: source.font && source.font.family ? source.font.family : 'JetBrains Mono',
      size: source.font && source.font.size ? source.font.size : 14,
    },
    theme: {
      background: source.theme && source.theme.background ? source.theme.background : '#020408',
      foreground: source.theme && source.theme.foreground ? source.theme.foreground : '#e6edf3',
      cursor: source.theme && source.theme.cursor ? source.theme.cursor : '#e6edf3',
    },
    scrollback: Number.isInteger(source.scrollback) ? source.scrollback : 5000,
  });
  const config = resolveConfig(loadedConfig);
  const TerminalCtor = window.Terminal;
  const FitAddonCtor = window.FitAddon && (window.FitAddon.FitAddon || window.FitAddon);
  const WebLinksAddonCtor = window.WebLinksAddon && (window.WebLinksAddon.WebLinksAddon || window.WebLinksAddon);
  const WebglAddonCtor = window.WebglAddon && (window.WebglAddon.WebglAddon || window.WebglAddon);

  if (!container || !TerminalCtor || !FitAddonCtor || !WebLinksAddonCtor) {
    throw new Error('xterm.js assets failed to load');
  }

  const terminal = new TerminalCtor({
    fontFamily: config.font.family,
    fontSize: config.font.size,
    scrollback: config.scrollback,
    theme: config.theme,
    cursorBlink: true,
  });

  const fitAddon = new FitAddonCtor();
  const webLinksAddon = new WebLinksAddonCtor((_event, uri) => {
    window.shijimi.shell.openExternal(uri);
  });

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(webLinksAddon);
  terminal.open(container);

  if (WebglAddonCtor) {
    try {
      terminal.loadAddon(new WebglAddonCtor());
    } catch {}
  }

  terminal.focus();

  document.documentElement.style.backgroundColor = config.theme.background;
  document.body.style.backgroundColor = config.theme.background;

  terminal.onData((data) => {
    window.shijimi.pty.write(data);
  });

  const disposeData = window.shijimi.pty.onData((data) => {
    terminal.write(data);
  });

  const disposeExit = window.shijimi.pty.onExit(({ code }) => {
    terminal.writeln('');
    terminal.writeln(`[shijimi] shell exited with code ${code}`);
  });

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') {
      return true;
    }

    const key = event.key.toLowerCase();

    if (event.ctrlKey && event.shiftKey && key === 'c') {
      const selection = terminal.getSelection();

      if (selection) {
        window.shijimi.clipboard.writeText(selection);
      }

      return false;
    }

    if (event.ctrlKey && event.shiftKey && key === 'v') {
      const text = window.shijimi.clipboard.readText();

      if (text) {
        window.shijimi.pty.write(text);
      }

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

    window.shijimi.pty.write(text);
    event.preventDefault();
  });

  let resizeFrame = null;

  const fitAndResize = () => {
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame);
    }

    resizeFrame = requestAnimationFrame(() => {
      fitAddon.fit();

      if (terminal.cols > 0 && terminal.rows > 0) {
        window.shijimi.pty.resize(terminal.cols, terminal.rows);
      }

      resizeFrame = null;
    });
  };

  const applyConfig = (nextConfig) => {
    const resolvedConfig = resolveConfig(nextConfig);

    terminal.options.fontFamily = resolvedConfig.font.family;
    terminal.options.fontSize = resolvedConfig.font.size;
    terminal.options.theme = resolvedConfig.theme;
    document.documentElement.style.backgroundColor = resolvedConfig.theme.background;
    document.body.style.backgroundColor = resolvedConfig.theme.background;
    fitAndResize();
  };

  const observer = new ResizeObserver(() => {
    fitAndResize();
  });

  const disposeConfigUpdated = window.shijimi.config.onUpdated((newConfig) => {
    applyConfig(newConfig);
  });

  observer.observe(container);
  fitAndResize();

  window.addEventListener('beforeunload', () => {
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame);
    }

    observer.disconnect();
    disposeData();
    disposeExit();
    disposeConfigUpdated();
    terminal.dispose();
  });
});
