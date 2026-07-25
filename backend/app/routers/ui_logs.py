import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends

from app.models import User
from app.schemas import UiLogCreate
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/ui-logs", tags=["ui-logs"])

LOG_PATH = Path("/app/logs/ui-messages.log")


@router.post("/", status_code=204)
def write_ui_log(payload: UiLogCreate, current_user: User = Depends(get_current_user)):
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "user_id": current_user.id,
        "username": current_user.username or current_user.email,
        "level": (payload.level or "info")[:32],
        "message": (payload.message or "")[:1000],
        "page": (payload.page or "")[:120],
        "path": (payload.path or "")[:300],
    }
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
