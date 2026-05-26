import os
import json
import re
import sqlite3
import contextlib
import secrets
from datetime import date, datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory, session
from werkzeug.security import generate_password_hash, check_password_hash
from groq import Groq
import stripe
from pywebpush import webpush, WebPushException

app = Flask(__name__, static_folder="public")
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")

# ── ログイン試行回数制限 ────────────────────────────────────────────────────────
_login_attempts: dict[str, dict] = {}  # { ip: { count, locked_until } }
LOGIN_MAX_ATTEMPTS = 5
LOGIN_LOCKOUT_MINUTES = 15

def _get_client_ip() -> str:
    return request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()

def _check_login_rate_limit(ip: str) -> tuple[bool, str]:
    """ロック中なら (True, メッセージ) を返す"""
    rec = _login_attempts.get(ip)
    if rec and rec["locked_until"] and datetime.utcnow() < rec["locked_until"]:
        remaining = int((rec["locked_until"] - datetime.utcnow()).total_seconds() / 60) + 1
        return True, f"ログイン試行が多すぎます。{remaining}分後に再試行してください。"
    return False, ""

def _record_login_failure(ip: str):
    rec = _login_attempts.setdefault(ip, {"count": 0, "locked_until": None})
    # ロック期限切れならリセット
    if rec["locked_until"] and datetime.utcnow() >= rec["locked_until"]:
        rec["count"] = 0
        rec["locked_until"] = None
    rec["count"] += 1
    if rec["count"] >= LOGIN_MAX_ATTEMPTS:
        rec["locked_until"] = datetime.utcnow() + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)

def _reset_login_attempts(ip: str):
    _login_attempts.pop(ip, None)
app.config["SESSION_PERMANENT"] = True
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)

_groq_client = None

def get_groq():
    global _groq_client
    if _groq_client is None:
        _groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY", ""))
    return _groq_client

_gemini_client = None

def get_gemini():
    global _gemini_client
    if _gemini_client is None:
        from google import genai
        _gemini_client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
    return _gemini_client

def _pcm_to_wav(pcm_data: bytes, sample_rate: int = 24000) -> bytes:
    import struct, io as _io
    num_channels, bits = 1, 16
    byte_rate    = sample_rate * num_channels * bits // 8
    block_align  = num_channels * bits // 8
    buf = _io.BytesIO()
    buf.write(struct.pack('<4sI4s', b'RIFF', 36 + len(pcm_data), b'WAVE'))
    buf.write(struct.pack('<4sIHHIIHH', b'fmt ', 16, 1, num_channels,
                          sample_rate, byte_rate, block_align, bits))
    buf.write(struct.pack('<4sI', b'data', len(pcm_data)))
    buf.write(pcm_data)
    return buf.getvalue()

# ── VAPID (Web Push) ───────────────────────────────────────────────────────────
VAPID_PUBLIC_KEY  = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_CLAIMS      = {"sub": "mailto:admin@talkboba.app"}

# ── Stripe ─────────────────────────────────────────────────────────────────────
stripe.api_key             = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET      = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_IDS = {
    "light":   os.environ.get("STRIPE_LIGHT_PRICE_ID", ""),
    "premium": os.environ.get("STRIPE_PREMIUM_PRICE_ID", ""),
}

DATABASE_URL = os.environ.get("DATABASE_URL", "")
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "data.db"))

if DATABASE_URL:
    import psycopg2
    import psycopg2.extras


class _PgConn:
    """psycopg2 を sqlite3 風に使えるようにする薄いラッパー。"""
    def __init__(self, conn, cur):
        self._conn = conn
        self._cur = cur

    def execute(self, sql, params=()):
        self._cur.execute(sql.replace("?", "%s"), params)
        return self._cur

    def commit(self):
        self._conn.commit()


@contextlib.contextmanager
def get_db():
    if DATABASE_URL:
        url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
        conn = psycopg2.connect(url)
        cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield _PgConn(conn, cur)
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()
            conn.close()
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

FREE_MONTHLY_LIMIT     = 30
LIGHT_MONTHLY_LIMIT    = 300
PREMIUM_MONTHLY_LIMIT  = 1000

# ── Conversation settings ──────────────────────────────────────────────────────

THEME_CONTEXTS = {
    "daily": """everyday life. Talk about topics like weather, weekend plans, family, friends, daily routines, and personal experiences.
Steer the conversation naturally with follow-up questions. Act like a friendly neighbor having a casual chat.""",

    "travel": """travel and tourism. Discuss destinations, trip planning, transportation, hotels, sightseeing, local culture, and travel tips.
Role-play as a travel companion — ask where they've been, where they want to go, and share travel advice.""",

    "business": """professional English in the workplace. Cover topics like meetings, presentations, emails, negotiations, job interviews, and office situations.
Act as a business partner. Use formal but natural business English, and teach professional phrases and expressions.""",

    "hobbies": """hobbies, sports, and leisure activities. Discuss sports, outdoor activities, games, crafts, reading, fitness, and any personal interests.
Be enthusiastic and curious about the user's hobbies. Ask specific questions to dig deeper into their interests.""",

    "food": """food and dining. Talk about favorite dishes, restaurants, cooking, recipes, food culture, and dining experiences around the world.
Act like a fellow food lover. Share enthusiasm for food, ask about their favorites, and discuss cultural food differences.""",

    "movies": """movies, TV shows, music, books, and pop culture. Discuss genres, favorites, recommendations, plots, and cultural trends.
Act like an entertainment enthusiast. React naturally to their opinions and explore what they enjoy and why.""",
}

DIFFICULTY_INSTRUCTIONS = {
    "beginner": """- Use very simple, common vocabulary (CEFR A1-A2 level)
- Speak in short, clear sentences (max 2 sentences per response)
- Correct ALL grammar mistakes gently with encouragement
- Explain every new word or phrase in Japanese
- Ask simple yes/no or choice questions to keep the conversation going""",
    "intermediate": """- Use natural, conversational English (CEFR B1-B2 level)
- Keep responses to 2-3 sentences
- Correct significant grammar mistakes
- Explain interesting idioms and expressions when they appear""",
    "advanced": """- Use sophisticated vocabulary and varied sentence structures (CEFR C1-C2 level)
- Keep responses to 3-4 sentences
- Only correct serious or repeated grammar mistakes
- Use idioms, phrasal verbs, and natural expressions freely""",
}

# ── Characters ─────────────────────────────────────────────────────────────────

