const fs = require('fs');
const os = require('os');
const path = require('path');

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

const CONFIG_PATH = path.join(os.homedir(), '.config', 'shijimi', 'config.json');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfig(base, override) {
  const merged = { ...base };

  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(base[key]) && isPlainObject(value)) {
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
      return mergeConfig(DEFAULT_CONFIG, {});
    }

    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

    if (!isPlainObject(parsed)) {
      return mergeConfig(DEFAULT_CONFIG, {});
    }

    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch {
    return mergeConfig(DEFAULT_CONFIG, {});
  }
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  loadConfig,
  mergeConfig,
};
