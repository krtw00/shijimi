const { clipboard, contextBridge, ipcRenderer } = require('electron');

function registerListener(channel, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError(`Expected callback for ${channel}`);
  }

  const listener = (_event, payload) => {
    callback(payload);
  };

  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('shijimi', {
  pty: {
    write(data) {
      ipcRenderer.send('pty:write', data);
    },
    resize(cols, rows) {
      ipcRenderer.send('pty:resize', { cols, rows });
    },
    onData(callback) {
      return registerListener('pty:data', callback);
    },
    onExit(callback) {
      return registerListener('pty:exit', callback);
    },
  },
  config: {
    get() {
      return ipcRenderer.invoke('config:get');
    },
    onUpdated(callback) {
      return registerListener('config:updated', callback);
    },
  },
  clipboard: {
    readText() {
      return clipboard.readText();
    },
    writeText(text) {
      clipboard.writeText(text);
    },
  },
  shell: {
    openExternal(url) {
      return ipcRenderer.invoke('shell:openExternal', url);
    },
  },
});
