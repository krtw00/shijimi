# shijimi

ミニマルなブラウザベースターミナルエミュレータ。

## 概要

- **目的**: Wayland環境(KDE + fcitx5)でのIME不具合を回避するため、ブラウザの入力処理を利用したターミナルを提供する
- **方式**: ローカルHTTPサーバー + WebSocket。Electronは使わず、既存ブラウザで動作させる
- **スコープ**: ターミナルエミュレータとしての基本機能のみ。タブ・分割・設定UI・AI機能などは含まない
- **前提条件・制約**:
  - Arch Linux / KDE Wayland / fcitx5-hazkey 環境で動作
  - シェルは zsh をデフォルトとする
  - ユーザーの既存ブラウザ（Firefox等）を利用

## 要件

### 機能要件

- ローカルシェル(zsh)をpty経由で起動し、xterm.jsで描画する
- 日本語IME入力(fcitx5)が正しく動作する（compositionイベント経由）
- ブラウザウィンドウリサイズ時にptyのサイズを追従させる
- xterm-256color相当のカラー・エスケープシーケンス対応
- コピー&ペースト（ブラウザ標準のCtrl+C/V、ターミナル内はCtrl+Shift+C/V）
- フォント・フォントサイズの設定（設定ファイルベース）
- テーマカラーの設定（設定ファイルベース）

### 非機能要件

- 起動が速い（サーバー起動 → ブラウザ開くまで1秒以内を目標）
- メモリ使用量を最小限に（サーバー側は数MB程度）
- セキュリティ: localhost のみバインド、外部からアクセス不可

## 設計

### アーキテクチャ

```
┌──────────────────────────────┐
│  既存ブラウザ (Firefox等)     │
│  ┌────────────┐              │
│  │ xterm.js   │  WebSocket   │
│  │ IME処理    │ ────────────┼──┐
│  └────────────┘              │  │
└──────────────────────────────┘  │
                                  ▼
            ┌──────────────────────────┐
            │  Node.js サーバー         │
            │  ┌──────────┐            │
            │  │ node-pty  │            │
            │  └──────────┘            │
            │  HTTP (静的配信)          │
            │  WebSocket (pty通信)      │
            │  設定ファイル読み込み       │
            └──────────────────────────┘
```

- **サーバー (server.js)**: HTTP（静的ファイル配信 + 設定API）+ WebSocket（pty通信）
- **クライアント (client.js)**: xterm.jsで描画、WebSocket経由でpty通信、IME処理はブラウザ任せ
- **CLI (bin/shijimi.js)**: サーバー起動 → ブラウザを開く → シェル終了で自動停止

### 技術選定

| 要素 | 選定 | 理由 |
|------|------|------|
| サーバー | Node.js (標準 http モジュール) | 外部依存最小、node-ptyと同一プロセスで動作 |
| WebSocket | ws | 軽量で実績あり |
| ターミナル描画 | xterm.js (@xterm/xterm) | デファクトスタンダード |
| PTY | node-pty | ローカルシェル接続 |
| ブラウザ起動 | open (npm) | クロスプラットフォームなブラウザ起動 |
| 設定形式 | JSON | `~/.config/shijimi/config.json` |

### ファイル構成

```
shijimi/
├── bin/
│   └── shijimi.js          # CLI エントリポイント (#!/usr/bin/env node)
├── src/
│   ├── server.js           # HTTPサーバー + WebSocket + node-pty管理
│   ├── config.js            # 設定ファイル読み込み・マージ
│   └── public/
│       ├── index.html       # ミニマルHTML
│       └── client.js        # xterm.js初期化, WebSocket接続, リサイズ処理
├── package.json
├── PLAN.md
├── README.md
└── .gitignore
```

### データフロー

1. **起動**: `shijimi` コマンド → server.js起動 → 空きポートでlisten → ブラウザで `localhost:PORT` を開く
2. **WebSocket接続**: クライアント接続 → サーバーがnode-ptyでzsh起動
3. **入力**: client(xterm.js onData) → WebSocket → server(pty.write)
4. **出力**: server(pty onData) → WebSocket → client(term.write)
5. **リサイズ**: client(ResizeObserver/fitAddon) → WebSocket(JSON) → server(pty.resize)
6. **IME**: ブラウザ標準のcomposition処理。xterm.jsが内部でハンドル
7. **終了**: シェル終了 → WebSocket close → サーバー自動停止。またはブラウザタブ閉じ → WebSocket close → サーバー停止

### 設定ファイル

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

### WebSocket メッセージ設計

すべてJSON形式。

| type | 方向 | payload |
|------|------|---------|
| `data` | server → client | `{ type: "data", data: string }` |
| `input` | client → server | `{ type: "input", data: string }` |
| `resize` | client → server | `{ type: "resize", cols: number, rows: number }` |
| `exit` | server → client | `{ type: "exit", code: number }` |
| `config` | server → client (初回接続時) | `{ type: "config", config: object }` |

### セキュリティ

- `127.0.0.1` のみにバインド（外部ネットワークからアクセス不可）
- ポートは動的に空きポートを使用（`0` で listen → 割り当て済みポートを取得）
- 単一クライアント接続のみ許可（2つ目の接続は拒否）

### CLI の挙動

```bash
# 起動
$ shijimi
# → サーバー起動、ブラウザが開く

# 終了条件（いずれか）
# 1. シェル(zsh)が終了 (exit, Ctrl+D)
# 2. ブラウザタブを閉じる (WebSocket切断)
# 3. Ctrl+C でshijimiプロセスを停止
```
