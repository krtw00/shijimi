# shijimi

ミニマルなブラウザベースのターミナルエミュレータ。

Wayland環境（KDE + fcitx5）でネイティブターミナルのIME入力に不具合がある問題を、ローカルHTTPサーバーとブラウザの入力処理で回避する。

## 機能

- ローカルシェル（zsh）をpty経由で起動し、xterm.jsで描画
- 日本語IME入力（fcitx5 compositionイベント経由）
- ブラウザウィンドウリサイズ時のpty追従
- xterm-256color対応
- WebGLレンダリング
- コピー&ペースト（Ctrl+Shift+C/V とブラウザ標準 copy/paste）
- 設定ファイルによるフォント・テーマのカスタマイズ

## セットアップ

```bash
npm install
npm start
```

`npm start` はローカルHTTPサーバーを `127.0.0.1` で起動し、空きポートにブラウザを開く。

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

## 使い方

```bash
shijimi
```

シェル終了、ブラウザタブを閉じる、または `Ctrl+C` でサーバーは停止する。

## License

MIT
