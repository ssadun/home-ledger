from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.schemas import MemberCreate, MemberUpdate, MemberOut
from app.services.auth import hash_password, get_current_user

router = APIRouter(prefix="/api/members", tags=["members"])


def _to_out(user: User) -> dict:
    """Map a User row to the Members config-item shape."""
    return {
        "id": user.id,
        "name": user.full_name,
        "username": user.username or (user.email.split("@")[0] if user.email else None),
        "role": user.role or "user",
        "active": user.is_active if user.is_active is not None else True,
        "show_as_payer": user.show_as_payer if user.show_as_payer is not None else True,
        "email": user.email,
    }


def _synth_email(username: str) -> str:
    """Members are managed without an email field; derive a stable unique one."""
    return f"{username}@homeledger.app"


def _is_admin(db: Session, user: User) -> bool:
    """Is this member allowed to manage OTHER members?

    Two ways to qualify, and the second one matters:

    1. `role == "admin"` — the explicit grant.
    2. No row in the table has `role == "admin"` at all.

    Rule 2 exists because this household's users all carry `role = "user"`, so a
    strict check would have locked EVERY account out of Configuration → Members
    the moment this guard landed — a regression dressed up as a security fix.
    While no admin has been designated the household stays flat, exactly as it
    behaved before. Set one member to `admin` and the guard tightens by itself,
    with no migration and no code change.
    """
    if (user.role or "") == "admin":
        return True
    return db.query(User).filter(User.role == "admin").first() is None


def _require_manage(db: Session, target: User, current_user: User) -> None:
    """Guard mutations of a member row.

    Until this existed, PATCH /{member_id} took only `get_current_user` and never
    compared it to the row being edited — so ANY signed-in member could rename,
    deactivate, or silently re-hash the password of ANY other member, including
    an admin's. Self-service edits now belong on PATCH /api/auth/me; this screen
    stays the admin path.
    """
    if target.id == current_user.id:
        return
    if _is_admin(db, current_user):
        return
    raise HTTPException(403, "Bu üyeyi düzenleme yetkiniz yok")


@router.get("/", response_model=List[MemberOut])
def list_members(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return [_to_out(u) for u in db.query(User).order_by(User.id).all()]


@router.post("/", response_model=MemberOut, status_code=201)
def create_member(
    payload: MemberCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(400, "Bu kullanıcı adı zaten kayıtlı")
    email = payload.email or _synth_email(payload.username)
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(400, "Bu e-posta zaten kayıtlı")
    user = User(
        email=email,
        full_name=payload.name,
        username=payload.username,
        role=payload.role,
        is_active=payload.active,
        show_as_payer=payload.show_as_payer,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_out(user)


@router.patch("/{member_id}", response_model=MemberOut)
def update_member(
    member_id: int,
    payload: MemberUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = db.query(User).filter(User.id == member_id).first()
    if not user:
        raise HTTPException(404, "Üye bulunamadı")
    _require_manage(db, user, current_user)
    data = payload.model_dump(exclude_unset=True)
    # Only an admin may change role/active — otherwise a standard member editing
    # their own row could promote themselves through this endpoint.
    if not _is_admin(db, current_user):
        data.pop("role", None)
        data.pop("active", None)
    if "username" in data and data["username"] and data["username"] != user.username:
        clash = db.query(User).filter(User.username == data["username"], User.id != member_id).first()
        if clash:
            raise HTTPException(400, "Bu kullanıcı adı zaten kayıtlı")
        user.username = data["username"]
    if "name" in data:
        user.full_name = data["name"]
    if "role" in data and data["role"] is not None:
        user.role = data["role"]
    if "active" in data and data["active"] is not None:
        user.is_active = data["active"]
    if "show_as_payer" in data and data["show_as_payer"] is not None:
        user.show_as_payer = data["show_as_payer"]
    if "email" in data and data["email"]:
        user.email = data["email"]
    if data.get("password"):
        user.hashed_password = hash_password(data["password"])
    db.commit()
    db.refresh(user)
    return _to_out(user)


@router.delete("/{member_id}", status_code=204)
def delete_member(
    member_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = db.query(User).filter(User.id == member_id).first()
    if not user:
        raise HTTPException(404, "Üye bulunamadı")
    if not _is_admin(db, current_user):
        raise HTTPException(403, "Üye silme yetkiniz yok")
    if user.id == current_user.id:
        raise HTTPException(400, "Oturum açmış üyeyi silemezsiniz")
    db.delete(user)
    db.commit()
