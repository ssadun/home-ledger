from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import date, datetime
from app.models import TransactionType, Currency


# ── Auth ──────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str

class UserOut(BaseModel):
    id: int
    email: str
    full_name: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── Members (Users table managed from the Configuration page) ──────────────────

class MemberCreate(BaseModel):
    name: str                              # → full_name
    username: str
    password: str
    role: str = "user"                     # "admin" | "user"
    active: bool = True                    # → is_active
    show_as_payer: bool = True             # appears as a Payer/Paying For option
    email: Optional[EmailStr] = None       # synthesized from username when absent

class MemberUpdate(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None         # only re-hashed when provided
    role: Optional[str] = None
    active: Optional[bool] = None
    show_as_payer: Optional[bool] = None
    email: Optional[EmailStr] = None

class MemberOut(BaseModel):
    id: int
    name: Optional[str] = None             # mapped from full_name
    username: Optional[str] = None
    role: Optional[str] = None
    active: bool = True                    # mapped from is_active
    show_as_payer: bool = True             # mapped from show_as_payer
    email: str
    model_config = {"from_attributes": True}


# ── Category ──────────────────────────────────────────────────────────────────

class CategoryOut(BaseModel):
    id: int
    key: Optional[str]
    name: str
    name_tr: Optional[str]
    type: TransactionType
    kind: Optional[str]
    icon: Optional[str]
    color: Optional[str]
    is_default: Optional[bool] = None
    model_config = {"from_attributes": True}

class CategoryCreate(BaseModel):
    key: Optional[str] = None
    name: str
    name_tr: Optional[str] = None
    kind: str = "expense"            # income | expense | transfer
    icon: Optional[str] = "circle"
    color: Optional[str] = "#6366f1"

class CategoryUpdate(BaseModel):
    key: Optional[str] = None
    name: Optional[str] = None
    name_tr: Optional[str] = None
    kind: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None


# ── Statement Value Mapping (Etiket → category) ────────────────────────────────

class StatementMappingOut(BaseModel):
    id: int
    lang: Optional[str]
    etiket: str
    category_key: str
    is_default: Optional[bool] = None
    model_config = {"from_attributes": True}

class StatementMappingCreate(BaseModel):
    lang: str = "tr"
    etiket: str
    category_key: str

class StatementMappingUpdate(BaseModel):
    lang: Optional[str] = None
    etiket: Optional[str] = None
    category_key: Optional[str] = None


# ── Financial Institution (bank / provider + logo) ────────────────────────────

class FinancialInstitutionOut(BaseModel):
    id: int
    key: str
    name: str
    swift: Optional[str] = None
    logo: Optional[str] = None       # data: URI or https URL
    is_default: Optional[bool] = None
    model_config = {"from_attributes": True}

class FinancialInstitutionCreate(BaseModel):
    key: str
    name: str
    swift: Optional[str] = None
    logo: Optional[str] = None

class FinancialInstitutionUpdate(BaseModel):
    key: Optional[str] = None
    name: Optional[str] = None
    swift: Optional[str] = None
    logo: Optional[str] = None


# ── Transaction ───────────────────────────────────────────────────────────────

class TransactionCreate(BaseModel):
    type: TransactionType
    amount: float
    currency: Currency = Currency.TRY
    category_id: Optional[int] = None
    category_key: Optional[str] = None
    description: Optional[str] = None
    note: Optional[str] = None
    date: date
    payer: Optional[str] = None
    paying_for: Optional[str] = None
    payment_method: Optional[str] = None
    # Client-computed fallbacks used only when no TCMB rate row exists for the date
    amount_try: Optional[float] = None
    amount_usd: Optional[float] = None

class TransactionOut(BaseModel):
    id: int
    type: TransactionType
    amount: float
    currency: Currency
    amount_try: Optional[float]
    amount_usd: Optional[float]
    exchange_rate: Optional[float]
    description: Optional[str]
    note: Optional[str]
    date: date
    category_key: Optional[str]
    payer: Optional[str]
    paying_for: Optional[str]
    payment_method: Optional[str]
    category: Optional[CategoryOut]
    receipt_path: Optional[str]
    credit_payment_id: Optional[int]
    source_filename: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}

