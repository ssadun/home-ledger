from sqlalchemy import (
    Column, Integer, String, Float, Date, DateTime, Boolean,
    ForeignKey, Text, JSON, Enum as SAEnum
)
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.sql import func
import enum

Base = declarative_base()


class TransactionType(str, enum.Enum):
    income = "income"
    expense = "expense"


class Currency(str, enum.Enum):
    TRY = "TRY"
    USD = "USD"
    EUR = "EUR"


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String)
    hashed_password = Column(String, nullable=False)
    username = Column(String, unique=True, index=True)  # login identifier (Members)
    role = Column(String, default="user")               # "admin" | "user"
    is_active = Column(Boolean, default=True)           # inactive members cannot log in
    notify_lead_days = Column(Integer, default=0)       # push reminder lead time: 0 = same-day
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    transactions = relationship("Transaction", back_populates="owner")
    investments = relationship("Investment", back_populates="owner")
    budgets = relationship("Budget", back_populates="owner")


class Category(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)  # frontend identifier, e.g. "groceries" (unique)
    name = Column(String, nullable=False)
    name_tr = Column(String)          # Turkish display name
    type = Column(SAEnum(TransactionType), nullable=False)
    # "kind" mirrors type but also allows "transfer" (e.g. wire-transfer), which the
    # income/expense enum can't express. The UI reads kind; type stays for compatibility.
    kind = Column(String, default="expense")
    icon = Column(String, default="circle")
    color = Column(String, default="#6366f1")
    is_default = Column(Boolean, default=False)

    transactions = relationship("Transaction", back_populates="category")


class StatementMapping(Base):
    """Maps a bank-statement tag (Garanti "Etiket") to a category_key, per language.
    Drives the importer's Etiket→category classification (see bank_import._etiket_category),
    editable from Configuration → Statement Value Mapping instead of a hardcoded dict."""
    __tablename__ = "statement_mappings"
    id = Column(Integer, primary_key=True, index=True)
    lang = Column(String, default="tr")            # statement language, e.g. "tr"
    etiket = Column(String, nullable=False)        # tag text as printed on the statement
    category_key = Column(String, nullable=False)  # target category, e.g. "wire-transfer"
    is_default = Column(Boolean, default=False)


class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)

    type = Column(SAEnum(TransactionType), nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(SAEnum(Currency), default=Currency.TRY)
    amount_try = Column(Float)           # TRY equivalent at time of entry
    amount_usd = Column(Float)           # USD equivalent at time of entry
    exchange_rate = Column(Float)        # Rate used for conversion

    description = Column(String)
    note = Column(Text)
    date = Column(Date, nullable=False)

    # Frontend uses string category keys ("groceries", "rent"); kept alongside
    # the optional category_id FK so the UI works without seeding the categories table.
    category_key = Column(String)

    # Who paid (for multi-person tracking like "Sadun" / "Melis")
    payer = Column(String)

    # Beneficiary of the spend: "Shared", a person's name, or "–" (N/A for income)
    paying_for = Column(String)

    # How it was paid: "credit-card", "debit-card", or "cash"
    payment_method = Column(String)

    # Receipt OCR
    receipt_path = Column(String)
    ocr_raw = Column(Text)

    # Credit card statement this spending belongs to (auto-linked by card + cutover window)
    credit_payment_id = Column(Integer, ForeignKey("credit_payments.id"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner = relationship("User", back_populates="transactions")
    category = relationship("Category", back_populates="transactions")
    credit_payment = relationship("CreditPayment", back_populates="transactions")


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False, index=True)
    usd_try = Column(Float)
    eur_try = Column(Float)
    source = Column(String, default="TCMB")
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())


# The Currencies config page is currency-centric (one row per ISO code, each with
# its own latest rate + a nested rate history), distinct from the day-keyed
# ExchangeRate table that drives transaction conversion. Named CurrencyRate to
# avoid clashing with the Currency enum above.
class CurrencyRate(Base):
    __tablename__ = "currency_rates"
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)  # ISO code, e.g. "USD"
    to_try = Column(Float)                       # 1 unit of this currency = ? TRY (TRY base = 1)
    to_usd = Column(Float)                        # 1 unit of this currency = ? USD
    as_of = Column(Date)                          # date of the latest rate (null for base TRY)
    source = Column(String)                       # "TCMB" | "Market" | null for base
    history = Column(JSON, default=list)          # [{date, toTRY, toUSD, source, note?}, ...]
    is_default = Column(Boolean, default=False)


class Investment(Base):
    __tablename__ = "investments"
    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    name = Column(String, nullable=False)       # e.g. "Midas NASDAQ", "ON Vadeli"
    platform = Column(String)                   # e.g. "Midas", "ON Banka", "Garanti"
    asset_type = Column(String)                 # stock, fund, crypto, deposit, gold, usd
    currency = Column(SAEnum(Currency), default=Currency.TRY)
    amount = Column(Float, nullable=False)       # quantity or TRY amount
    purchase_price = Column(Float)
    purchase_date = Column(Date)
    note = Column(Text)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    owner = relationship("User", back_populates="investments")


