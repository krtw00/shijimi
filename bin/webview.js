#!/usr/bin/env node

// webviewウィンドウを開く専用プロセス
// 使い方: node webview.js <port>

const path = require('path');
const patchWebviewNodejs = require('../scripts/patch-webview-nodejs');

process.env.GDK_BACKEND ??= 'x11';
process.env.WEBKIT_DISABLE_DMABUF_RENDERER ??= '1';
process.env.WEBVIEW_GTK_WM_CLASS ??= 'shijimi';
process.env.WEBVIEW_GTK_WINDOW_ICON ??= path.join(__dirname, '..', 'src', 'icon.png');
process.title = 'shijimi';
patchWebviewNodejs();

const port = process.argv[2];

if (!port) {
  console.error('Usage: node webview.js <port>');
  process.exit(1);
}

const { Webview, SizeHint } = require('webview-nodejs');
const url = new URL('/', `http://127.0.0.1:${port}`).toString();
const w = new Webview(process.env.SHIJIMI_WEBVIEW_DEBUG === '1');
w.title('Shijimi');
w.size(960, 640, SizeHint.None);
w.size(320, 200, SizeHint.Min);
w.navigate(url);
w.show();