class TransactionUpdate(BaseModel):
    type: Optional[TransactionType] = None
    amount: Optional[float] = None
    currency: Optional[Currency] = None
    category_id: Optional[int] = None
    category_key: Optional[str] = None
    description: Optional[str] = None
    note: Optional[str] = None
    date: Optional[date] = None
    payer: Optional[str] = None
    paying_for: Optional[str] = None
    payment_method: Optional[str] = None
    amount_try: Optional[float] = None
    amount_usd: Optional[float] = None
    credit_payment_id: Optional[int] = None


# ── Budget ────────────────────────────────────────────────────────────────────

class BudgetCreate(BaseModel):
    category_key: Optional[str] = None
    name: str
    amount: float
    currency: Currency = Currency.TRY
    period: str = "monthly"
    start_date: Optional[date] = None
    end_date: Optional[date] = None

class BudgetUpdate(BaseModel):
    category_key: Optional[str] = None
    name: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[Currency] = None
    period: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None

class BudgetOut(BaseModel):
    id: int
    category_key: Optional[str]
    name: str
    amount: float
    currency: Currency
    period: Optional[str]
    start_date: Optional[date]
    end_date: Optional[date]
    model_config = {"from_attributes": True}


# ── Exchange Rate ─────────────────────────────────────────────────────────────

class ExchangeRateOut(BaseModel):
    date: date
    usd_try: Optional[float]
    eur_try: Optional[float]
    source: str
    model_config = {"from_attributes": True}


# ── Currency (Currencies config page) ─────────────────────────────────────────

class CurrencyCreate(BaseModel):
    code: str
    to_try: Optional[float] = None
    to_usd: Optional[float] = None
    as_of: Optional[date] = None
    source: Optional[str] = None
    history: List[dict] = []

class CurrencyUpdate(BaseModel):
    code: Optional[str] = None
    to_try: Optional[float] = None
    to_usd: Optional[float] = None
    as_of: Optional[date] = None
    source: Optional[str] = None
    history: Optional[List[dict]] = None

class CurrencyOut(BaseModel):
    id: int
    code: str
    to_try: Optional[float]
    to_usd: Optional[float]
    as_of: Optional[date]
    source: Optional[str]
    history: Optional[List[dict]] = []
    is_default: Optional[bool] = None
    model_config = {"from_attributes": True}


# ── Investment ────────────────────────────────────────────────────────────────

class InvestmentCreate(BaseModel):
    name: str
    platform: Optional[str] = None
    asset_type: str  # stock, fund, crypto, deposit, gold, usd
    currency: Currency = Currency.TRY
    amount: float
    purchase_price: Optional[float] = None
    purchase_date: Optional[date] = None
    note: Optional[str] = None

class InvestmentOut(InvestmentCreate):
    id: int
    updated_at: datetime
    model_config = {"from_attributes": True}

class InvestmentUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    purchase_price: Optional[float] = None
    note: Optional[str] = None


# ── Dashboard ─────────────────────────────────────────────────────────────────

class MonthlySummary(BaseModel):
    year: int
    month: int
    total_income_try: float
    total_expense_try: float
    net_try: float
    total_income_usd: Optional[float]
    total_expense_usd: Optional[float]

class DashboardOut(BaseModel):
    current_month: MonthlySummary
    last_rate: ExchangeRateOut
    top_expense_categories: List[dict]
    recent_transactions: List[TransactionOut]


# ── Recurring ─────────────────────────────────────────────────────────────────

class RecurringCreate(BaseModel):
    name: str
    amount: float
    currency: Currency = Currency.TRY
    category_key: Optional[str] = None
    day_of_month: Optional[int] = None
    source: Optional[str] = None
    note: Optional[str] = None
    kind: str = "bill"                     # bill | subscription
    status: str = "active"                 # active | paused | ended
    frequency: str = "monthly"
    weekend_rule: Optional[str] = "none"
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    payer: Optional[str] = None
    paying_for: Optional[str] = None
    payment_method: Optional[str] = None
    description: Optional[str] = None
    last_paid: Optional[date] = None
    next_due: Optional[date] = None
    history: Optional[list] = None

class RecurringUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[Currency] = None
    category_key: Optional[str] = None
    day_of_month: Optional[int] = None
    source: Optional[str] = None
    note: Optional[str] = None
    kind: Optional[str] = None
    status: Optional[str] = None
    frequency: Optional[str] = None
    weekend_rule: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    payer: Optional[str] = None
    paying_for: Optional[str] = None
    payment_method: Optional[str] = None
    description: Optional[str] = None
    last_paid: Optional[date] = None
    next_due: Optional[date] = None
    history: Optional[list] = None