CHARACTERS = {
    "milk": {
        "name": "ミルクボバ",
        "name_en": "Milk Boba",
        "gender": "female",
        "voice_id": "en-US-Chirp3-HD-Aoede",
        "theme_specialty": "daily",
        "plan_required": "free",
        "emoji": "🫧",
        "persona": (
            "Your specific personality is: gentle, calming, slightly shy. "
            "You love quiet moments — warm tea, soft weather, little discoveries. "
            "You sometimes mention briefly that you 'just had a warm sip of milk tea' or 'took a quiet nap by the window'. "
            "Speak softly and slowly. Best with daily-life chitchat."
        ),
    },
    "matcha": {
        "name": "抹茶ボバ",
        "name_en": "Matcha Boba",
        "gender": "female",
        "voice_id": "en-US-Chirp3-HD-Kore",
        "theme_specialty": "business",
        "plan_required": "free",
        "emoji": "🍵",
        "persona": (
            "Your specific personality is: studious, precise, slightly serious — like a kind teacher from Kyoto. "
            "You take learning seriously and give thorough, accurate grammar explanations. "
            "You enjoy organized things and quality. You occasionally mention your tea ceremony practice. "
            "Best with business English and structured learning."
        ),
    },
    "kokutou": {
        "name": "黒糖ボバ",
        "name_en": "Kokutou Boba",
        "gender": "male",
        "voice_id": "en-US-Chirp3-HD-Charon",
        "theme_specialty": "hobbies",
        "plan_required": "paid",
        "emoji": "🔥",
        "persona": (
            "Your specific personality is: energetic, playful, casual — like a fun older brother who's into sports and games. "
            "Use casual slang naturally ('Yo!', 'Sick!', 'No way!'). Be enthusiastic. "
            "You mention games, sports, or your latest hobby obsession. "
            "Best with hobbies and entertainment topics."
        ),
    },
    "ichigo": {
        "name": "いちごボバ",
        "name_en": "Ichigo Boba",
        "gender": "child",
        "voice_id": "en-US-Chirp3-HD-Puck",
        "theme_specialty": "food",
        "plan_required": "paid",
        "emoji": "🍓",
        "persona": (
            "Your specific personality is: childlike, food-obsessed, super curious. "
            "React with wide-eyed wonder ('Whoa!', 'Yummy!', 'Really really?!'). "
            "Ask lots of 'why' and 'how' questions. Always relate things to food when possible. "
            "Best with food and cooking topics."
        ),
    },
    "coffee": {
        "name": "コーヒーボバ",
        "name_en": "Coffee Boba",
        "gender": "male",
        "voice_id": "en-US-Chirp3-HD-Fenrir",
        "theme_specialty": "movies",
        "plan_required": "paid",
        "emoji": "☕",
        "persona": (
            "Your specific personality is: cool, intellectual, a bit reserved — like a senior who knows a lot about films and music. "
            "Speak concisely. Drop subtle movie or music references when natural. "
            "Don't over-explain. Give brief, sharp feedback. "
            "Best with movies, music, and pop culture topics."
        ),
    },
    "sakura": {
        "name": "桜ボバ",
        "name_en": "Sakura Boba",
        "gender": "female",
        "voice_id": "en-US-Chirp3-HD-Zephyr",
        "theme_specialty": "travel",
        "plan_required": "paid",
        "emoji": "🌸",
        "persona": (
            "Your specific personality is: warm older-sister energy, well-traveled, frank. "
            "You've been to many places and casually drop travel memories ('When I was in Bali...', 'Reminds me of Lisbon'). "
            "Encourage the learner like a friend, not a teacher. "
            "Best with travel topics."
        ),
    },
}

def get_character(character_id):
    return CHARACTERS.get(character_id, CHARACTERS["milk"])

def _row_to_dict(row):
    """sqlite3.Row も psycopg2 dict-row も dict 化する小ヘルパー。"""
    if row is None:
        return {}
    if isinstance(row, dict):
        return dict(row)
    try:
        return {k: row[k] for k in row.keys()}
    except Exception:
        return {}

def build_system_prompt(theme="daily", difficulty="intermediate", nickname="", character_id="milk"):
    theme_ctx = THEME_CONTEXTS.get(theme, THEME_CONTEXTS["daily"])
    diff_inst = DIFFICULTY_INSTRUCTIONS.get(difficulty, DIFFICULTY_INSTRUCTIONS["intermediate"])
    char = get_character(character_id)
    name_hint = ""
    if nickname:
        name_hint = f"\n- The user's name is {nickname}. Speech recognition may garble it (e.g. '{nickname}' might appear as phonetic approximations in English). Always recognize and use the correct name and call them by it occasionally to feel personal."
    return f"""You are {char['name']} ({char['name_en']}), a boba milk-tea character helping Japanese learners practice English. Your TOP PRIORITY is **accurate grammar feedback and accurate, natural Japanese explanations**. Never sacrifice correctness for cuteness.

PERSONALITY:
{char['persona']}

GENERAL TONE GUIDELINES:
- Warm and encouraging, but grammar accuracy comes first.
- You ask one short follow-up question at the end of most replies to keep conversation flowing.
- Use 1-2 cozy emojis sparingly. Don't spam.
- Your signature emoji is {char['emoji']} — use it occasionally but don't overuse.

Conversation focus: {theme_ctx}

Difficulty level:
{diff_inst}

═══════════════════════════════════════════════════════════════════
INPUT INTERPRETATION — Critical distinction between two error types
═══════════════════════════════════════════════════════════════════

The user input may come from voice (Web Speech API) OR keyboard. You MUST distinguish these two cases sharply:

【A】"corrected_input" は **音韻的な聞き取りミスだけ** に使う：
- 固有名詞のカタカナ→英語の変換失敗
  - 例: "foo coo oka" / "fu ku o ka" → "Fukuoka"
  - 例: "sushi row" → "Sushiro", "os a ka" → "Osaka", "to kyo" → "Tokyo"
  - 例: "yo she da" → "Yoshida", "toy" / "toe hick" → "TOEIC", "toe full" → "TOEFL"
- 単語の音的近似のミス（"meet" → "meat" を音だけで誤認 等、明らかに発音揺れ由来のスペル違い）
- 文意を変えない、純粋な音→文字変換ミス

【B】"correction" は **文法ミスだけ** に使う：
- 動詞の時制ミス（"I go to Osaka yesterday" → 過去形 "I went to Osaka yesterday"）
- 主語と動詞の一致（"He go" → "He goes"）
- 冠詞の有無（"I have car" → "I have a car"）
- 前置詞ミス（"on Monday" vs "in Monday"）
- 単複の一致、語順、不可算名詞、関係代名詞 など、ルール違反すべて

→ ❗ **時制・一致・冠詞・前置詞などの文法ミスを絶対に corrected_input に押し込んではいけない。** それは grammar correction であって、speech recognition error ではない。両方ミスがあれば両方フィールドを埋める。

═══════════════════════════════════════════════════════════════════
"correction" フィールドの書き方ルール
═══════════════════════════════════════════════════════════════════

Bobaの口調はやわらかく、しかし **文法ルールの説明は必ず正確に**。優しさで曖昧にしない。

書式（必須要素）：
1. ひと言の声かけ（例:「おしい！」「ちっちゃい直しだけ〜」「いい感じ✨」）
2. **「○○ → ○○」の形で具体的に何を直すか明示**
3. **理由をルールベースで明記** — 「過去形だから」「三人称単数だから」「不可算名詞だから」など
4. 必要なら短い例文（自然な英語で）

良い例（"I go to Osaka yesterday" の場合）：
「おしい！『yesterday』があるから過去形 went を使うよ。go → went。例: I **went** to Osaka yesterday.」

悪い例（曖昧でNG）：
「ちょっと自然にすると I went to Osaka yesterday になるよ〜」 ← 何がなぜ違うのか説明されていない

悪い例（語調が硬すぎてNG）：
「これは間違いです。yesterday は過去形を要求します。」 ← Bobaらしくない

═══════════════════════════════════════════════════════════════════
日本語の正確さ
═══════════════════════════════════════════════════════════════════

日本語のすべての出力（japanese_translation, user_translation, correction, expression_tip）について：
- **絶対に中国語の漢字（簡体字・繁体字）を混入させないこと。** 日本語の常用漢字＋ひらがな＋カタカナだけを使う。具体的には次の文字は禁止：
  - 簡体字（例：们・个・这・时・国（中）・说・请・现 など中国本土の簡略字形）
  - 繁体字のうち日本で使わない字形（例：學→学／國→国／實→実 など、必ず日本字形を使う）
  - 中国語特有の語彙・表現（例：「謝謝」「請」「沒問題」など）
- 出力前に自分で日本語として自然か、漢字が日本の字形か、もう一度確認する。少しでも怪しければひらがなに開く。
- 自然で正確な日本語を書く。直訳調や機械翻訳調は避ける。
- 文法用語は正しく使う（「過去形」「現在完了」「三人称単数のs」「不定冠詞」「前置詞」「自動詞/他動詞」など）。
- 助詞の脱落・誤用（「を」「が」「に」「で」「は」）は厳禁。
- 句読点を正しく打つ。長文では「、」を適切に使う。
- カタカナ語の表記揺れに注意（例: 「コンピューター」と「コンピュータ」を混在させない）。
- 直訳するより、ネイティブの日本語話者が自然に使う表現を選ぶ。{name_hint}

═══════════════════════════════════════════════════════════════════
"mood" の選択
═══════════════════════════════════════════════════════════════════

- "happy"  : デフォルト。普通の温かい返答
- "cheer"  : ユーザーが何かうまく言えた / 良い表現を使った時に祝う
- "wow"    : ユーザーが面白い・驚くような話を共有した時
- "think"  : 文法ポイントや表現の説明をしている時（correction や expression_tip がある時）
- "oops"   : 明確な文法ミスがあって correction を返す時
- "shy"    : ユーザーから褒められた / Boba自身のことを聞かれた時

→ correction を返す時は基本 "oops"、expression_tip だけなら "think"。

═══════════════════════════════════════════════════════════════════
ユーザー英文の評価（naturalness）— 毎回必ず出力
═══════════════════════════════════════════════════════════════════

ユーザーの直前メッセージを以下の **5段階で必ず評価**：

- "perfect"                : 文法・表現どちらも完璧。ネイティブが自然にそのまま使う英語。
- "natural"                : 自然で通じる。小さな改善余地はあるが概ねOK。
- "understood_but_improvable" : 文法ミスはないが、不自然・直訳調・冗長。もっと自然な言い方が複数ある。
- "has_errors"             : 明確な文法ミスがあり correction が必要。
- "unclear"                : 壊れていて意味が取れない / 英語として成立していない。

ユーザーメッセージが日本語のみ・あいさつのみ・極端に短い場合は "natural" を返す。

═══════════════════════════════════════════════════════════════════
"natural_alternatives" — もっと自然な言い方の候補
═══════════════════════════════════════════════════════════════════

naturalness が "understood_but_improvable" の時に **1〜3個** 出す（文脈に応じて可変）。各候補は以下の構造：
- english : 自然な英語版
- japanese : なぜそれが自然かの簡潔な日本語説明（一行）
- style : "standard" | "casual" | "concise" のいずれか（カードのタグに使う）

例：
[
  {{"english": "I went on a trip to Osaka.", "japanese": "「旅行する」の自然な定番フレーズ", "style": "standard"}},
  {{"english": "I took a trip to Osaka.",   "japanese": "ちょっとカジュアル", "style": "casual"}},
  {{"english": "I visited Osaka.",          "japanese": "シンプルに「訪れた」", "style": "concise"}}
]

他の naturalness 値では空配列 [] を返す。

═══════════════════════════════════════════════════════════════════
"mistake_type" — 文法ミスの分類タグ
═══════════════════════════════════════════════════════════════════

naturalness が "has_errors" の時、ミスの主タグを以下から **1つ**選んで返す（最も典型的なものに絞る）：

- "tense"          : 時制（過去/現在/未来/完了形 etc.）
- "subject_verb"   : 主語・動詞の一致（三人称単数のs 等）
- "article"        : 冠詞（a / an / the / 無冠詞）
- "preposition"    : 前置詞（in/on/at/for/to 等）
- "word_order"     : 語順
- "countable"      : 可算/不可算名詞
- "gerund_infinitive" : 動名詞/不定詞
- "relative"       : 関係代名詞
- "plural"         : 単複
- "spelling"       : スペリング
- "other"          : 上記以外

他の naturalness 値では null を返す。

═══════════════════════════════════════════════════════════════════
mood の選択
═══════════════════════════════════════════════════════════════════

- "happy"  : デフォルト。普通の温かい返答
- "cheer"  : naturalness が "perfect" or "natural" で、ユーザーが何かうまく言えた時
- "wow"    : ユーザーが面白い・驚くような話を共有した時
- "think"  : 文法ポイントや表現の説明をしている時（correction や expression_tip がある時）
- "oops"   : naturalness が "has_errors" で correction を返す時
- "shy"    : ユーザーから褒められた / Boba自身のことを聞かれた時

═══════════════════════════════════════════════════════════════════
JSON 出力フォーマット
═══════════════════════════════════════════════════════════════════

Always respond with this exact JSON structure (no other text):
{{
  "english": "Your English response here",
  "japanese_translation": "Bobaの英語返答の自然な日本語訳",
  "user_translation": "ユーザーの最後のメッセージの自然な日本語訳。意味が取れない壊れた英語なら null。",
  "corrected_input": "音韻的な聞き取りミス（固有名詞のカタカナ→英語など）があれば修正後の英語。文法ミスはここではなく correction に書くこと。なければ null。",
  "correction": "文法ミスがあれば、上のルール通り『声かけ → ○○ → ○○ → 理由 → 例文（任意）』の形で書く。文法ミスがなければ null。",
  "corrected_english": "文法ミスを直した正しい英文（純粋に英語だけ、説明なし）。練習ボタン用。文法ミスがなければ null。",
  "expression_tip": "面白い表現や使える定型句を紹介できる場合の短い解説（日本語）。なければ null。",
  "naturalness": "perfect | natural | understood_but_improvable | has_errors | unclear のどれか1つ。必ず出す。",
  "natural_alternatives": "上記の通り、understood_but_improvable のみ 1〜3個。他は []。",
  "mistake_type": "上記の通り、has_errors のみタグ1つ。他は null。",
  "mood": "happy | cheer | wow | think | oops | shy のどれか1つ"
}}

Important: Return valid JSON only. naturalness は絶対に省略しない。"""


