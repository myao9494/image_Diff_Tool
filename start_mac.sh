#!/usr/bin/env bash
#
# 画像差分ツール (Visual Diff Tool) サーバー起動スクリプト (macOS用)
# - 指定したポートで稼働中の既存のサーバープロセスを終了させる
# - Python仮想環境 (.venv) の正常動作を確認し、破損している場合は再作成する
# - 必要な依存パッケージをインストールし、Backend APIを起動する
#
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8078}"
PIDS="$(lsof -ti tcp:"$PORT" || true)"
if [ -n "$PIDS" ]; then
  echo "Stopping existing server on port $PORT: $PIDS"
  kill $PIDS || true
  sleep 1
  REMAINING_PIDS="$(lsof -ti tcp:"$PORT" || true)"
  if [ -n "$REMAINING_PIDS" ]; then
    echo "Force stopping server on port $PORT: $REMAINING_PIDS"
    kill -9 $REMAINING_PIDS || true
  fi
fi

# .venv が存在していても、Python本体が更新されてリンクが壊れているなどの場合は再作成する
if [ -d ".venv" ]; then
  if ! .venv/bin/python --version >/dev/null 2>&1; then
    echo "Warning: Virtual environment .venv exists but is broken. Recreating..."
    rm -rf .venv
  fi
fi

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install -r requirements.txt
cd backend
../.venv/bin/python run.py