class RecurringOut(RecurringCreate):
    id: int
    is_active: Optional[bool] = None
    model_config = {"from_attributes": True}


# ── Account ───────────────────────────────────────────────────────────────────

class AccountCreate(BaseModel):
    name: str
    holder: Optional[str] = None
    type: str = "bank"
    currency: Currency = Currency.TRY
    balance: float = 0.0
    number: Optional[str] = None
    institution: Optional[str] = None
    is_primary: bool = False
    show_in_payment_method: bool = False
    credit_limit: Optional[float] = None
    iban: Optional[str] = None
    linked_key: Optional[str] = None
    cc_type: Optional[str] = None
    is_prepaid: bool = False
    debit_type: Optional[str] = None
    card_name: Optional[str] = None
    card_medium: Optional[str] = None
    validity_month: Optional[str] = None
    validity_year: Optional[str] = None
    statement_cutoff: Optional[int] = None
    payment_due: Optional[str] = None
    pension: Optional[dict] = None      # BES figures; only for type == "pension"

class AccountUpdate(BaseModel):
    name: Optional[str] = None
    holder: Optional[str] = None
    type: Optional[str] = None
    currency: Optional[Currency] = None
    balance: Optional[float] = None
    number: Optional[str] = None
    institution: Optional[str] = None
    is_primary: Optional[bool] = None
    show_in_payment_method: Optional[bool] = None
    credit_limit: Optional[float] = None
    iban: Optional[str] = None
    linked_key: Optional[str] = None
    cc_type: Optional[str] = None
    is_prepaid: Optional[bool] = None
    debit_type: Optional[str] = None
    card_name: Optional[str] = None
    card_medium: Optional[str] = None
    validity_month: Optional[str] = None
    validity_year: Optional[str] = None
    statement_cutoff: Optional[int] = None
    payment_due: Optional[str] = None
    pension: Optional[dict] = None

class AccountOut(AccountCreate):
    id: int
    account_key: Optional[str]
    model_config = {"from_attributes": True}


# ── Credit Payment (credit-card statement) ──────────────────────────────────────

class CreditPaymentCreate(BaseModel):
    account_id: Optional[int] = None
    account_key: Optional[str] = None
    period_year: int
    period_month: int
    cutover_date: Optional[date] = None
    payment_date: Optional[date] = None
    total_amount: float = 0.0
    minimum_amount: float = 0.0
    currency: Currency = Currency.TRY

class CreditPaymentUpdate(BaseModel):
    account_id: Optional[int] = None
    account_key: Optional[str] = None
    period_year: Optional[int] = None
    period_month: Optional[int] = None
    cutover_date: Optional[date] = None
    payment_date: Optional[date] = None
    total_amount: Optional[float] = None
    minimum_amount: Optional[float] = None
    currency: Optional[Currency] = None

class CreditPaymentOut(BaseModel):
    id: int
    account_id: Optional[int]
    account_key: Optional[str]
    name: Optional[str]
    period_year: Optional[int]
    period_month: Optional[int]
    cutover_date: Optional[date]
    payment_date: Optional[date]
    total_amount: Optional[float]
    minimum_amount: Optional[float]
    currency: Currency
    statement_filename: Optional[str]
    linked_count: int = 0
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Push Notifications ────────────────────────────────────────────────────────

class PushSubscriptionCreate(BaseModel):
    endpoint: str
    keys: dict                        # {"p256dh": "...", "auth": "..."} — raw PushSubscriptionJSON shape
    user_agent: Optional[str] = None

class PushSubscriptionOut(BaseModel):
    id: int
    endpoint: str
    created_at: datetime
    model_config = {"from_attributes": True}

class PushUnsubscribe(BaseModel):
    endpoint: str

class NotifyPrefsOut(BaseModel):
    notify_lead_days: int
    subscribed: bool

class NotifyPrefsUpdate(BaseModel):
    notify_lead_days: int

class SnoozeCreate(BaseModel):
    endpoint: str                     # push endpoint = capability that authenticates the SW
    type: str                         # "recurring" | "credit"
    id: int                           # RecurringExpense.id / CreditPayment.id
    days: int                         # 1 | 3 | 7 (validated against SNOOZE_DAYS_ALLOWED)