# ── Database ───────────────────────────────────────────────────────────────────

def init_db():
    if DATABASE_URL:
        create_sql = """
            CREATE TABLE IF NOT EXISTS users (
                id                     BIGSERIAL PRIMARY KEY,
                email                  TEXT UNIQUE NOT NULL,
                password_hash          TEXT NOT NULL,
                created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                plan                   TEXT DEFAULT 'free',
                usage_count            INTEGER DEFAULT 0,
                usage_reset_at         DATE DEFAULT (date_trunc('month', CURRENT_DATE)::date),
                stripe_customer_id     TEXT,
                stripe_subscription_id TEXT
            )
        """
    else:
        create_sql = """
            CREATE TABLE IF NOT EXISTS users (
                id                     INTEGER PRIMARY KEY AUTOINCREMENT,
                email                  TEXT UNIQUE NOT NULL,
                password_hash          TEXT NOT NULL,
                created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                plan                   TEXT DEFAULT 'free',
                usage_count            INTEGER DEFAULT 0,
                usage_reset_at         DATE DEFAULT (date('now', 'start of month')),
                stripe_customer_id     TEXT,
                stripe_subscription_id TEXT
            )
        """
    with get_db() as conn:
        conn.execute(create_sql)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS theme_progress (
                user_id       INTEGER NOT NULL,
                theme         TEXT    NOT NULL,
                session_count INTEGER DEFAULT 0,
                message_count INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, theme)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS page_views (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                page       TEXT NOT NULL,
                view_date  DATE NOT NULL,
                count      INTEGER DEFAULT 1,
                UNIQUE(page, view_date)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS feedbacks (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER,
                rating     INTEGER NOT NULL,
                comment    TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                endpoint   TEXT NOT NULL UNIQUE,
                p256dh     TEXT NOT NULL,
                auth       TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
    # マイグレーション: 既存 DB にカラムがなければ追加
    with get_db() as conn:
        for col_def in (
            "stripe_customer_id TEXT",
            "stripe_subscription_id TEXT",
            "streak INTEGER DEFAULT 0",
            "last_active_date TEXT",
            "referral_code TEXT",
            "bonus_count INTEGER DEFAULT 0",
            "chosen_character TEXT DEFAULT 'milk'",
        ):
            try:
                conn.execute(f"ALTER TABLE users ADD COLUMN {col_def}")
                conn.commit()
            except Exception:
                pass  # すでに存在する

    # TTS音声キャッシュ（事前生成 + 動的キャッシュ両用）
    # SQLite と PostgreSQL で構文が違うため分岐
    if DATABASE_URL:
        tts_sql = """
            CREATE TABLE IF NOT EXISTS tts_cache (
                id          BIGSERIAL PRIMARY KEY,
                text_hash   TEXT NOT NULL,
                voice_id    TEXT NOT NULL,
                audio_blob  BYTEA NOT NULL,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                hit_count   INTEGER DEFAULT 0,
                UNIQUE(text_hash, voice_id)
            )
        """
        mistake_sql = """
            CREATE TABLE IF NOT EXISTS mistake_log (
                id             BIGSERIAL PRIMARY KEY,
                user_id        BIGINT NOT NULL,
                mistake_type   TEXT NOT NULL,
                original_text  TEXT,
                corrected_text TEXT,
                created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """
    else:
        tts_sql = """
            CREATE TABLE IF NOT EXISTS tts_cache (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                text_hash   TEXT NOT NULL,
                voice_id    TEXT NOT NULL,
                audio_blob  BLOB NOT NULL,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                hit_count   INTEGER DEFAULT 0,
                UNIQUE(text_hash, voice_id)
            )
        """
        mistake_sql = """
            CREATE TABLE IF NOT EXISTS mistake_log (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id        INTEGER NOT NULL,
                mistake_type   TEXT NOT NULL,
                original_text  TEXT,
                corrected_text TEXT,
                created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """
    with get_db() as conn:
        try:
            conn.execute(tts_sql)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tts_cache_lookup ON tts_cache(text_hash, voice_id)")
            conn.commit()
        except Exception as e:
            print(f"⚠️ tts_cache 作成スキップ: {e}")
    with get_db() as conn:
        try:
            conn.execute(mistake_sql)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_mistake_log_user ON mistake_log(user_id, created_at DESC)")
            conn.commit()
        except Exception as e:
            print(f"⚠️ mistake_log 作成スキップ: {e}")
    # referral_code が未設定のユーザーに発行
    with get_db() as conn:
        rows = conn.execute("SELECT id FROM users WHERE referral_code IS NULL").fetchall()
        for row in rows:
            code = secrets.token_urlsafe(6)
            conn.execute("UPDATE users SET referral_code = ? WHERE id = ?", (code, row["id"]))
        if rows:
            conn.commit()

def get_current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    with get_db() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

def refresh_user(user_id):
    with get_db() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

def reset_usage_if_needed(user):
    """Reset usage count at the start of a new calendar month."""
    today = date.today()
    raw = user["usage_reset_at"]
    reset_date = raw if isinstance(raw, date) else date.fromisoformat(raw)
    if today.year != reset_date.year or today.month != reset_date.month:
        new_reset = date(today.year, today.month, 1).isoformat()
        with get_db() as conn:
            conn.execute(
                "UPDATE users SET usage_count = 0, usage_reset_at = ? WHERE id = ?",
                (new_reset, user["id"]),
            )
            conn.commit()
        return refresh_user(user["id"])
    return user

def get_limit(plan, bonus_count=0):
    if plan == "premium":
        return PREMIUM_MONTHLY_LIMIT + (bonus_count or 0)
    if plan == "light":
        return LIGHT_MONTHLY_LIMIT + (bonus_count or 0)
    return FREE_MONTHLY_LIMIT + (bonus_count or 0)

def update_streak(user_id: int) -> tuple[int, bool]:
    """ストリークを更新し (新しいstreak数, 今日初めてか) を返す"""
    today = date.today().isoformat()
    with get_db() as conn:
        row = conn.execute(
            "SELECT streak, last_active_date FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        streak   = row["streak"] or 0
        last_day = row["last_active_date"]

        if last_day == today:
            return streak, False  # 今日すでにカウント済み

        yesterday = (date.today() - timedelta(days=1)).isoformat()
        if last_day == yesterday:
            streak += 1           # 連続
        else:
            streak = 1            # リセット

        conn.execute(
            "UPDATE users SET streak = ?, last_active_date = ? WHERE id = ?",
            (streak, today, user_id),
        )
        conn.commit()
    return streak, True


def user_to_dict(user):
    bonus = user["bonus_count"] or 0
    limit = get_limit(user["plan"], bonus)
    return {
        "email":         user["email"],
        "plan":          user["plan"],
        "usage_count":   user["usage_count"],
        "limit":         limit,
        "remaining":     None if limit is None else max(0, limit - user["usage_count"]),
        "streak":        user["streak"] or 0,
        "referral_code": user["referral_code"] or "",
        "bonus_count":   bonus,
    }


# ── 診断 ──────────────────────────────────────────────────────────────────────

@app.route("/api/models")
def list_models():
    try:
        models = [m.name for m in get_gemini().models.list()]
        return jsonify({"models": models})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Auth routes ────────────────────────────────────────────────────────────────

REFERRAL_BONUS = 70

@app.route("/api/register", methods=["POST"])
def register():
    data     = request.json or {}
    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")
    ref_code = data.get("ref_code", "").strip()

    if not email or not password:
        return jsonify({"error": "メールアドレスとパスワードを入力してください"}), 400
    if len(password) < 6:
        return jsonify({"error": "パスワードは6文字以上にしてください"}), 400

    my_code = secrets.token_urlsafe(6)
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO users (email, password_hash, referral_code) VALUES (?, ?, ?)",
                (email, generate_password_hash(password, method="pbkdf2:sha256"), my_code),
            )
            conn.commit()
            user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

            # 紹介コードが有効なら双方にボーナス付与
            if ref_code:
                referrer = conn.execute(
                    "SELECT id FROM users WHERE referral_code = ? AND id != ?",
                    (ref_code, user["id"]),
                ).fetchone()
                if referrer:
                    conn.execute(
                        "UPDATE users SET bonus_count = COALESCE(bonus_count,0) + ? WHERE id = ?",
                        (REFERRAL_BONUS, referrer["id"]),
                    )
                    conn.execute(
                        "UPDATE users SET bonus_count = COALESCE(bonus_count,0) + ? WHERE id = ?",
                        (REFERRAL_BONUS, user["id"]),
                    )
                    conn.commit()
                    user = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()

        session.permanent = True
        session["user_id"] = user["id"]
        return jsonify({"ok": True, **user_to_dict(user)})
    except Exception as e:
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            return jsonify({"error": "このメールアドレスは既に登録されています"}), 409
        raise


@app.route("/api/login", methods=["POST"])
def login():
    ip = _get_client_ip()
    locked, msg = _check_login_rate_limit(ip)
    if locked:
        return jsonify({"error": msg}), 429

    data     = request.json or {}
    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")

    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if not user or not check_password_hash(user["password_hash"], password):
        _record_login_failure(ip)
        return jsonify({"error": "メールアドレスまたはパスワードが違います"}), 401

    _reset_login_attempts(ip)
    session.permanent = True
    session["user_id"] = user["id"]
    user = reset_usage_if_needed(user)
    return jsonify({"ok": True, **user_to_dict(user)})


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
def me():
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401
    user = reset_usage_if_needed(user)
    d = user_to_dict(user)
    d["chosen_character"] = _row_to_dict(user).get("chosen_character") or "milk"
    return jsonify(d)


@app.route("/api/characters")
def list_characters():
    """全6キャラのリスト + ユーザーのプラン情報"""
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401
    user_dict = _row_to_dict(user)
    plan = user_dict.get("plan") or "free"
    chosen = user_dict.get("chosen_character") or "milk"
    out = []
    for cid, c in CHARACTERS.items():
        unlocked = (c["plan_required"] == "free") or (plan != "free")
        out.append({
            "id":             cid,
            "name":           c["name"],
            "name_en":        c["name_en"],
            "emoji":          c["emoji"],
            "gender":         c["gender"],
            "voice_id":       c["voice_id"],
            "theme_specialty": c["theme_specialty"],
            "plan_required":  c["plan_required"],
            "unlocked":       unlocked,
        })
    return jsonify({"characters": out, "chosen": chosen, "plan": plan})


@app.route("/api/character", methods=["POST"])
def set_character():
    """ユーザーのキャラ選択を保存"""
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401
    data = request.json or {}
    cid = data.get("character", "milk")
    if cid not in CHARACTERS:
        return jsonify({"error": "unknown character"}), 400
    # 無料ユーザーが有料キャラ選択時は拒否
    user_dict = _row_to_dict(user)
    plan = user_dict.get("plan") or "free"
    if CHARACTERS[cid]["plan_required"] == "paid" and plan == "free":
        return jsonify({"error": "premium_required", "character": cid}), 403
    with get_db() as conn:
        conn.execute("UPDATE users SET chosen_character = ? WHERE id = ?", (cid, user_dict["id"]))
        conn.commit()
    return jsonify({"ok": True, "chosen": cid})


# ── Analytics helpers ──────────────────────────────────────────────────────────

def record_pageview(page: str):
    today = date.today().isoformat()
    try:
        with get_db() as conn:
            conn.execute(
                """INSERT INTO page_views (page, view_date, count) VALUES (?, ?, 1)
                   ON CONFLICT(page, view_date) DO UPDATE SET count = count + 1""",
                (page, today),
            )
            conn.commit()
    except Exception:
        pass


# ── Static pages ───────────────────────────────────────────────────────────────

@app.route("/")
def index():
    if session.get("user_id"):
        record_pageview("app")
        return send_from_directory("public", "index.html")
    record_pageview("landing")
    return send_from_directory("public", "landing.html")

@app.route("/landing")
def landing_page():
    record_pageview("landing")
    return send_from_directory("public", "landing.html")

@app.route("/app")
def app_page():
    return send_from_directory("public", "index.html")

@app.route("/auth")
def auth_page():
    return send_from_directory("public", "auth.html")

@app.route("/plans")
def plans_page():
    return send_from_directory("public", "plans.html")

@app.route("/legal")
def legal_page():
    return send_from_directory("public", "legal.html")

@app.route("/character-preview")
def character_preview():
    return send_from_directory("public", "character-preview.html")

@app.route("/public/<path:filename>")
def static_files(filename):
    return send_from_directory("public", filename)


# ── Stripe ────────────────────────────────────────────────────────────────────

@app.route("/api/stripe/checkout", methods=["POST"])
def stripe_checkout():
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401

    data = request.json or {}
    plan = data.get("plan")
    if plan not in ("light", "premium"):
        return jsonify({"error": "Invalid plan"}), 400

    price_id = STRIPE_PRICE_IDS.get(plan)
    if not price_id:
        return jsonify({"error": "Stripe price ID が未設定です。環境変数を確認してください。"}), 500

    # Stripe カスタマーを取得 or 作成（無効なIDはリセット）
    customer_id = user["stripe_customer_id"]
    if customer_id:
        try:
            stripe.Customer.retrieve(customer_id)
        except stripe.error.InvalidRequestError:
            customer_id = None
            with get_db() as conn:
                conn.execute(
                    "UPDATE users SET stripe_customer_id = NULL WHERE id = ?",
                    (user["id"],),
                )
                conn.commit()

    if not customer_id:
        customer = stripe.Customer.create(email=user["email"])
        customer_id = customer.id
        with get_db() as conn:
            conn.execute(
                "UPDATE users SET stripe_customer_id = ? WHERE id = ?",
                (customer_id, user["id"]),
            )
            conn.commit()

    base_url = request.host_url.rstrip("/")
    checkout_session = stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=f"{base_url}/payment/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{base_url}/plans",
        metadata={"user_id": str(user["id"]), "plan": plan},
    )
    return jsonify({"url": checkout_session.url})


@app.route("/api/stripe/webhook", methods=["POST"])
def stripe_webhook():
    payload    = request.get_data()
    sig_header = request.headers.get("Stripe-Signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError):
        return "", 400

    if event["type"] == "checkout.session.completed":
        s       = event["data"]["object"]
        user_id = s.get("metadata", {}).get("user_id")
        plan    = s.get("metadata", {}).get("plan")
        sub_id  = s.get("subscription")
        if user_id and plan:
            with get_db() as conn:
                conn.execute(
                    "UPDATE users SET plan = ?, stripe_subscription_id = ? WHERE id = ?",
                    (plan, sub_id, int(user_id)),
                )
                conn.commit()

    elif event["type"] in ("customer.subscription.deleted", "customer.subscription.paused"):
        sub = event["data"]["object"]
        with get_db() as conn:
            conn.execute(
                "UPDATE users SET plan = 'free', stripe_subscription_id = NULL "
                "WHERE stripe_subscription_id = ?",
                (sub["id"],),
            )
            conn.commit()

    elif event["type"] == "customer.subscription.updated":
        # プラン変更（例: light → premium）
        sub      = event["data"]["object"]
        price_id = sub["items"]["data"][0]["price"]["id"]
        new_plan = next(
            (p for p, pid in STRIPE_PRICE_IDS.items() if pid == price_id), None
        )
        if new_plan:
            with get_db() as conn:
                conn.execute(
                    "UPDATE users SET plan = ? WHERE stripe_subscription_id = ?",
                    (new_plan, sub["id"]),
                )
                conn.commit()

    return "", 200


@app.route("/payment/success")
def payment_success():
    return send_from_directory("public", "payment_success.html")


# ── Admin (テスト用) ───────────────────────────────────────────────────────────

@app.route("/api/admin/upgrade", methods=["POST"])
def admin_upgrade():
    """テスト用: メールアドレスを指定してプランを変更する。
    本番では SECRET_KEY を強力なものに設定すること。"""
    data       = request.json or {}
    secret     = data.get("secret", "")
    email      = data.get("email", "").strip().lower()
    plan       = data.get("plan", "paid")

    if secret != app.secret_key:
        return jsonify({"error": "Unauthorized"}), 403
    if plan not in ("free", "premium"):
        return jsonify({"error": "plan must be 'free' or 'premium'"}), 400

    with get_db() as conn:
        cur = conn.execute("UPDATE users SET plan = ? WHERE email = ?", (plan, email))
        conn.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "User not found"}), 404
    return jsonify({"ok": True, "email": email, "plan": plan})


