# boba Talk (TalkBoba) — 構造スナップショット

**日付**: 2026-05-26
**バージョン**: TTS + 6キャラ + 文法強化リリース直後（本番デプロイ前）
**目的**: この時点でアプリが「何でできていて、何ができて、どこに何があるか」の正本

---

## 1. プロダクト概要

- **名前**: TalkBoba（コードベース上）/ boba Talk（呼称）
- **本番URL**: https://justconvo.net （Fly.io）
- **コンセプト**: AIキャラクター「Boba（ボバちゃん）」と毎日5分英語で話す習慣アプリ
- **6キャラのうち2キャラが無料、4キャラが有料**
- **マネタイズ**: Stripe 月額サブスク（¥480 / ¥980）

---

## 2. 技術スタック

| レイヤー | 技術 | 役割 |
|---------|------|------|
| Backend | Flask (Python 3.14) | `app.py` 単一ファイル |
| AI チャット | Groq Llama 3.3 70B Versatile | 会話生成・JSON出力 |
| 音声認識 | Groq Whisper Large v3 | マイク入力→英文 |
| 音声合成 | **Google Cloud Chirp 3 HD** | 6種ボイス、キャラ別 |
| 音声合成（フォールバック） | ブラウザ Web Speech API (Samantha 等) | 無料ユーザー・API失敗時 |
| DB（ローカル） | SQLite `data.db` | 開発用 |
| DB（本番） | PostgreSQL | Fly.io 内 |
| 課金 | Stripe Checkout + Webhook | プラン管理 |
| Push通知 | Web Push (VAPID) | 毎日のリマインダー |
| ホスティング | Fly.io | Docker コンテナ |
| ドメイン | Cloudflare Registrar | justconvo.net |
| フロント | vanilla HTML/CSS/JS（PWA） | フレームワーク無し |

### 環境変数（.env）
```
GROQ_API_KEY           # チャット + Whisper
ANTHROPIC_API_KEY      # 旧Claudeチャット時代の名残（現在未使用）
GOOGLE_TTS_API_KEY     # Chirp 3 HD（2026-05-26 追加）
STRIPE_SECRET_KEY      # 課金
STRIPE_LIGHT_PRICE_ID  # スタンダードプラン Price ID
STRIPE_PREMIUM_PRICE_ID # プレミアムプラン Price ID
STRIPE_WEBHOOK_SECRET  # Webhook署名検証
SECRET_KEY             # Flaskセッション
NOTION_TOKEN           # （現状不明）
```

---

## 3. ファイル構造

```
english-conversation-app/
├── app.py                  # 1400行 Flask本体
├── requirements.txt        # Python依存
├── .env                    # APIキー類（gitignore対象）
├── data.db                 # SQLite ローカルDB
├── app.db                  # 空（旧Path、未使用）
├── start.sh                # ローカル起動スクリプト
├── Dockerfile              # 本番ビルド
├── fly.toml                # Fly.io 設定
├── Procfile                # （補助）
├── README.md
├── .venv/                  # ローカル仮想環境（私が作成）
│
├── public/                 # フロント一式（全て /public/ で配信）
│   ├── index.html          # メインチャット画面
│   ├── landing.html        # LP（未ログイン）
│   ├── auth.html           # ログイン/登録
│   ├── plans.html          # 料金プラン
│   ├── legal.html          # 利用規約
│   ├── payment_success.html # 決済完了
│   ├── character-preview.html # 旧キャラプレビュー（未使用）
│   ├── app.js              # 1800行 フロント JS
│   ├── style.css           # 2100行 CSS
│   ├── boba-icon.svg       # ロゴ（ミルクティー版）
│   ├── manifest.json       # PWA manifest
│   └── sw.js               # Service Worker
│
├── logs/                   # 開発セッションログ（ローカル）
│   ├── session_20260323.md 〜 session_20260330.md
│   ├── app.log
│   └── team_reports/, team_tasks.json
│
├── team/, team_agent.py 等  # 別エージェント関連（未使用）
└── docs/                   # ← この文書ある場所
    └── structure_2026-05-26.md
```

---

## 4. 6キャラクターシステム（2026-05-26 実装）