class Budget(Base):
    __tablename__ = "budgets"
    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    category_key = Column(String, index=True)     # frontend identity: one budget per category

    name = Column(String, nullable=False)
    amount = Column(Float, nullable=False)         # monthly limit (TRY)
    currency = Column(SAEnum(Currency), default=Currency.TRY)
    period = Column(String, default="monthly")    # monthly / yearly
    year = Column(Integer)
    month = Column(Integer)
    start_date = Column(Date)                      # active range start (inclusive)
    end_date = Column(Date)                        # active range end (inclusive)

    owner = relationship("User", back_populates="budgets")


class RecurringExpense(Base):
    __tablename__ = "recurring_expenses"
    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    category_key = Column(String)               # frontend category identifier

    name = Column(String, nullable=False)       # e.g. "Netflix", "Spotify"
    amount = Column(Float, nullable=False)
    currency = Column(SAEnum(Currency), default=Currency.TRY)
    day_of_month = Column(Integer)              # billing day (paymentDay; -1 = last day)
    source = Column(String)                     # "Istanbul CC", "ON", etc.
    is_active = Column(Boolean, default=True)
    note = Column(Text)

    # Discriminator so Subscriptions can reuse this table: "bill" | "subscription"
    kind = Column(String, default="bill")

    # Scheduling / lifecycle (mirrors the frontend recurring item)
    status = Column(String, default="active")   # active | paused | ended
    frequency = Column(String, default="monthly")  # daily | weekly | monthly
    weekend_rule = Column(String, default="none")   # defer | advance | none
    start_date = Column(Date)
    end_date = Column(Date)
    payer = Column(String)
    paying_for = Column(String)
    payment_method = Column(String)             # account id, e.g. "acc-13"
    description = Column(String)
    last_paid = Column(Date)
    next_due = Column(Date)
    history = Column(JSON, default=list)         # [{date, amount, status, note?}, ...]


class Account(Base):
    """One table for every money location — banks, cards, wallets, cash, overdraft,
    investment accounts — discriminated by `type`. (See PROGRESS.md decision: one
    Account model with a type field rather than separate Credit/Debit tables.)"""
    __tablename__ = "accounts"
    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Stable frontend identity (e.g. "acc-1"). Other records reference accounts by
    # this key (transactions.payment_method, account.linked_key), so it must survive
    # across reloads — assigned "acc-{id}" on create when not supplied.
    account_key = Column(String, index=True)

    name = Column(String, nullable=False)
    holder = Column(String)                     # household member label: "Sadun" / "Handan" / "Shared"
    type = Column(String, default="bank")       # bank | overdraft | credit | debit | wallet | cash | invest
    currency = Column(SAEnum(Currency), default=Currency.TRY)
    balance = Column(Float, default=0.0)        # negative for credit/overdraft outstanding
    number = Column(String)                     # masked, e.g. "****3847"
    institution = Column(String)
    is_primary = Column(Boolean, default=False)
    credit_limit = Column(Float)                # credit / overdraft limit
    iban = Column(String)
    linked_key = Column(String)                 # account_key of a linked account (debit→bank, overdraft→bank)

    # Card-specific (credit / debit)
    cc_type = Column(String)                    # visa | mastercard | troy
    debit_type = Column(String)                 # electron | maestro | troy
    card_name = Column(String)                  # name printed on card
    card_medium = Column(String, default="physical")  # physical | virtual (credit cards)
    validity_month = Column(String)
    validity_year = Column(String)
    statement_cutoff = Column(Integer)          # credit-card statement cutoff day
    payment_due = Column(String)                # ISO date of last credit-card statement payment (Son Ödeme Tarihi)


class CreditPayment(Base):
    """One uploaded credit-card statement → one record per card per month.
    Holds the statement totals and the original document as an attachment, and
    groups the spendings that fall inside its cutover window (transactions.credit_payment_id)."""
    __tablename__ = "credit_payments"
    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # The credit-card Account this statement belongs to. account_key mirrors the
    # transactions.payment_method convention so the frontend can resolve it directly.
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    account_key = Column(String, index=True)

    name = Column(String)                       # auto-generated "YYYY.MM - Card Name"
    period_year = Column(Integer)
    period_month = Column(Integer)

    cutover_date = Column(Date)                 # statement closing date
    payment_date = Column(Date)                 # payment due date (calendar event)
    total_amount = Column(Float, default=0.0)   # total payment due
    minimum_amount = Column(Float, default=0.0) # minimum payment due
    currency = Column(SAEnum(Currency), default=Currency.TRY)

    # Uploaded statement document (served via GET /{id}/statement — no static mount).
    statement_path = Column(String)
    statement_filename = Column(String)
    statement_mime = Column(String)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    transactions = relationship("Transaction", back_populates="credit_payment")


class PushSubscription(Base):
    """One row per browser/device subscribed to Web Push (a user may have several —
    phone, desktop, multiple browsers). Unique by endpoint since a Push endpoint
    URL is globally unique to the subscribed browser."""
    __tablename__ = "push_subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    endpoint = Column(String, unique=True, index=True, nullable=False)
    p256dh = Column(String, nullable=False)
    auth = Column(String, nullable=False)
    user_agent = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