ADMIN_EMAILS = set(
    e.strip().lower()
    for e in os.environ.get("ADMIN_EMAILS", "").split(",")
    if e.strip()
)

def is_admin(user_dict):
    email = (user_dict.get("email") or "").lower()
    return email in ADMIN_EMAILS

@app.route("/api/dev/switch-plan", methods=["POST"])
def dev_switch_plan():
    """テスト用: ログイン中ユーザー自身のプランを切替。
    ADMIN_EMAILS に登録されたメアドのみ使用可能。"""
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401
    user_dict = _row_to_dict(user)
    if not is_admin(user_dict):
        return jsonify({"error": "forbidden"}), 403
    data = request.json or {}
    plan = data.get("plan", "free")
    if plan not in ("free", "light", "premium"):
        return jsonify({"error": "plan must be free | light | premium"}), 400
    with get_db() as conn:
        conn.execute("UPDATE users SET plan = ?, usage_count = 0 WHERE id = ?",
                     (plan, user_dict["id"]))
        conn.commit()
    return jsonify({"ok": True, "plan": plan})


@app.route("/api/dev/is-admin")
def dev_is_admin():
    """フロントが管理者UIを出すかどうかの判定用"""
    user = get_current_user()
    if not user:
        return jsonify({"is_admin": False})
    return jsonify({"is_admin": is_admin(_row_to_dict(user))})


