import os
import json
import re
import sqlite3
import contextlib
from datetime import date, timedelta
from flask import Flask, request, jsonify, send_from_directory, session
from werkzeug.security import generate_password_hash, check_password_hash
from google import genai
from google.genai import types as gtypes
import stripe

app = Flask(__name__, static_folder="public")
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")
app.config["SESSION_PERMANENT"] = True
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)

_gemini_client = None

def get_gemini():
    global _gemini_client
    if _gemini_client is None:
        _gemini_client = genai.Client(api_key=os.environ.get("GOOGLE_API_KEY", ""))
    return _gemini_client

# ── Stripe ─────────────────────────────────────────────────────────────────────
stripe.api_key             = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET      = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_IDS = {
    "light":   os.environ.get("STRIPE_LIGHT_PRICE_ID", ""),
    "premium": os.environ.get("STRIPE_PREMIUM_PRICE_ID", ""),
}

DATABASE_URL = os.environ.get("DATABASE_URL", "")
DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")

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
LIGHT_MONTHLY_LIMIT    = 600

# ── Conversation settings ──────────────────────────────────────────────────────

THEME_CONTEXTS = {
    "daily":    "everyday topics like weather, weekend plans, family, and daily routines",
    "travel":   "travel, destinations, transportation, hotels, sightseeing, and cultural experiences",
    "business": "business topics like meetings, presentations, emails, negotiations, and workplace situations",
    "hobbies":  "hobbies, sports, entertainment, games, movies, music, and leisure activities",
    "food":     "food, cooking, restaurants, recipes, and dining experiences",
    "movies":   "movies, TV shows, music, books, and pop culture",
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

def build_system_prompt(theme="daily", difficulty="intermediate"):
    theme_ctx = THEME_CONTEXTS.get(theme, THEME_CONTEXTS["daily"])
    diff_inst = DIFFICULTY_INSTRUCTIONS.get(difficulty, DIFFICULTY_INSTRUCTIONS["intermediate"])
    return f"""You are a friendly English conversation partner and teacher. Focus on {theme_ctx}.

Difficulty level:
{diff_inst}

Always respond in the following JSON format:
{{
  "english": "Your English response here",
  "japanese_translation": "日本語訳をここに書く",
  "corrected_input": "If the user's message contains obvious speech recognition errors (wrong homophones, misheard words), write the corrected version in English. Otherwise null.",
  "correction": "If the user made a grammar mistake, write the correction and a brief explanation in Japanese. Otherwise null.",
  "expression_tip": "If there is an interesting expression worth explaining, write a brief explanation in Japanese. Otherwise null."
}}

Important: Always return valid JSON only, no other text."""


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
        conn.commit()
    # マイグレーション: 既存 DB に Stripe カラムがなければ追加
    with get_db() as conn:
        for col_def in ("stripe_customer_id TEXT", "stripe_subscription_id TEXT"):
            try:
                conn.execute(f"ALTER TABLE users ADD COLUMN {col_def}")
                conn.commit()
            except Exception:
                pass  # すでに存在する

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

def get_limit(plan):
    if plan == "premium":
        return None             # 無制限
    if plan == "light":
        return LIGHT_MONTHLY_LIMIT
    return FREE_MONTHLY_LIMIT

def user_to_dict(user):
    limit = get_limit(user["plan"])
    return {
        "email":       user["email"],
        "plan":        user["plan"],
        "usage_count": user["usage_count"],
        "limit":       limit,  # None = 無制限
        "remaining":   None if limit is None else max(0, limit - user["usage_count"]),
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

@app.route("/api/register", methods=["POST"])
def register():
    data     = request.json or {}
    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"error": "メールアドレスとパスワードを入力してください"}), 400
    if len(password) < 6:
        return jsonify({"error": "パスワードは6文字以上にしてください"}), 400

    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                (email, generate_password_hash(password, method="pbkdf2:sha256")),
            )
            conn.commit()
            user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        session.permanent = True
        session["user_id"] = user["id"]
        return jsonify({"ok": True, **user_to_dict(user)})
    except Exception as e:
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            return jsonify({"error": "このメールアドレスは既に登録されています"}), 409
        raise


@app.route("/api/login", methods=["POST"])
def login():
    data     = request.json or {}
    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")

    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "メールアドレスまたはパスワードが違います"}), 401

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
    return jsonify(user_to_dict(user))


# ── Static pages ───────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("public", "index.html")

@app.route("/auth")
def auth_page():
    return send_from_directory("public", "auth.html")

@app.route("/plans")
def plans_page():
    return send_from_directory("public", "plans.html")

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

    # Stripe カスタマーを取得 or 作成
    customer_id = user["stripe_customer_id"]
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
            "error": f"今月の無料枠（{limit}回）を使い切りました。プレミアムプランで無制限に練習できます。",
            "limit_reached": True,
        }), 429

    data       = request.json or {}
    messages   = data.get("messages", [])
    theme      = data.get("theme", "daily")
    difficulty = data.get("difficulty", "intermediate")

    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    try:
        # Anthropic 形式 → Gemini 形式に変換
        # {"role": "user"/"assistant", "content": "..."}
        # → {"role": "user"/"model", "parts": [{"text": "..."}]}
        contents = [
            gtypes.Content(
                role="model" if m["role"] == "assistant" else "user",
                parts=[gtypes.Part(text=m["content"])],
            )
            for m in messages
        ]

        response = get_gemini().models.generate_content(
            model="models/gemini-2.0-flash",
            contents=contents,
            config=gtypes.GenerateContentConfig(
                system_instruction=build_system_prompt(theme, difficulty),
                max_output_tokens=1024,
            ),
        )

        text = response.text
        text = re.sub(r"^```(?:json)?\s*", "", text.strip())
        text = re.sub(r"\s*```$", "", text.strip())

        try:
            result = json.loads(text)
        except json.JSONDecodeError:
            result = {"english": text, "japanese_translation": "", "correction": None, "expression_tip": None}

        # Increment usage count
        with get_db() as conn:
            conn.execute("UPDATE users SET usage_count = usage_count + 1 WHERE id = ?", (user["id"],))
            conn.commit()

        new_count = user["usage_count"] + 1
        result["usage"] = {
            "count":     new_count,
            "limit":     limit,
            "remaining": None if limit is None else max(0, limit - new_count),
        }
        return jsonify(result)

    except Exception as e:
        msg = str(e)
        if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
            return jsonify({"error": "APIのリクエスト上限に達しました。しばらく待ってから再試行してください。"}), 429
        return jsonify({"error": msg}), 500


# ── Start ──────────────────────────────────────────────────────────────────────

init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    debug = os.environ.get("FLASK_ENV") == "development"
    app.run(debug=debug, host="0.0.0.0", port=port)
