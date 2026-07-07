import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.models import User
from app.services.auth import get_current_user
from app.services.bank_import import parse_bank_file, import_transactions, import_investments

router = APIRouter(prefix="/api/import", tags=["import"])


@router.post("/preview")
async def preview_import(
    file: UploadFile = File(...),
    bank: Optional[str] = Form(None),   # "garanti" | "on_burgan" | "auto"
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Dosyayı yükle, parse et, önizleme döndür.
    Kullanıcı gözden geçirip onayladıktan sonra /confirm çağrılır.
    """
    content = await file.read()
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in ("xls", "xlsx", "csv", "pdf"):
        raise HTTPException(400, "Desteklenen formatlar: XLS, XLSX, CSV, PDF")

    result = parse_bank_file(
        content=content,
        filename=filename,
        bank_hint=bank or "auto",
        db=db,
    )
    return result


@router.post("/confirm")
async def confirm_import(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Önizlemeden onaylanan işlemleri veritabanına kaydet.
    payload: { rows: [...], bank: str, skip_duplicates: bool }
    """
    rows = payload.get("rows", [])
    skip_duplicates = payload.get("skip_duplicates", True)

    if not rows:
        raise HTTPException(400, "İçe aktarılacak işlem yok")

    result = import_transactions(
        db=db,
        owner_id=current_user.id,
        rows=rows,
        skip_duplicates=skip_duplicates,
    )
    return result


@router.post("/confirm-investments")
async def confirm_investments(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Midas portföy önizlemesinden onaylanan varlıkları Investment tablosuna yazar.
    payload: { investments: [...], upsert: bool }
    """
    holdings = payload.get("investments", [])
    if not holdings:
        raise HTTPException(400, "İçe aktarılacak yatırım yok")

    return import_investments(
        db=db,
        owner_id=current_user.id,
        holdings=holdings,
        upsert=payload.get("upsert", True),
    )