# ── API: speech correction ─────────────────────────────────────────────────────

@app.route("/api/correct", methods=["POST"])
def correct():
    if not get_current_user():
        return jsonify({"error": "not_logged_in"}), 401

    data = request.json or {}
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"corrected": text})

    try:
        response = get_gemini().models.generate_content(
            model="models/gemini-2.0-flash",
            contents=(
                "Fix obvious transcription errors (wrong homophones, misheard words, missing words) "
                "in the English text. Preserve the speaker's meaning and natural speaking style. "
                f"Return only the corrected English text, nothing else. No explanation, no quotes.\n\n{text}"
            ),
        )
        return jsonify({"corrected": response.text.strip()})
    except Exception:
        return jsonify({"corrected": text})


# ── API: TTS (OpenAI) ─────────────────────────────────────────────────────────

_openai_client = None

def get_openai():
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
    return _openai_client


# ── Google Cloud TTS ───────────────────────────────────────────────────────────

GOOGLE_TTS_API_KEY = os.environ.get("GOOGLE_TTS_API_KEY", "")
CHIRP3_VOICES = {c["voice_id"] for c in CHARACTERS.values()}

def _tts_text_hash(text: str, voice_id: str) -> str:
    import hashlib
    return hashlib.sha256(f"{voice_id}|{text}".encode("utf-8")).hexdigest()

