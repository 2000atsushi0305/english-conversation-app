# AI英会話アプリ

AIと英語で会話しながら学べるWebアプリ。Claude APIを使用。

## 作成日
2026年3月23日

---

## 機能一覧

- **テキスト・音声による英会話**（Web Speech API）
- **AIの英語返答 + 日本語訳**
- **文法ミスの優しい指摘**
- **便利な表現の解説**
- **音声読み上げ**（macOS高品質ボイス対応）
- **テーマ選択**：日常会話 / 旅行 / ビジネス / 趣味 / 食べ物 / 映画・音楽
- **難易度設定**：初級 / 中級 / 上級
- **会話履歴の保存・再開**（localStorage）
- **スマホ対応**（レスポンシブデザイン）
- **音声文字起こし補正**（録音停止後にClaudeが自動補正）

---

## ファイル構成

```
english-conversation-app/
├── app.py            ← Flaskサーバー + Claude API連携
├── start.sh          ← 起動スクリプト
├── requirements.txt  ← 必要パッケージ
├── README.md         ← このファイル
└── public/
    ├── index.html    ← 画面
    ├── style.css     ← デザイン
    └── app.js        ← フロントエンドロジック
```

---

## 起動方法

```bash
export ANTHROPIC_API_KEY='sk-ant-xxxxxxxxxx'
cd ~/Desktop/english-conversation-app
bash start.sh
```

ブラウザで http://localhost:8080 を開く。

> 音声入力はChromeまたはEdgeを推奨（Safariは非対応）

---

## 使用モデル

| 用途 | モデル |
|------|--------|
| 英会話返答・翻訳・解説 | claude-opus-4-6 |
| 音声文字起こし補正 | claude-haiku-4-5 |

---

## API費用目安

- 1回の会話やりとり：約$0.002〜0.005（0.3〜0.7円）
- 新規登録の$5無料クレジットで1,000回以上利用可能

---

## 今後の展開メモ

- 他者への公開：Render / Railway 等でホスティング
- 収益化案：月500円 + 利用回数上限（月600回程度）
- APIキー管理：ユーザーごとに自分のキーを入力させる方式も検討
