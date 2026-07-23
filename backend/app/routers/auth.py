import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.schemas import (
    UserCreate, UserOut, Token, ProfileOut, ProfileUpdate, PasswordChange,
)
from app.services.auth import hash_password, verify_password, create_access_token, get_current_user
from app.services.ocr import save_upload

router = APIRouter(prefix="/api/auth", tags=["auth"])

AVATAR_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}
AVATAR_MAX_BYTES = 4 * 1024 * 1024          # 4 MB
LANGUAGES = {"en", "tr"}


def _profile(user: User) -> dict:
    """Serialize a User as its own profile, resolving the avatar to a URL.

    The URL is the capability form (see User.avatar_token) rather than a route
    guarded by get_current_user, because an <img> tag sends no auth header.
    """
    data = {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "username": user.username,
        "role": user.role,
        "language": user.language or "en",
        "created_at": user.created_at,
        "avatar_url": None,
    }
    if user.avatar_path and user.avatar_token:
        data["avatar_url"] = f"/api/auth/avatar/{user.avatar_token}"
    return data


@router.post("/register", response_model=UserOut, status_code=201)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(400, "Bu e-posta zaten kayıtlı")
    user = User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # Members can sign in with either their email or their username.
    user = (
        db.query(User)
        .filter((User.email == form.username) | (User.username == form.username))
        .first()
    )
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Hatalı e-posta veya şifre")
    if user.is_active is False:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Hesap devre dışı")
    token = create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=ProfileOut)
def me(current_user: User = Depends(get_current_user)):
    return _profile(current_user)


@router.patch("/me", response_model=ProfileOut)
def update_me(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Self-service profile edit.

    Deliberately narrower than PATCH /api/members/{id}: `role` and `is_active`
    are NOT settable here, so a standard user cannot promote themselves to admin
    or reactivate a disabled account by editing their own profile.
    """
    data = payload.model_dump(exclude_unset=True)

    if data.get("username") and data["username"] != current_user.username:
        clash = (
            db.query(User)
            .filter(User.username == data["username"], User.id != current_user.id)
            .first()
        )
        if clash:
            raise HTTPException(400, "Bu kullanıcı adı zaten kayıtlı")
        current_user.username = data["username"]

    if data.get("email") and data["email"] != current_user.email:
        clash = (
            db.query(User)
            .filter(User.email == data["email"], User.id != current_user.id)
            .first()
        )
        if clash:
            raise HTTPException(400, "Bu e-posta zaten kayıtlı")
        current_user.email = data["email"]

    if "full_name" in data:
        current_user.full_name = data["full_name"]

    if data.get("language"):
        if data["language"] not in LANGUAGES:
            raise HTTPException(400, f"Desteklenen diller: {', '.join(sorted(LANGUAGES))}")
        current_user.language = data["language"]

    db.commit()
    db.refresh(current_user)
    return _profile(current_user)


@router.post("/me/password", status_code=200)
def change_password(
    payload: PasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Change your own password, proving you know the current one.

    A valid JWT alone is not accepted as proof: it would let anyone who finds an
    unlocked session lock the real owner out of their account.
    """
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(400, "Mevcut şifre hatalı")
    if len(payload.new_password or "") < 6:
        raise HTTPException(400, "Yeni şifre en az 6 karakter olmalı")
    if verify_password(payload.new_password, current_user.hashed_password):
        raise HTTPException(400, "Yeni şifre mevcut şifreyle aynı olamaz")

    current_user.hashed_password = hash_password(payload.new_password)
    db.commit()
    # The JWT carries only `sub`, so existing tokens stay valid — changing the
    # password does NOT sign other devices out. Surfaced here so the frontend can
    # say so rather than implying a global logout.
    return {"ok": True, "sessions_invalidated": False}


# ── Avatar ────────────────────────────────────────────────────────────────────

@router.post("/me/avatar", response_model=ProfileOut)
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in AVATAR_EXTS:
        raise HTTPException(400, f"Desteklenen formatlar: {', '.join(sorted(AVATAR_EXTS)).upper()}")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Dosya boş")
    if len(content) > AVATAR_MAX_BYTES:
        raise HTTPException(400, "Görsel en fazla 4 MB olabilir")

    old_path = current_user.avatar_path
    # New token per upload, so a cached/shared URL for the previous picture dies
    # with it instead of resolving to the replacement.
    token = secrets.token_urlsafe(16)
    path = save_upload(content, f"avatar_{current_user.id}_{token}.{ext}")

    current_user.avatar_path = path
    current_user.avatar_token = token
    db.commit()
    db.refresh(current_user)

    if old_path and old_path != path:
        try:
            Path(old_path).unlink(missing_ok=True)
        except OSError:
            pass                                  # a stale file is not worth a 500

    return _profile(current_user)


@router.delete("/me/avatar", response_model=ProfileOut)
def delete_avatar(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Drop the picture and fall back to initials."""
    old_path = current_user.avatar_path
    current_user.avatar_path = None
    current_user.avatar_token = None
    db.commit()
    db.refresh(current_user)

    if old_path:
        try:
            Path(old_path).unlink(missing_ok=True)
        except OSError:
            pass

    return _profile(current_user)


@router.get("/avatar/{token}")
def get_avatar(token: str, db: Session = Depends(get_db)):
    """Serve a profile picture by capability token — the ONE auth route with no
    get_current_user, for the same reason /api/push/snooze has none: the caller
    is an <img> tag (or the service worker) that cannot attach a Bearer header.
    The token is 16 random bytes and reveals nothing but the picture.
    """
    user = db.query(User).filter(User.avatar_token == token).first()
    if not user or not user.avatar_path or not Path(user.avatar_path).exists():
        raise HTTPException(404, "Profil fotoğrafı bulunamadı")
    return FileResponse(user.avatar_path)