def _tts_cache_get(text: str, voice_id: str):
    text_hash = _tts_text_hash(text, voice_id)
    with get_db() as conn:
        row = conn.execute(
            "SELECT audio_blob FROM tts_cache WHERE text_hash = ? AND voice_id = ?",
            (text_hash, voice_id)
        ).fetchone()
        if row:
            # ヒット数を更新
            conn.execute(
                "UPDATE tts_cache SET hit_count = hit_count + 1 WHERE text_hash = ? AND voice_id = ?",
                (text_hash, voice_id)
            )
            conn.commit()
            return bytes(row["audio_blob"]) if hasattr(row, "keys") else bytes(row[0])
    return None

def _tts_cache_set(text: str, voice_id: str, audio: bytes):
    text_hash = _tts_text_hash(text, voice_id)
    try:
        with get_db() as conn:
            if DATABASE_URL:
                conn.execute(
                    "INSERT INTO tts_cache (text_hash, voice_id, audio_blob) VALUES (?, ?, ?) ON CONFLICT (text_hash, voice_id) DO NOTHING",
                    (text_hash, voice_id, audio)
                )
            else:
                conn.execute(
                    "INSERT OR IGNORE INTO tts_cache (text_hash, voice_id, audio_blob) VALUES (?, ?, ?)",
                    (text_hash, voice_id, audio)
                )
            conn.commit()
    except Exception:
        pass  # キャッシュ失敗はサイレント

def _synthesize_chirp3(text: str, voice_id: str) -> bytes:
    """Google Cloud TTS Chirp 3 HD を呼んでMP3バイナリを返す。"""
    import urllib.request, urllib.error, json, base64
    if not GOOGLE_TTS_API_KEY:
        raise RuntimeError("GOOGLE_TTS_API_KEY not set")
    url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={GOOGLE_TTS_API_KEY}"
    body = {
        "input": {"text": text},
        "voice": {"languageCode": "en-US", "name": voice_id},
        "audioConfig": {"audioEncoding": "MP3", "speakingRate": 0.95},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    res = urllib.request.urlopen(req, timeout=20)
    data = json.loads(res.read())
    return base64.b64decode(data["audioContent"])


@app.route("/api/tts", methods=["POST"])
def tts():
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401

    data         = request.json or {}
    text         = (data.get("text") or "").strip()
    user_dict    = _row_to_dict(user)
    character_id = data.get("character") or user_dict.get("chosen_character") or "milk"

    if not text:
        return jsonify({"error": "no text"}), 400

    # キャラクター取得 + プラン判定
    char = get_character(character_id)
    if char["plan_required"] == "paid" and (user_dict.get("plan") or "free") == "free":
        # 無料ユーザーが有料キャラを指定 → ミルクに強制
        char = get_character("milk")

    voice_id = char["voice_id"]

    # キャッシュチェック
    cached = _tts_cache_get(text, voice_id)
    from flask import Response
    if cached is not None:
        return Response(cached, mimetype="audio/mpeg",
                        headers={"X-TTS-Cache": "hit", "X-TTS-Voice": voice_id})

    # 新規生成
    try:
        audio = _synthesize_chirp3(text, voice_id)
        _tts_cache_set(text, voice_id, audio)
        return Response(audio, mimetype="audio/mpeg",
                        headers={"X-TTS-Cache": "miss", "X-TTS-Voice": voice_id})
    except Exception as e:
        return jsonify({"error": f"TTS失敗: {e}"}), 500


# ── API: transcribe ────────────────────────────────────────────────────────────

@app.route("/api/transcribe", methods=["POST"])
def transcribe():
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401

    audio_file = request.files.get("audio")
    if not audio_file:
        return jsonify({"error": "No audio"}), 400

    nickname = request.form.get("nickname", "").strip()
    hints = ["TOEIC", "TOEFL", "IELTS", "Fukuoka", "Tokyo", "Osaka", "Sushiro", "Nintendo", "Sony"]
    if nickname:
        hints.insert(0, nickname)
    prompt = ", ".join(hints)

    try:
        import io
        audio_bytes = audio_file.read()
        filename = audio_file.filename or "audio.webm"
        content_type = audio_file.content_type or "audio/webm"
        audio_io = io.BytesIO(audio_bytes)

        result = get_groq().audio.transcriptions.create(
            file=(filename, audio_io, content_type),
            model="whisper-large-v3-turbo",
            language="en",
            prompt=prompt,
            response_format="verbose_json",
        )
        text = result.text.strip() if result.text else ""

        # Calculate pronunciation score from segments
        score = None
        segments = getattr(result, "segments", None) or []
        if segments and text:
            avg_logprobs = [s.get("avg_logprob", 0) for s in segments if isinstance(s, dict)]
            no_speech_probs = [s.get("no_speech_prob", 0) for s in segments if isinstance(s, dict)]
            if avg_logprobs:
                mean_logprob = sum(avg_logprobs) / len(avg_logprobs)
                mean_no_speech = sum(no_speech_probs) / len(no_speech_probs) if no_speech_probs else 0
                # Score: avg_logprob closer to 0 = better, no_speech_prob lower = better
                # avg_logprob range: typically -0.1 (great) to -1.0+ (poor)
                if mean_logprob >= -0.2 and mean_no_speech < 0.1:
                    grade, message, color = "A", "クリアに聞き取れました！", "#27ae60"
                elif mean_logprob >= -0.4 and mean_no_speech < 0.2:
                    grade, message, color = "B", "ほぼ聞き取れています", "#2980b9"
                elif mean_logprob >= -0.6 and mean_no_speech < 0.4:
                    grade, message, color = "C", "少し聞き取りにくいです", "#e67e22"
                else:
                    grade, message, color = "D", "聞き取れませんでした", "#e74c3c"
                score = {"grade": grade, "message": message, "color": color}

        return jsonify({"text": text, "score": score})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── API: hint ──────────────────────────────────────────────────────────────────

@app.route("/api/hint", methods=["POST"])
def hint():
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401

    data       = request.json or {}
    messages   = data.get("messages", [])
    theme      = data.get("theme", "daily")
    difficulty = data.get("difficulty", "intermediate")
    nickname   = data.get("nickname", "").strip()

    if not messages:
        return jsonify({"hints": []}), 200

    level_desc = {"beginner": "very simple (A1-A2)", "intermediate": "natural (B1-B2)", "advanced": "sophisticated (C1)"}.get(difficulty, "natural (B1-B2)")
    last_ai = next((m["content"] for m in reversed(messages) if m["role"] == "assistant"), "")

    system = (
        "You are a helpful English conversation coach. "
        "Given the conversation so far, suggest exactly 3 short English responses the learner could say next. "
        f"Keep each response {level_desc} level. "
        "Each response should be a complete natural sentence, 5-15 words. "
        'Return ONLY valid JSON: {"hints": ["...", "...", "..."]}'
    )
    groq_messages = [{"role": "system", "content": system}]
    for m in messages[-6:]:
        groq_messages.append({"role": m["role"], "content": m["content"]})
    groq_messages.append({"role": "user", "content": "Suggest 3 responses I could say next. Return JSON only."})

    try:
        resp = get_groq().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=groq_messages,
            max_tokens=200,
            response_format={"type": "json_object"},
        )
        import json as _json
        parsed = _json.loads(resp.choices[0].message.content)
        hints = parsed.get("hints", [])[:3]
        return jsonify({"hints": hints})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── API: chat ──────────────────────────────────────────────────────────────────

