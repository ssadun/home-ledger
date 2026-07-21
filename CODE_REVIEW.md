# Code Review — `.claude/settings.json` hooks diff

**Scope:** working-tree changes to `.claude/settings.json` — two new hook blocks:
1. A `PreToolUse` hook (matcher `Edit|Write`) that denies edits to `data/*.db` and `.env*` paths.
2. A `PostToolUse` hook (matcher `Edit|Write`) that backgrounds `graphify update .` after code-file edits.

The working tree's other untracked additions (`.claude/agents/`, `.claude/skills/`, `AUTOMATION_RECOMMENDATIONS.md`) are not diffs against a committed baseline and were out of scope for this review.

Method: 8 independent finder angles (line-by-line, removed-behavior, cross-file trace, reuse, simplification, efficiency, altitude, CLAUDE.md conventions), deduplicated and verified. 8 findings survived verification, ranked most severe first.

---

## 1. Deny hook fails open on any script error
**File:** `.claude/settings.json:27` · **Verdict:** CONFIRMED

The command ends in `2>/dev/null || true`. If `json.load(sys.stdin)` or the regex check raises for any reason (malformed `tool_input`, `python3` unavailable, an unexpected payload shape in a future harness version), the error is discarded and the command exits `0` with empty stdout — which the hook protocol reads as **allow**. An Edit/Write to `data/home-ledger.db` or `.env` then proceeds completely unblocked, with no warning, despite the hook's entire purpose being to protect real household financial data and secrets.

This also breaks the user's global CLAUDE.md rule: *"Don't silently swallow errors — always handle or propagate them explicitly."*

## 2. Deny hook doesn't cover the Bash tool — trivially bypassed
**File:** `.claude/settings.json:23` · **Verdict:** CONFIRMED

The hook's matcher is `Edit|Write` only. `Bash("rm data/home-ledger.db")` or `Bash("echo 'SECRET_KEY=x' >> .env")` both execute unblocked — the pre-existing `Bash` PreToolUse hook (unchanged, first block in the file) only nudges toward `graphify` for grep-like commands and has no deny logic at all. Anything routed through a shell command instead of Edit/Write completely sidesteps the new protection.

## 3. Reimplements a native `permissions.deny` primitive
**File:** `.claude/settings.json:22-30` · **Verdict:** CONFIRMED

Verified directly against `claude-code-settings.schema.json`: `permissions.deny` accepts a plain array of rule strings, consistent with the allow-list style already used in this repo's `.claude/settings.local.json`, and is enforced declaratively by the harness itself — no subprocess, no regex-in-JSON-string escaping, no fail-open code path. The bespoke python hook delivers the same protection through a slower, more fragile mechanism (one `python3` spawn per Edit/Write) that can silently stop working, as shown in finding #1.

**Recommended fix:** replace the hand-rolled hook with `permissions.deny` entries, e.g. `"Edit(data/**/*.db)"`, `"Write(data/**/*.db)"`, `"Edit(.env*)"`, `"Write(.env*)"`. This also resolves #1 and #2 in one move.

## 4. Deny patterns miss the rest of `.gitignore`'s "live data" set
**File:** `.claude/settings.json:27` · **Verdict:** CONFIRMED

The patterns cover only `data/*.db` and `.env*`, but `.gitignore` groups these under the same "never commit — contains real accounts/financial data" comment as `import/`, `uploads/*`, and `preview/*`. An Edit/Write to `import/garanti_statement.csv` (a staged bank export) or `uploads/receipt123.jpg` (an OCR receipt image) proceeds completely unblocked. The hardcoded regex list has no tie to `.gitignore`'s canonical list, so it will keep drifting as new sensitive paths are added there.

## 5. PostToolUse extension list omits `.md` — CLAUDE.md edits never auto-refresh the graph
**File:** `.claude/settings.json:38` · **Verdict:** PLAUSIBLE

The new graphify-trigger extension list (`.py`/`.js`/`.jsx`/`.ts`/`.tsx`/`.css`/`.html`) omits `.md`, unlike the pre-existing `Read|Glob` nudge hook, which does include `.md`. This project's own "Adding a new statement format" convention requires updating CLAUDE.md's format-registry table "in the SAME commit" and then running `graphify update .`. If Claude edits only CLAUDE.md in a tool call (no accompanying `.py`/`.js` edit), the hook's extension check computes `HIT=0`, so the graph update is silently never invoked — leaving the graph stale until someone remembers to run it manually.

## 6. `NotebookEdit` substring-matches the matcher but the hook never resolves its path
**File:** `.claude/settings.json:27` · **Verdict:** PLAUSIBLE

`matcher` is applied as unanchored regex against the tool name (confirmed via the platform's own hook-pattern examples, e.g. `"mcp__.*__delete.*"`), so `"Edit|Write"` also matches the `NotebookEdit` tool. The hook only reads `file_path`/`filePath`, not `NotebookEdit`'s actual path field, so the deny check can never fire for notebook edits — if a `.ipynb` were ever placed under `data/` or named like an `.env` variant, the fp would compute empty and the edit would go through, unblocked, even though the script itself didn't error (same fail-open outcome as #1, reached a different way).

## 7. Concurrent hook firings clobber the shared log file
**File:** `.claude/settings.json:38` · **Verdict:** CONFIRMED

Verified against `graphify`'s actual source: `graphify update` takes a blocking `flock` on `graphify-out/.rebuild.lock`, so concurrent invocations serialize safely and `graph.json` itself is not corrupted. However, the shell redirection (`>`) truncates the shared log file immediately when each backgrounded process launches, *before* it blocks on that lock. A 3-file edit batch launches 3 processes that clobber each other's log output — if an earlier invocation fails, its error may be overwritten by a later successful run's output before anyone can inspect `/tmp/hl-graphify-update.log`.

## 8. Python quote-style convention violated
**File:** `.claude/settings.json:27,38` · **Verdict:** CONFIRMED

Both new python one-liners use single-quoted string literals throughout (`'tool_input'`, `'file_path'`, `'hookSpecificOutput'`, `'permissionDecision'`, `'deny'`, `'.py'`, etc.), violating the user's global CLAUDE.md rule: *"Quotes: single quotes in JS/TS, double quotes in Python."*

---

## Priority

Fix **#1–#3 together** first — switching the deny hook to `permissions.deny` entries closes the fail-open risk (#1) and the Bash bypass (#2) in a single change, and is the architecturally correct primitive (#3). Then address #4–#6 (scope/coverage gaps) and #7–#8 (minor robustness/style).
