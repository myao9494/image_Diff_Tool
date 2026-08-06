from __future__ import annotations

import os

import uvicorn


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8078"))
    reload_enabled = os.environ.get("VISUAL_DIFF_RELOAD", "0").lower() in {"1", "true", "yes"}
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, reload=reload_enabled)