@app.route("/api/chat", methods=["POST"])
def chat():
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401

    user = reset_usage_if_needed(user)
    limit = get_limit(user["plan"])

    if limit is not None and user["usage_count"] >= limit:
        return jsonify({
            "error": f"今月の boba を使い切りました（{limit} / {limit}）。上位プランでもっと話せます🧋",
            "limit_reached": True,
        }), 429

    data         = request.json or {}
    messages     = data.get("messages", [])
    theme        = data.get("theme", "daily")
    difficulty   = data.get("difficulty", "intermediate")
    nickname     = data.get("nickname", "").strip()
    user_dict    = _row_to_dict(user)
    character_id = data.get("character") or user_dict.get("chosen_character") or "milk"
    # 無料ユーザーは有料キャラを選んでも milk にフォールバック
    char = get_character(character_id)
    if char["plan_required"] == "paid" and (user_dict.get("plan") or "free") == "free":
        character_id = "milk"

    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    try:
        groq_messages = [{"role": "system", "content": build_system_prompt(theme, difficulty, nickname, character_id)}]
        for m in messages[-10:]:  # 直近10件（5往復）のみ送信
            groq_messages.append({"role": m["role"], "content": m["content"]})

        def call_groq(with_json_format: bool):
            kwargs = dict(model="llama-3.3-70b-versatile", messages=groq_messages, max_tokens=1024)
            if with_json_format:
                kwargs["response_format"] = {"type": "json_object"}
            return get_groq().chat.completions.create(**kwargs)

        # json_validate_failed 時は response_format なしでリトライ
        try:
            response = call_groq(with_json_format=True)
        except Exception as e:
            err = str(e)
            # failed_generation が含まれる場合はそれをパースして使う
            if "json_validate_failed" in err or "failed_generation" in err:
                import re as _re
                m = _re.search(r"'failed_generation':\s*'(.*?)'(?:\s*}|\s*,)", err, _re.DOTALL)
                if m:
                    try:
                        fg = m.group(1).encode().decode("unicode_escape")
                        response = type("R", (), {"choices": [type("C", (), {"message": type("M", (), {"content": fg})()})()]})()
                    except Exception:
                        response = call_groq(with_json_format=False)
                else:
                    response = call_groq(with_json_format=False)
            else:
                raise

        text = response.choices[0].message.content
        try:
            result = json.loads(text)
        except json.JSONDecodeError:
            result = {"english": text, "japanese_translation": "", "correction": None, "expression_tip": None}

        # 新フィールドのデフォルト保証
        result.setdefault("naturalness", "natural")
        result.setdefault("natural_alternatives", [])
        result.setdefault("mistake_type", None)
        result.setdefault("corrected_english", None)

        # ユーザーの直前メッセージ（評価対象）を取得
        last_user_msg = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                last_user_msg = (m.get("content") or "").strip()
                break

        # ミスがあれば mistake_log に保存（苦手TOP3用）
        if result.get("naturalness") == "has_errors" and result.get("mistake_type"):
            try:
                with get_db() as conn:
                    conn.execute(
                        "INSERT INTO mistake_log (user_id, mistake_type, original_text, corrected_text) VALUES (?, ?, ?, ?)",
                        (user["id"], result["mistake_type"], last_user_msg[:500],
                         (result.get("corrected_english") or "")[:500])
                    )
                    conn.commit()
            except Exception:
                pass

        # usage_count・テーマ進捗・ストリーク更新
        is_new_session = len(messages) == 1  # 最初のメッセージ = 新セッション
        with get_db() as conn:
            conn.execute("UPDATE users SET usage_count = usage_count + 1 WHERE id = ?", (user["id"],))
            conn.execute("""
                INSERT INTO theme_progress (user_id, theme, session_count, message_count)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(user_id, theme) DO UPDATE SET
                    session_count = session_count + ?,
                    message_count = message_count + 1
            """, (user["id"], theme, 1 if is_new_session else 0, 1 if is_new_session else 0))
            conn.commit()

        streak, streak_updated = update_streak(user["id"])

        new_count = user["usage_count"] + 1
        result["usage"] = {
            "count":     new_count,
            "limit":     limit,
            "remaining": None if limit is None else max(0, limit - new_count),
            "plan":      user["plan"],
        }
        result["streak"]         = streak
        result["streak_updated"] = streak_updated
        result["character"]      = character_id
        return jsonify(result)

    except Exception as e:
        msg = str(e)
        if "429" in msg or "rate_limit" in msg.lower():
            return jsonify({"error": "APIのリクエスト上限に達しました。しばらく待ってから再試行してください。"}), 429
        return jsonify({"error": msg}), 500



# ── API: theme progress ───────────────────────────────────────────────────────

THEMES = ["daily", "travel", "business", "hobbies", "food", "movies"]

MISTAKE_TYPE_LABELS = {
    "tense":            "時制",
    "subject_verb":     "主語・動詞の一致",
    "article":          "冠詞 (a/an/the)",
    "preposition":      "前置詞",
    "word_order":       "語順",
    "countable":        "可算/不可算",
    "gerund_infinitive": "動名詞/不定詞",
    "relative":         "関係代名詞",
    "plural":           "単複",
    "spelling":         "スペリング",
    "other":            "その他",
}

@app.route("/api/mistakes/top")
def mistakes_top():
    """直近30日の苦手分野TOP集計"""
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401

    with get_db() as conn:
        if DATABASE_URL:
            rows = conn.execute("""
                SELECT mistake_type, COUNT(*) AS cnt
                FROM mistake_log
                WHERE user_id = ?
                  AND created_at >= NOW() - INTERVAL '30 days'
                GROUP BY mistake_type
                ORDER BY cnt DESC
                LIMIT 5
            """, (user["id"],)).fetchall()
        else:
            rows = conn.execute("""
                SELECT mistake_type, COUNT(*) AS cnt
                FROM mistake_log
                WHERE user_id = ?
                  AND created_at >= datetime('now', '-30 days')
                GROUP BY mistake_type
                ORDER BY cnt DESC
                LIMIT 5
            """, (user["id"],)).fetchall()

    total = 0
    out = []
    for r in rows:
        t = r["mistake_type"]
        c = r["cnt"]
        total += c
        out.append({
            "type":  t,
            "label": MISTAKE_TYPE_LABELS.get(t, t),
            "count": c,
        })
    return jsonify({"top": out, "total": total})


@app.route("/api/progress")
def get_progress():
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401

    with get_db() as conn:
        rows = conn.execute(
            "SELECT theme, session_count, message_count FROM theme_progress WHERE user_id = ?",
            (user["id"],)
        ).fetchall()

    data = {r["theme"]: {"sessions": r["session_count"], "messages": r["message_count"]} for r in rows}
    result = []
    for t in THEMES:
        d = data.get(t, {"sessions": 0, "messages": 0})
        result.append({"theme": t, "sessions": d["sessions"], "messages": d["messages"]})
    return jsonify({"progress": result})


# ── API: daily challenge ──────────────────────────────────────────────────────

_daily_cache: dict = {}  # { "YYYY-MM-DD": {expression, japanese, hint, example} }

# 日本語文字を含むか確認
def _has_japanese(text: str) -> bool:
    import re
    return bool(re.search(r'[\u3040-\u30ff\u4e00-\u9fff]', text or ""))

