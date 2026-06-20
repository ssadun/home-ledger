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
        "email": user.email,
    }


def _synth_email(username: str) -> str:
    """Members are managed without an email field; derive a stable unique one."""
    return f"{username}@hyperledger.app"


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
    data = payload.model_dump(exclude_unset=True)
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
    if user.id == current_user.id:
        raise HTTPException(400, "Oturum açmış üyeyi silemezsiniz")
    db.delete(user)
    db.commit()