### キャラ一覧
| 絵文字 | id | 名前 | 性別 | 性格 | 得意テーマ | Chirp 3 HD ボイス | プラン |
|--------|-----|------|------|------|---------|----------|------|
| 🫧 | `milk` | ミルクボバ | 女性（若） | おっとり癒し系 | 💬 日常会話 | Aoede | 無料 |
| 🍵 | `matcha` | 抹茶ボバ | 女性（先生） | 真面目しっかり | 💼 ビジネス | Kore | 無料 |
| 🔥 | `kokutou` | 黒糖ボバ | 男性 | やんちゃ・ノリ良い | 🎮 趣味 | Charon | 有料 |
| 🍓 | `ichigo` | いちごボバ | 子供（中性） | 食いしん坊・好奇心 | 🍜 食べ物 | Puck | 有料 |
| ☕ | `coffee` | コーヒーボバ | 男性 | クール・知的 | 🎬 映画音楽 | Fenrir | 有料 |
| 🌸 | `sakura` | 桜ボバ | 女性（大人） | 旅好き・フランク | ✈️ 旅行 | Zephyr | 有料 |

定義場所: `app.py` の `CHARACTERS` 辞書（170-260行付近）

### 切替動線
- ドロワー（≡）→ 「🫧 ボバを選ぶ」セクション（2×3 グリッド）
- 1tap 切替、`/api/character` で永続化
- 無料ユーザーが有料キャラを tap → 「アップグレードしますか？」 → `/plans`

### 各キャラの persona
`app.py` の `CHARACTERS[id]["persona"]` に英文で定義。Bobaの口調・好み・話題の傾向が記述されている。

---

## 5. 文法フィードバック強化（2026-05-26 実装）

ユーザー吹き出しの下に**評価チップを毎回表示**（折りたたみ式）。

### 5段階評価（naturalness）
| 評価 | チップ | 詳細展開時の表示 |
|------|--------|---------------|
| ✨ Perfect | 緑系 | 「ナチュラル！」 |
| 👍 Natural | 茶系 | 「OK!」+ 微改善（あれば） |
| 💡 通じる | 黄系 | 自然な言い方候補 1-3個（定番/カジュアル/シンプル） + 練習ボタン |
| 📝 [ミスタグ] | 桃系 | correction（おしい！...例文付き） + corrected_english + 練習ボタン |
| ❓ うまく取れず | グレー | 「もう一度ゆっくり言ってみよう」 |

### ミス分類タグ（11種）
時制 / 主語動詞一致 / 冠詞 / 前置詞 / 語順 / 可算不可算 / 動名詞不定詞 / 関係代名詞 / 単複 / スペリング / その他

### 練習ボタン
tap で入力欄に正しい英文・候補英文がプリセットされて、その場で言い直し練習できる。

### 苦手分野統計
- 全ミスを `mistake_log` テーブルに蓄積
- Stats モーダルで「苦手分野 TOP（直近30日）🥇🥈🥉」表示

---

## 6. 音声システム

### Chirp 3 HD（有料プラン）
- `/api/tts` で MP3 取得（Base64でなく音声バイナリ直返し）
- ブラウザ側で **AudioContext + BufferSource** で再生（自動再生制限回避）
- DBに `tts_cache(text_hash, voice_id, audio_blob)` でキャッシュ
  - 初回 ~1秒 → 2回目以降 ~6ms（173倍速）
- ピッチ・話速調整可能（現状: speakingRate 0.95）

### フォールバック
- 無料プラン → 直接ブラウザ Web Speech API
- Chirp API 失敗時 → 自動でブラウザ TTS に切替（コンソールに警告ログ）

### キャッシュ予想ヒット率
- スターター・opener・「Yay!」「Tell me more」等の共通文 → 15〜25% 削減見込み
- 起動時の事前生成は未実装（Phase 4 候補）

---

## 7. プラン構成

| プラン | 月額 | 会話回数 | キャラ | TTS | 状態 |
|--------|------|---------|--------|------|------|
| 無料 | ¥0 | 30/月 | ミルク + 抹茶 | ブラウザTTS | 実装済 |
| スタンダード | ¥480 | 600/月 | 全6キャラ | Chirp 3 HD | 実装済 |
| プレミアム | ¥980 | 無制限* | 全6キャラ + 速度/ピッチ調整（予定） | Chirp 3 HD | 速度/ピッチ未実装 |

