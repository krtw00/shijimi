#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const { createServer } = require('../src/server');

async function main() {
  const { port, close } = await createServer();

  const child = spawn(process.execPath, [path.join(__dirname, 'webview.js'), String(port)], {
    stdio: 'inherit',
    env: { ...process.env, GDK_BACKEND: process.env.GDK_BACKEND || 'x11' },
  });

  child.on('exit', () => {
    close().then(() => process.exit(0));
  });

  process.once('SIGINT', () => child.kill('SIGTERM'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
