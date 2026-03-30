#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function patchWebviewNodejs() {
  const repoRoot = path.resolve(__dirname, '..');
  const moduleRoot = path.join(repoRoot, 'node_modules', 'libwebview-nodejs');
  const headerPath = path.join(moduleRoot, 'src', 'webview.h');
  const binaryPath = path.join(moduleRoot, 'build', 'Release', 'libwebview.node');
  const cmakeJsPath = path.join(repoRoot, 'node_modules', '.bin', 'cmake-js');

  if (!fs.existsSync(headerPath)) {
    return;
  }

  let source = fs.readFileSync(headerPath, 'utf8');
  let changed = false;

  function ensureSnippet(target, replacement, label) {
    if (source.includes(replacement)) {
      return;
    }

    if (!source.includes(target)) {
      throw new Error(`Failed to patch libwebview-nodejs: ${label}`);
    }

    source = source.replace(target, replacement);
    changed = true;
  }

  ensureSnippet(
    '#include <cstdint>\n',
    '#include <cstdint>\n#include <cstdlib>\n',
    'missing <cstdint> include anchor'
  );

  ensureSnippet(
    `  gtk_webkit_engine(bool debug, void *window)\n      : m_window(static_cast<GtkWidget *>(window)) {\n`,
    `  gtk_webkit_engine(bool debug, void *window)\n      : m_window(static_cast<GtkWidget *>(window)) {\n    const auto *wm_class = std::getenv("WEBVIEW_GTK_WM_CLASS");\n    if (wm_class != nullptr && *wm_class != '\\0') {\n      g_set_prgname(wm_class);\n      gdk_set_program_class(wm_class);\n    }\n\n`,
    'missing gtk_webkit_engine constructor anchor'
  );

  ensureSnippet(
    '    gtk_widget_show_all(m_window);\n',
    '    apply_window_icon_from_env();\n    gtk_widget_show_all(m_window);\n',
    'missing gtk_widget_show_all anchor'
  );

  ensureSnippet(
    'private:\n  virtual void on_message(const std::string &msg) = 0;\n',
    `private:\n  void apply_window_icon_from_env() {\n    const auto *icon_path = std::getenv("WEBVIEW_GTK_WINDOW_ICON");\n    if (icon_path == nullptr || *icon_path == '\\0') {\n      return;\n    }\n\n    GError *error = nullptr;\n    gtk_window_set_icon_from_file(GTK_WINDOW(m_window), icon_path, &error);\n    if (error != nullptr) {\n      g_error_free(error);\n    }\n  }\n\n  virtual void on_message(const std::string &msg) = 0;\n`,
    'missing gtk private section anchor'
  );

  if (changed) {
    fs.writeFileSync(headerPath, source);
  }

  if (!changed && fs.existsSync(binaryPath)) {
    return;
  }

  if (!fs.existsSync(cmakeJsPath)) {
    throw new Error('cmake-js is required to rebuild libwebview-nodejs');
  }

  const result = spawnSync(cmakeJsPath, ['rebuild'], {
    cwd: moduleRoot,
    stdio: 'inherit',
  });

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.error) {
    throw result.error;
  }
}

if (require.main === module) {
  patchWebviewNodejs();
}

module.exports = patchWebviewNodejs;
