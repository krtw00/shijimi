# shijimi

ミニマルなElectronベースターミナルエミュレータ。

## 概要

- **目的**: Wayland環境(KDE + fcitx5)でのIME不具合を回避するため、Electronのブラウザベースな入力処理を利用したターミナルを提供する
- **スコープ**: ターミナルエミュレータとしての基本機能のみ。タブ・分割・設定UI・AI機能などは含まない
- **前提条件・制約**:
  - Arch Linux / KDE Wayland / fcitx5-hazkey 環境で動作
  - シェルは zsh をデフォルトとする
  - hotate (既存ブラウザSSHクライアント) の xterm.js / IME処理の知見を活用

## 要件

### 機能要件

- ローカルシェル(zsh)をpty経由で起動し、xterm.jsで描画する
- 日本語IME入力(fcitx5)が正しく動作する（compositionイベント経由）
- ウィンドウリサイズ時にptyのサイズを追従させる
- xterm-256color相当のカラー・エスケープシーケンス対応
- コピー&ペースト（Ctrl+Shift+C/V またはOS標準）
- フォント・フォントサイズの設定（設定ファイルベース）
- テーマカラーの設定（設定ファイルベース）

### 非機能要件

- 起動が速い（Electronの制約内で最小限に）
- メモリ使用量を抑える（不要な機能を載せない）

## 設計

### アーキテクチャ

```
┌─────────────────────────────────┐
│         Electron Main           │
│  ┌───────────┐  ┌────────────┐  │
│  │  node-pty  │  │  config    │  │
│  │  (pty管理) │  │  (設定読込) │  │
│  └─────┬─────┘  └─────┬──────┘  │
│        │ IPC           │ IPC     │
├────────┼───────────────┼────────┤
│        ▼               ▼        │
│       Electron Renderer          │
│  ┌───────────┐  ┌────────────┐  │
│  │  xterm.js  │  │  IME入力   │  │
│  │  (描画)    │  │  (composition)│
│  └───────────┘  └────────────┘  │
└─────────────────────────────────┘
```

- **Main process**: node-ptyでローカルシェルを起動、設定ファイル読み込み
- **Renderer process**: xterm.jsで描画、IME入力のcompositionイベント処理
- **IPC**: main↔renderer間でptyデータとリサイズイベントをやり取り

### 技術選定

| 要素 | 選定 | 理由 |
|------|------|------|
| アプリフレームワーク | Electron | ブラウザベースIME処理でWayland IME問題を回避 |
| ターミナル描画 | xterm.js | hotateで実績あり、デファクトスタンダード |
| PTY | node-pty | Electron main processで直接使える |
| ビルド | electron-builder | Linux向けパッケージング |
| 設定形式 | JSON | `~/.config/shijimi/config.json` |

### ファイル構成

```
shijimi/
├── src/
│   ├── main.js           # Electron main process, node-pty起動, IPC
│   ├── preload.js         # contextBridge でIPC公開
│   ├── renderer.js        # xterm.js初期化, IME処理, IPC経由でpty通信
│   └── index.html         # 最小限のHTML（ターミナルコンテナのみ）
├── package.json
├── PLAN.md
└── .gitignore
```

### データフロー

1. **起動**: main.js → node-ptyでzsh起動 → BrowserWindow作成
2. **入力**: renderer(xterm.js onData) → IPC → main(pty.write)
3. **出力**: main(pty onData) → IPC → renderer(term.write)
4. **リサイズ**: renderer(ResizeObserver/fitAddon) → IPC → main(pty.resize)
5. **IME**: renderer側でcomposition eventsを追跡、確定後にonData経由で送信（xterm.jsが内部処理）

### 設定ファイル

`~/.config/shijimi/config.json`:

```json
{
  "shell": "/bin/zsh",
  "font": {
    "family": "JetBrains Mono",
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

### IPC チャンネル設計

| チャンネル | 方向 | データ |
|-----------|------|--------|
| `pty:data` | main → renderer | string (pty出力) |
| `pty:write` | renderer → main | string (キー入力) |
| `pty:resize` | renderer → main | { cols, rows } |
| `pty:exit` | main → renderer | { code } |
| `config:get` | renderer → main (invoke) | → config object |

## タスク分解

- [ ] package.json作成（Electron, xterm.js, node-pty, electron-builder）
- [ ] .gitignore作成
- [ ] src/main.js — Electron起動、node-pty起動、IPC登録
- [ ] src/preload.js — contextBridge設定
- [ ] src/renderer.js — xterm.js初期化、IPC接続、リサイズ処理
- [ ] src/index.html — ミニマルHTML
- [ ] 設定ファイル読み込み機能（~/.config/shijimi/config.json）
- [ ] electron-builderでパッケージング設定
- [ ] 動作テスト（IME入力、リサイズ、コピペ）

## リスク・懸念事項

- **node-ptyのビルド**: ネイティブモジュールなのでelectron-rebuildが必要。Arch Linuxでは問題ないはず
- **Electron起動速度**: footより遅い。許容範囲かは実際に使って判断
- **Electronのメモリ**: 最小でも100MB程度は使う。用途特化なので許容

## 未決事項

- Ctrl+Shift+C/Vとシェルのキーバインドの競合をどう扱うか
- ウィンドウ位置・サイズの永続化は必要か
- 将来的にタブ対応を入れる可能性はあるか
