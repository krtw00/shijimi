# shijimi

ミニマルなElectronベースのターミナルエミュレータ。

Wayland環境（KDE + fcitx5）でネイティブターミナルのIME入力に不具合がある問題を、ブラウザベースの入力処理で回避する。

## 機能

- ローカルシェル（zsh）をpty経由で起動し、xterm.jsで描画
- 日本語IME入力（fcitx5 compositionイベント経由）
- ウィンドウリサイズ時のpty追従
- xterm-256color対応
- WebGLレンダリング
- コピー&ペースト（Ctrl+Shift+C/V）
- 設定ファイルによるフォント・テーマのカスタマイズ（ホットリロード対応）

## セットアップ

```bash
npm install
npm start
```

## 設定

`~/.config/shijimi/config.json`:

```json
{
  "shell": "/bin/zsh",
  "font": {
    "family": "Hack Nerd Font Mono, Noto Sans Mono CJK JP, monospace",
    "size": 14
  },
  "theme": {
    "background": "#020408",
    "foreground": "#e6edf3",
    "cursor": "#e6edf3"
  },
  "scrollback": 5000
}
```

## ビルド

```bash
npm run build
```

`dist/` にAppImageが生成される。

## License

MIT