\* 公正利用条項（目安月2000回）は利用規約で文言追加予定（未対応）

### コスト構造（1ユーザーあたり）
- 平均ユーザー（月200回）: TTS ¥45 + 他¥62 = ¥107 → 粗利 ¥373（78%）
- ヘビーユーザー（月600回）: TTS ¥135 + 他¥91 = ¥226 → 粗利 ¥254（53%）
- Google TTS 無料枠 月100万文字（約100ユーザー分）→ 初期は TTS 実質¥0

---

## 8. API エンドポイント一覧

### 認証
| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/register` | 新規登録 |
| POST | `/api/login` | ログイン |
| POST | `/api/logout` | ログアウト |
| GET | `/api/me` | 現在ユーザー情報 + 現在キャラ |

### 会話
| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/chat` | 会話生成（character, theme, difficulty を受け取り JSON返却） |
| POST | `/api/transcribe` | マイク音声→英文 |
| POST | `/api/hint` | 返し方ヒント生成（3案） |
| POST | `/api/correct` | （補助）スピーチ補正 |

### TTS / キャラ（2026-05-26 追加）
| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/tts` | Chirp 3 HD で音声生成、キャッシュ込み |
| GET | `/api/characters` | 全キャラ一覧 + プラン情報 |
| POST | `/api/character` | キャラ選択保存 |

### 統計（2026-05-26 一部追加）
| メソッド | パス | 用途 |
|---------|------|------|
| GET | `/api/progress` | テーマ別進捗 |
| GET | `/api/mistakes/top` | 苦手分野 TOP（直近30日） |
| GET | `/api/daily-challenge` | 今日の一言 |

### 課金
| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/stripe/checkout` | チェックアウト開始 |
| POST | `/api/stripe/webhook` | プラン状態同期 |
| GET | `/payment/success` | 完了画面 |

### Push通知
| メソッド | パス | 用途 |
|---------|------|------|
| GET | `/api/push/vapid-public-key` | 公開鍵取得 |
| POST | `/api/push/subscribe` | 購読登録 |
| POST | `/api/push/unsubscribe` | 解除 |

