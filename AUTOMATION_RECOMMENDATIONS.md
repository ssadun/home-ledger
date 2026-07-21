# Claude Code Automation Recommendations

## Codebase Profile
- **Backend**: FastAPI + SQLAlchemy (no Alembic — manual `ALTER TABLE` per new column), APScheduler, pywebpush, pdfplumber, pytesseract — **zero backend tests**, no lint config
- **Frontend**: Static multi-page HTML + React via Babel-standalone JSX (no bundler/build step)
- **Domain**: Personal finance — multi-currency, Turkish bank statement parsing (a documented "living format registry" recipe in CLAUDE.md), Web Push reminders
- **Already in place**: `graphify` knowledge graph + enforcement hooks, Playwright via a bespoke Docker CLI runner (not MCP), `gh` CLI authenticated, GitHub remote — no CI workflows yet

---

## 🎯 Skills

### add-bank-format
**Why**: CLAUDE.md already documents an exact 5-step recipe for adding a new bank/card statement parser to `bank_import.py` (detector → parser → dispatch wiring → account-identity emission → registry table update in the same commit). This is a repeated, well-specified workflow that's currently done from memory each time — a skill can scaffold the detector/parser stub and remind you to update the CLAUDE.md table + run `graphify update .`.
**Create**: `.claude/skills/add-bank-format/SKILL.md`
**Invocation**: Both
**Status**: ✅ Implemented

### db-column-migration
**Why**: Since there's no Alembic, every new model field needs a manually-written `ALTER TABLE` statement — CLAUDE.md already lists three of these by hand (`notify_lead_days`, `show_as_payer`, `show_in_payment_method`). A skill that diffs `models.py` against the live schema and emits the exact `ALTER TABLE` + a CLAUDE.md doc-line would remove a manual step you're currently repeating.
**Create**: `.claude/skills/db-column-migration/SKILL.md`
**Invocation**: User-only (`disable-model-invocation: true`)
**Status**: ✅ Implemented

---

## ⚡ Hooks

### Auto-run `graphify update .` after code edits
**Why**: CLAUDE.md instructs "after modifying code, run `graphify update .`" as a manual step — a `PostToolUse` hook on `Edit|Write` matching source extensions makes this automatic instead of relying on the model remembering every time.
**Where**: `.claude/settings.json`
**Status**: ✅ Implemented — runs in the background after edits to `.py`/`.js`/`.jsx`/`.ts`/`.tsx`/`.css`/`.html` files.

### Guard against editing real data / secrets
**Why**: `.gitignore` already flags `data/*.db` and `.env` as "never commit — contains real accounts/financial data." A `PreToolUse` hook blocking `Edit`/`Write` on `data/*.db*` and `.env*` paths turns that intent into an enforced rule instead of a comment.
**Where**: `.claude/settings.json`
**Status**: ✅ Implemented — denies `Edit`/`Write` on `data/*.db*` and `.env*` paths with a clear reason.

---

## 🤖 Subagents

### test-writer (backend)
**Why**: `backend/app/services/` has zero test coverage despite genuinely tricky logic — `tcmb.py`'s weekend/holiday fallback, and `bank_import.py`'s Turkish number parsing (`_parse_amount` vs `_parse_on_amount` for 3-decimal ON/Burgan statements) is exactly the kind of edge-case-heavy code that silently breaks on the next statement format.
**Where**: `.claude/agents/test-writer.md`
**Status**: ✅ Implemented

### bank-import-reviewer
**Why**: Bank/card parsing directly creates financial transactions from real statements with no test net — a focused reviewer that checks new/changed parsers in `bank_import.py` against the CLAUDE.md rules (casing preservation, virman/commission classification, Etiket precedence) would catch regressions that unit tests alone might miss.
**Where**: `.claude/agents/bank-import-reviewer.md`
**Status**: ✅ Implemented

---

## 🔌 MCP Servers

### context7
**Why**: The backend leans on library-specific behavior that's easy to get subtly wrong from memory alone — pywebpush/VAPID signing, APScheduler job semantics, pdfplumber table extraction. Live doc lookup beats guessing at API details for these.
**Install**: `claude mcp add context7`
**Status**: ✅ Implemented — connected per `claude mcp list`.

*(Playwright and GitHub MCP servers are intentionally not recommended — CLAUDE.md already establishes a CLI-based Playwright workflow and `gh` CLI is already authenticated and preferred for GitHub tasks; adding MCP equivalents would conflict with your documented conventions.)*

---

**Want more?** Ask for additional recommendations for any specific category (e.g., more hook options or more frontend-focused skills).

**Want help implementing any of these?** Just ask and I can help set up any of the recommendations above.
