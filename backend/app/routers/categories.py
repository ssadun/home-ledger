from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Category, TransactionType, User
from app.schemas import CategoryOut, CategoryCreate, CategoryUpdate
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/categories", tags=["categories"])


# Default categories — mirror the frontend CATS dictionary (data.js).
DEFAULT_CATEGORIES = [
    ("salary",        "Salary",        "income",   "banknote",         "var(--green)"),
    ("freelance",     "Freelance",     "income",   "laptop",           "var(--emerald)"),
    ("interest",      "Interest",      "income",   "trending-up",      "var(--mint)"),
    ("rent",          "Rent",          "expense",  "home",             "var(--coral)"),
    ("groceries",     "Groceries",     "expense",  "shopping-cart",    "var(--lime)"),
    ("dining",        "Dining",        "expense",  "utensils-crossed", "var(--orange)"),
    ("transport",     "Transport",     "expense",  "car-front",        "var(--sky)"),
    ("utilities",     "Utilities",     "expense",  "zap",              "var(--yellow)"),
    ("subscriptions", "Subscriptions", "expense",  "repeat",           "var(--fuchsia)"),
    ("entertainment", "Entertainment", "expense",  "clapperboard",     "var(--lavender)"),
    ("health",        "Health",        "expense",  "heart-pulse",      "var(--rose)"),
    ("shopping",      "Shopping",      "expense",  "shopping-bag",     "var(--pink)"),
    ("travel",        "Travel",        "expense",  "plane",            "var(--accent)"),
    ("education",     "Education",     "expense",  "graduation-cap",   "var(--steel)"),
    ("gifts",         "Gifts",         "expense",  "gift",             "var(--rose)"),
    ("wire-transfer", "Wire Transfer", "transfer", "send",             "var(--sky)"),
]


def _type_from_kind(kind: str) -> TransactionType:
    """Map a UI 'kind' to the income/expense enum (transfer is stored as expense)."""
    return TransactionType.income if kind == "income" else TransactionType.expense


def seed_default_categories(db: Session) -> None:
    """Populate the shared categories table on first run if it is empty."""
    if db.query(Category).first():
        return
    for key, name, kind, icon, color in DEFAULT_CATEGORIES:
        db.add(Category(
            key=key, name=name, kind=kind, type=_type_from_kind(kind),
            icon=icon, color=color, is_default=True,
        ))
    db.commit()


@router.get("/", response_model=List[CategoryOut])
def list_categories(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Category).order_by(Category.id).all()


@router.post("/", response_model=CategoryOut, status_code=201)
def create_category(
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cat = Category(
        key=payload.key,
        name=payload.name,
        name_tr=payload.name_tr,
        kind=payload.kind,
        type=_type_from_kind(payload.kind),
        icon=payload.icon,
        color=payload.color,
        is_default=False,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.patch("/{cat_id}", response_model=CategoryOut)
def update_category(
    cat_id: int,
    payload: CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(404, "Kategori bulunamadı")
    data = payload.model_dump(exclude_none=True)
    for field, value in data.items():
        setattr(cat, field, value)
    if "kind" in data:
        cat.type = _type_from_kind(data["kind"])
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{cat_id}", status_code=204)
def delete_category(cat_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(404, "Kategori bulunamadı")
    db.delete(cat)
    db.commit()