### 開発/管理
| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/admin/upgrade` | secret_key 付きでプラン強制変更 |
| POST | `/api/dev/switch-plan` | **2026-05-26 追加**: ログイン中ユーザーが自分のプランを切替（テスト用、本番では削除予定） |
| POST | `/api/feedback` | ⭐評価フィードバック |

---

## 9. データベーススキーマ

### users
```sql
id, email, password_hash, created_at,
plan ('free'|'light'|'premium'),
usage_count, usage_reset_at,
stripe_customer_id, stripe_subscription_id,
streak, last_active_date,
referral_code, bonus_count,
chosen_character ('milk'|'matcha'|'kokutou'|'ichigo'|'coffee'|'sakura')   ← 2026-05-26 追加
```

### theme_progress
```sql
user_id, theme, session_count, message_count
PRIMARY KEY (user_id, theme)
```

### tts_cache  ← 2026-05-26 追加
```sql
id, text_hash, voice_id, audio_blob (BLOB), created_at, hit_count
UNIQUE (text_hash, voice_id)
```

### mistake_log  ← 2026-05-26 追加
```sql
id, user_id, mistake_type, original_text, corrected_text, created_at
INDEX (user_id, created_at DESC)
```

### その他
- `feedbacks` (rating + comment)
- `page_views` (アクセス解析)
- `push_subscriptions` (Web Push)

---

## 10. UI 主要画面

### `/` (index.html) — メインチャット
- ヘッダー: ロゴ + 使用回数バッジ + ≡（ハンバーガー）
- AIキャラクター（Bobaの顔、表情6種で動く: happy/cheer/wow/think/oops/shy/sleep）
- チャットエリア（welcome画面 → ユーザーメッセージ + 評価チップ + Bobaメッセージ）
- 入力エリア: textarea + 💡ヒント + ➤送信 + 🎙️マイク

### ドロワー（≡ で右からスライドイン）
1. 🫧 ボバを選ぶ — 6キャラ 2×3 グリッド
2. ⚙️ 設定 — 難易度 / 名前 / 📬 リマインダー / 新しい会話ボタン / 招待リンク
3. 🔗 そのほか — 履歴 / プラン / フィードバック / ログアウト
4. 🛠️ プラン切替（テスト用）← **2026-05-26 追加**: 無料/スタンダード/プレミアム 即切替
5. フッター — Web / 利用規約

### モーダル
- 📚 会話履歴
- 📊 あなたの成長（ストリーク + テーマ別レベル + 苦手TOP3）
- 📝 今日の振り返り（会話終了時の表現カード）
- ⭐ フィードバック

### `/auth`, `/plans`, `/landing`, `/legal`, `/payment-success`
独立ページ

---

## 11. 2026-05-26 セッションでやった変更まとめ

### 追加
- Google Cloud Text-to-Speech API キー取得・`.env` 投入
- `google-cloud-texttospeech` パッケージ追加
- `tts_cache` テーブル
- `mistake_log` テーブル
- `users.chosen_character` カラム
- `CHARACTERS` 辞書（6キャラ persona + voice + theme + plan_required）
- `/api/tts` を OpenAI TTS → **Google Chirp 3 HD + キャッシュ**に書き換え
- `/api/characters`, `/api/character` 新設
- `/api/mistakes/top` 新設
- `/api/dev/switch-plan` 新設（テスト用プラン切替）
- フロント `speak()` を AudioContext ストリーミング再生に書き換え
- ドロワーにキャラピッカー UI（2×3 グリッド）
- メッセージラベルが現在キャラに追従（🫧 ミルクボバ / 🍵 抹茶ボバ…）
- ユーザー吹き出し下の**評価チップ + 折りたたみ詳細パネル**
- 練習ボタン（入力欄プリセット）
- Stats モーダルに「苦手分野 TOP」セクション
- ドロワー整理（テーマ select / 読み上げ select 削除、リマインダー rename、フッター追加）

### system_prompt 拡張
- キャラの persona を動的に注入
- 新フィールド `naturalness` / `natural_alternatives` / `mistake_type` / `corrected_english` を毎回必須出力に
- 「中国語混入禁止」「文法精度最優先」「自然な日本語」ルールを引き続き強調

---

## 12. 未対応 / 次回以降

| 項目 | 優先 |
|------|------|
| Fly.io デプロイ（本番反映） | 高 |
| プラン説明文の更新（landing.html / plans.html に新機能反映） | 高 |
| 利用規約に「公正利用条項」追加（Premium 月2000回目安） | 中 |
| キャラ別 SVG アクセサリ素材（外注 or DALL-E）→ ビジュアル強化 | 中 |
| TTS opener 事前生成（起動時に各キャラ opener を一括生成しキャッシュ投入） | 中 |
| Premium 限定: 速度/ピッチ調整UI | 低 |
| `/api/dev/switch-plan` を本番では無効化 | 高（デプロイ前必須） |
| PostgreSQL マイグレ動作確認（INTEGER AUTOINCREMENT vs SERIAL） | 高（デプロイ時） |
| ストリーミングTTS（文単位の分割再生で体感さらに高速化） | 低 |

---

## 13. ローカル動作確認方法

```bash
cd ~/Projects/english-conversation-app
set -a; source .env; set +a
.venv/bin/python app.py
# → http://localhost:8080
```

ログイン情報（テスト用）:
- email: `bobatest_local_2026@example.com`
- password: `testbobaPass2026`

---

## 14. 既知の癖・注意点

- `data.db` がDB本体（`app.db` は古い空ファイル、放置可）
- `requirements.txt` には `anthropic` / `openai` も入ってるが現状コード上ではほぼ未使用（消すと壊れる可能性あるので touch しない）
- フロント Service Worker (`sw.js`) は PWA 用、有効
- referral_code は新規ユーザー作成時に自動発行（招待リンクで +70回ボーナス）
- streak 更新は `update_streak()`、日付ベースで連続日数判定