DAILY_FALLBACKS = [
    {"expression": "That makes sense.",         "japanese": "なるほど、わかります。",       "hint": "相手の話に納得したとき",   "example": "Oh, that makes sense. I understand now."},
    {"expression": "Could you say that again?", "japanese": "もう一度言ってもらえますか？", "hint": "聞き返したいとき",         "example": "Sorry, could you say that again? I missed it."},
    {"expression": "I'm looking forward to it.","japanese": "楽しみにしています。",         "hint": "予定を楽しみにするとき",   "example": "The trip sounds amazing. I'm looking forward to it!"},
    {"expression": "What do you think?",        "japanese": "どう思いますか？",             "hint": "相手の意見を聞くとき",     "example": "I'm not sure which to choose. What do you think?"},
    {"expression": "It depends.",               "japanese": "場合によります。",             "hint": "一概に言えないとき",       "example": "Do you prefer coffee or tea? It depends on the situation."},
    {"expression": "See you soon.",             "japanese": "またすぐ会いましょう。",       "hint": "別れ際の挨拶",             "example": "It was great seeing you. See you soon!"},
    {"expression": "Let me think about it.",    "japanese": "少し考えさせてください。",     "hint": "即答を避けたいとき",       "example": "That's an interesting offer. Let me think about it."},
    {"expression": "I had a great time.",       "japanese": "とても楽しかったです。",       "hint": "楽しい時間の後に",         "example": "Thank you for the dinner. I had a great time!"},
    {"expression": "Could you help me?",        "japanese": "手伝ってもらえますか？",       "hint": "助けを求めるとき",         "example": "Excuse me, could you help me find this place?"},
    {"expression": "No worries.",               "japanese": "大丈夫ですよ。",               "hint": "気にしないでと伝えるとき", "example": "Sorry I'm late! No worries, we just started."},
    {"expression": "How's it going?",           "japanese": "調子はどうですか？",           "hint": "カジュアルな挨拶",         "example": "Hey! How's it going? Haven't seen you in a while."},
    {"expression": "I'm not sure.",             "japanese": "よくわかりません。",           "hint": "確信がないとき",           "example": "I'm not sure about the schedule. Let me check."},
    {"expression": "That sounds great!",        "japanese": "それは素晴らしい！",           "hint": "提案に賛成するとき",       "example": "Let's go to the new Italian place. That sounds great!"},
    {"expression": "Take your time.",           "japanese": "ゆっくりどうぞ。",             "hint": "急がせないとき",           "example": "Don't rush. Take your time, I'll wait."},
]

@app.route("/api/daily-challenge")
def daily_challenge():
    if not get_current_user():
        return jsonify({"error": "not_logged_in"}), 401

    today = date.today().isoformat()
    if today in _daily_cache:
        return jsonify(_daily_cache[today])

    def _fallback():
        import hashlib
        idx = int(hashlib.md5(today.encode()).hexdigest(), 16) % len(DAILY_FALLBACKS)
        return DAILY_FALLBACKS[idx]

    try:
        resp = get_groq().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": (
                    "You are an English learning assistant for Japanese learners. "
                    "Generate ONE useful, natural English expression for daily conversation practice. "
                    "Return ONLY valid JSON with these exact keys: expression, japanese, hint, example.\n"
                    "expression: English phrase (2-7 words)\n"
                    "japanese: Japanese translation (must be proper Japanese, 5-20 chars)\n"
                    "hint: When to use it in Japanese (10-25 chars, must be proper Japanese)\n"
                    "example: One natural English sentence using the expression"
                )},
                {"role": "user", "content": f"Today is {today}. Generate today's expression."},
            ],
            max_tokens=300,
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content)
        # 日本語フィールドが正しく生成されているか検証
        if not (_has_japanese(data.get("japanese", "")) and _has_japanese(data.get("hint", ""))):
            data = _fallback()
    except Exception:
        data = _fallback()

    _daily_cache[today] = data
    return jsonify(data)


# ── API: review cards ──────────────────────────────────────────────────────────

@app.route("/api/review", methods=["POST"])
def review():
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401

    data     = request.json or {}
    messages = data.get("messages", [])

    user_msgs = [m["content"] for m in messages if m.get("role") == "user"]
    if len(user_msgs) < 2:
        return jsonify({"cards": []})

    conversation_text = "\n".join(
        f"{'User' if m['role'] == 'user' else 'AI'}: {m['content']}"
        for m in messages if m.get("role") in ("user", "assistant")
    )

    system_prompt = """You are an English learning assistant. Analyze the conversation and extract 1-3 useful English expressions or phrases that the learner used or encountered.

For each expression, provide:
- "expression": the English phrase (short, 2-8 words)
- "japanese": Japanese translation
- "hint": one short Japanese sentence explaining when/how to use it (under 30 chars)
- "example": one natural example English sentence using the expression

Return ONLY valid JSON in this format:
{"cards": [{"expression": "...", "japanese": "...", "hint": "...", "example": "..."}]}

Rules:
- Pick expressions that are genuinely useful in daily conversation
- Prefer phrases the user actually said or that appeared in AI responses
- Maximum 3 cards
- If the conversation is too short, return {"cards": []}"""

    try:
        response = get_groq().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": f"Conversation:\n{conversation_text}"},
            ],
            max_tokens=512,
            response_format={"type": "json_object"},
        )
        text = response.choices[0].message.content
        result = json.loads(text)
        return jsonify({"cards": result.get("cards", [])})
    except Exception:
        return jsonify({"cards": []})


# ── Feedback ───────────────────────────────────────────────────────────────────

@app.route("/api/feedback", methods=["POST"])
def submit_feedback():
    user = get_current_user()
    data    = request.json or {}
    rating  = data.get("rating")
    comment = data.get("comment", "").strip()
    if rating not in (1, 2, 3, 4, 5):
        return jsonify({"error": "rating must be 1-5"}), 400
    with get_db() as conn:
        conn.execute(
            "INSERT INTO feedbacks (user_id, rating, comment) VALUES (?, ?, ?)",
            (user["id"] if user else None, rating, comment or None),
        )
        conn.commit()
    return jsonify({"ok": True})


# ── Web Push ───────────────────────────────────────────────────────────────────

@app.route("/api/push/vapid-public-key")
def push_vapid_public_key():
    return jsonify({"publicKey": VAPID_PUBLIC_KEY})


@app.route("/api/push/subscribe", methods=["POST"])
def push_subscribe():
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401
    data     = request.json or {}
    endpoint = data.get("endpoint", "")
    p256dh   = data.get("keys", {}).get("p256dh", "")
    auth     = data.get("keys", {}).get("auth", "")
    if not (endpoint and p256dh and auth):
        return jsonify({"error": "invalid subscription"}), 400
    with get_db() as conn:
        conn.execute(
            """INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth""",
            (user["id"], endpoint, p256dh, auth),
        )
        conn.commit()
    return jsonify({"ok": True})


@app.route("/api/push/unsubscribe", methods=["POST"])
def push_unsubscribe():
    user = get_current_user()
    if not user:
        return jsonify({"error": "not_logged_in"}), 401
    data     = request.json or {}
    endpoint = data.get("endpoint", "")
    with get_db() as conn:
        conn.execute("DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?", (user["id"], endpoint))
        conn.commit()
    return jsonify({"ok": True})


def send_push(subscription_row, title, body):
    """1件のサブスクリプションにpushを送る。失敗した購読は削除する。"""
    if not VAPID_PRIVATE_KEY:
        return
    try:
        webpush(
            subscription_info={
                "endpoint": subscription_row["endpoint"],
                "keys": {"p256dh": subscription_row["p256dh"], "auth": subscription_row["auth"]},
            },
            data=json.dumps({"title": title, "body": body}),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=VAPID_CLAIMS,
        )
    except WebPushException as e:
        status = e.response.status_code if e.response else 0
        if status in (404, 410):
            with get_db() as conn:
                conn.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (subscription_row["endpoint"],))
                conn.commit()


@app.route("/api/push/send-daily", methods=["POST"])
def push_send_daily():
    """デイリーチャレンジ通知を全購読者に送る（cronまたは管理用）"""
    secret = request.headers.get("X-Admin-Secret", "")
    if secret != app.secret_key:
        return jsonify({"error": "Unauthorized"}), 403
    with get_db() as conn:
        subs = conn.execute("SELECT * FROM push_subscriptions").fetchall()
    sent = 0
    for sub in subs:
        send_push(sub, "☀️ 今日の英語チャレンジ", "TalkBobaで今日も一会話しよう！")
        sent += 1
    return jsonify({"ok": True, "sent": sent})


# ── Start ──────────────────────────────────────────────────────────────────────

init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    debug = os.environ.get("FLASK_ENV") == "development"
    app.run(debug=debug, host="0.0.0.0", port=port)
