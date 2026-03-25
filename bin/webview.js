#!/usr/bin/env node

// webviewウィンドウを開く専用プロセス
// 使い方: node webview.js <port>

process.env.GDK_BACKEND ??= 'x11';
process.env.WEBKIT_DISABLE_DMABUF_RENDERER ??= '1';

const port = process.argv[2];

if (!port) {
  console.error('Usage: node webview.js <port>');
  process.exit(1);
}

const { Webview } = require('webview-nodejs');
const url = new URL('/', `http://127.0.0.1:${port}`).toString();
const w = new Webview(process.env.SHIJIMI_WEBVIEW_DEBUG === '1');
w.title('Shijimi');
w.size(960, 640);
w.navigate(url);
w.show();
