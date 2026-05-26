#!/bin/bash

# AIに英会話アプリの起動スクリプト

echo "🎙️ AI英会話アプリを起動します..."
echo ""

# .env を読み込む
if [ -f "$(dirname "$0")/.env" ]; then
  export $(grep -v '^#' "$(dirname "$0")/.env" | xargs)
fi

# Check API key
if [ -z "$GROQ_API_KEY" ]; then
  echo "❌ GROQ_API_KEY が設定されていません。"
  echo "  export GROQ_API_KEY='your-api-key-here'"
  echo ""
  exit 1
fi

# Stripe keys (optional for local dev)
if [ -z "$STRIPE_SECRET_KEY" ]; then
  echo "⚠️  STRIPE_SECRET_KEY 未設定 — 決済機能は無効です"
fi

echo "✅ 環境変数を確認しました"
echo "🚀 http://localhost:5000 で起動します..."
echo ""
echo "停止するには Ctrl+C を押してください"
echo ""

# Open browser after short delay
(sleep 1.5 && open http://localhost:8080) &

# Start Flask server
cd "$(dirname "$0")"
python3 app.py
