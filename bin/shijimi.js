#!/usr/bin/env node

const { createServer } = require('../src/server');

function openBrowser(url) {
  return import('open').then(({ default: open }) => open(url));
}

async function main() {
  const { port, close } = await createServer();
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await close();
  };

  process.once('SIGINT', () => {
    shutdown().finally(() => process.exit(0));
  });

  process.once('SIGTERM', () => {
    shutdown().finally(() => process.exit(0));
  });

  const url = `http://127.0.0.1:${port}`;

  try {
    await openBrowser(url);
  } catch (error) {
    await shutdown();
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
