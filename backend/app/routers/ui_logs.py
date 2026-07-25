import json
import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends

from app.models import User
from app.schemas import UiLogCreate
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/ui-logs", tags=["ui-logs"])

LOG_PATH = Path("/app/logs/ui-messages.log")
MAX_LOG_BYTES = 10 * 1024 * 1024
BACKUP_COUNT = 5


def _rotated_name(default_name):
    stem, dot, index = default_name.rpartition(".")
    if dot and index.isdigit():
        return f"{stem}.{int(index):02d}"
    return default_name


def _logger():
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("home_ledger.ui_logs")
    if not logger.handlers:
        handler = RotatingFileHandler(
            LOG_PATH,
            maxBytes=MAX_LOG_BYTES,
            backupCount=BACKUP_COUNT,
            encoding="utf-8",
        )
        handler.namer = _rotated_name
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger


@router.post("/", status_code=204)
def write_ui_log(payload: UiLogCreate, current_user: User = Depends(get_current_user)):
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "user_id": current_user.id,
        "username": current_user.username or current_user.email,
        "level": (payload.level or "info")[:32],
        "message": (payload.message or "")[:1000],
        "page": (payload.page or "")[:120],
        "path": (payload.path or "")[:300],
    }
    _logger().info(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
