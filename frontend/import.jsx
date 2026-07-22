// import.jsx — Statement import wizard: choose file → detect account → approve → done.
// Wired to the backend: a picked file is parsed by /api/import/preview and the
// reviewed rows are persisted by /api/import/confirm (via window.HL_IMPORT_API).
// Static sample statements remain as an offline demo path.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { ACCOUNT_TYPES, FINANCIAL_INSTITUTIONS, FX } = window.ACCOUNTS_DATA;   // static config maps
  const { CATS } = window.LEDGER;
  const { DOCUMENTS, guessCategory } = window.IMPORT_DATA;

  const SYM = { TRY: '₺', USD: '$', EUR: '€' };
  const grp = (v, d = 2) => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  // ISO → Turkish display date ("2026-08-16" → "16.08.2026").
  const fmtDateTr = (iso) => { if (!iso) return '—'; const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : iso; };
  const FMT = { csv: { label: 'CSV', icon: 'file-spreadsheet', color: 'var(--green)' },
                excel: { label: 'Excel', icon: 'sheet', color: 'var(--emerald)' },
                pdf: { label: 'PDF', icon: 'file-text', color: 'var(--red)' } };

  const STEPS = [
    { key: 'choose', label: 'Choose File', icon: 'upload' },
    { key: 'detect', label: 'Detect Account', icon: 'scan-search' },
    { key: 'review', label: 'Review & Edit', icon: 'list-checks' },
    { key: 'done',   label: 'Done', icon: 'check-check' },
  ];

  // Broker portfolio statements (Midas) create Investments, not transactions —
  // there is no per-account matching step, so the wizard skips "Detect Account".
  const INV_STEPS = [
    { key: 'choose', label: 'Choose File', icon: 'upload' },
    { key: 'review', label: 'Review Holdings', icon: 'list-checks' },
    { key: 'done',   label: 'Done', icon: 'check-check' },
  ];

  // BES birikim özeti: like the broker path, the account is identified by the
  // statement itself (contract number), so there is no Detect Account step.
  const PEN_STEPS = [
    { key: 'choose', label: 'Choose File', icon: 'upload' },
    { key: 'review', label: 'Review Funds', icon: 'list-checks' },
    { key: 'done',   label: 'Done', icon: 'check-check' },
  ];

  // Statements that carry an account identity but no movements (e.g. a TEB
  // dijital hesap cüzdanı for a dormant account). Nothing to review or import —
  // the wizard only offers to create/match the account the file describes.
  const ID_STEPS = [
    { key: 'choose',   label: 'Choose File', icon: 'upload' },
    { key: 'identity', label: 'Add Account', icon: 'scan-search' },
  ];

  // Investment asset types accepted by the backend (models.Investment.asset_type).
  const ASSET_TYPES = [
    ['stock', 'Stock'], ['fund', 'Fund'], ['gold', 'Gold'],
    ['crypto', 'Crypto'], ['deposit', 'Deposit'], ['usd', 'FX / Cash'],
  ];

  // ── Step indicator ──
  function Stepper({ current, steps = STEPS }) {
    const idx = steps.findIndex(s => s.key === current);
    return (
      <div className="imp-stepper">
        {steps.map((s, i) => (
          <React.Fragment key={s.key}>
            <div className={'imp-step' + (i === idx ? ' active' : '') + (i < idx ? ' done' : '')}>
              <span className="imp-step-dot"><Icon name={i < idx ? 'check' : s.icon} size={13} /></span>
              <span className="imp-step-label">{s.label}</span>
            </div>
            {i < steps.length - 1 && <span className={'imp-step-bar' + (i < idx ? ' done' : '')}></span>}
          </React.Fragment>
        ))}
      </div>
    );
  }

  // ── Account option helpers ──
  // Dropdown labels are keyed on institution + the tail of the IBAN/card number,
  // NOT on `name` — every account of one household member is named after that
  // member, so a name-based label renders several indistinguishable
  // "Sadun Sevingen · —" options. The label has a 26-char budget — as much as the
  // 250px select shows without ellipsizing. With digits that splits 17 + ' · ' + 6;
  // with none, the separator and digit slots are dropped and the whole 26 goes to
  // the name ("Midas Menkul Değerler A.Ş." fits exactly, vs "Midas Menkul Değe · —").
  // A dash is the app's own "not applicable" placeholder for institution/number
  // (the Cash account carries institution '–'), so it must read as blank here or
  // the option renders as a bare '– · —'.
  const ACC_BLANK = /^[-–—\s]*$/;
  function accLabel(a) {
    const src = [a.institution, a.name].find(v => v && !ACC_BLANK.test(String(v))) || '';
    const digits = String(a.iban || a.number || '').replace(/\D/g, '');
    const inst = String(src).trim().slice(0, digits ? 17 : 26).trim();
    return digits ? inst + ' · ' + digits.slice(-6) : inst;
  }
  function findByNumber(accounts, num) { return num ? accounts.find(a => a.number === num) : null; }

  // Match a statement "source" ref (account/card number, e.g. "440 - 9059576 USD"
  // or "4870 **** **** 1011") to an account by its last 4 digits.
  function matchBySource(accounts, source) {
    const d = String(source || '').replace(/\D/g, '');
    if (d.length < 4) return null;
    const l4 = d.slice(-4);
    return accounts.find(a => String(a.number || '').replace(/\D/g, '').slice(-4) === l4) || null;
  }

  // Match a parsed statement identity record (from /preview `accounts`) to an
  // existing account: IBAN exact first (bank/overdraft), then card/number last-4.
  function matchStatementAccount(accounts, rec) {
    if (!rec) return null;
    const ibn = String(rec.iban || '').replace(/\s+/g, '').toUpperCase();
    if (ibn) {
      const m = accounts.find(a => String(a.iban || '').replace(/\s+/g, '').toUpperCase() === ibn);
      if (m) return m;
    }
    return matchBySource(accounts, rec.card_number || rec.number || rec.source);
  }

  // Turkish-safe title case: lower-case the dotted/dotless I correctly, then
  // capitalize only the first letter of each space-separated word (JS \w treats
  // ç/ö/ş/İ as word boundaries, which would wrongly upper-case mid-word letters).
  function titleCase(s) {
    const lower = String(s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
    return lower.split(/\s+/).map(w => w ? w.charAt(0).toLocaleUpperCase('tr') + w.slice(1) : w).join(' ');
  }

  // Statements that print only an IBAN (ON/Burgan) leave `number` empty, so the
  // account number is derived from the IBAN's tail — same canonical helpers the
  // Accounts form uses, so a drafted account and a hand-typed one agree.
  const { cleanIban, accountNoFromIban } = window.HL_ACCOUNTS_API;

  // Pre-fill an AccountFormModal `initial` from a parsed statement identity record,
  // so the user only confirms/edits before the account is created.
  function accountDraftFromRecord(rec) {
    const isCard = rec.type === 'credit' || rec.type === 'debit';
    const inst = (FINANCIAL_INSTITUTIONS || {})[rec.institution];
    // Trimmed: the Accounts form saves `institution` trimmed, so an untrimmed name
    // here would be written as an institution that matches nothing in the picker.
    // Unknown key → '', leaving the picker empty for the user to choose from.
    const instName = inst ? String(inst.name || '').trim() : '';
    const holder = rec.holder ? titleCase(rec.holder) : '';
    const last4 = String(rec.card_number || rec.number || '').replace(/\D/g, '').slice(-4);
    // Bank accounts are named after their holder alone — the institution is a
    // field of its own and the Accounts page already renders it beside the name,
    // so folding it in produced a doubled "Burgan Bank · Sadun Sevingen".
    const name = isCard
      ? (instName || 'Card') + (last4 ? ' ••' + last4 : '')
      : (holder || instName || 'Bank');
    return {
      type: rec.type || 'bank',
      name,
      owner: 'Sadun',
      cur: rec.currency || 'TRY',
      number: rec.number || rec.card_number || accountNoFromIban(rec.iban),
      iban: cleanIban(rec.iban),
      institution: instName,
      // Closing balance, when the statement prints one (TEB cüzdan does).
      balance: rec.balance != null ? rec.balance : undefined,
      cardName: isCard ? (rec.holder ? rec.holder.trim() : '') : undefined,
      // Statement's actual last payment date (Son Ödeme Tarihi); the form derives the
      // Statement Cutoff Week from it when no week is otherwise set.
      paymentDue: rec.type === 'credit' ? (rec.payment_due || undefined) : undefined,
    };
  }

  // Infer the FMT bucket from a picked file's extension.
  function formatOf(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (ext === 'csv') return 'csv';
    return 'excel';
  }

  // Normalize a /preview response into the same shape the sample DOCUMENTS use,
  // so the Detect/Review steps render identically for real and demo statements.
  function normalizePreview(file, res) {
    const dr = res.date_range || {};
    // Row tuple: [date, description, amount(signed), currency, etiket, source, category_key]
    // The API returns a positive `amount` plus a `type` ('income'|'expense');
    // re-apply the sign so the wizard's signed-amount slot is correct.
    // category_key carries the backend's classification (e.g. credit-card-payment
    // for "ÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ") so the review step can prefer it over
    // keyword guessing.
    const rows = (res.rows || []).map(r => {
      const signed = (Number(r.amount) || 0) * (r.type === 'expense' ? -1 : 1);
      return [r.date, r.description || '', signed, r.currency || 'TRY', r.etiket || null, r.source || null, r.category_key || null];
    });
    // Distinct source refs (cards/accounts) present in the file.
    const sources = [...new Set(rows.map(r => r[5]).filter(Boolean))];
    // Parsed account identities (type/IBAN/card/holder/branch) — one per source.
    // Backfill a minimal record for any source the parser saw rows for but did not
    // surface an identity for, so every distinct source is still resolvable.
    const bySource = {};
    (res.accounts || []).forEach(a => { if (a && a.source) bySource[a.source] = a; });
    const statementAccounts = sources.map(s => bySource[s] || {
      source: s, type: null, number: s, card_number: null, iban: null,
      branch: null, holder: null, currency: (rows.find(r => r[5] === s) || [])[3] || 'TRY',
      institution: null,
    });
    return {
      fileName: file.name,
      format: formatOf(file.name),
      institution: res.bank_detected || 'Bank',
      accountNumber: sources[0] || null,         // first card/account ref (display + match)
      sources,
      statementAccounts,
      period: (dr.from || '?') + ' → ' + (dr.to || '?'),
      rows,
    };
  }

  // ═══════════════ STEP 1 — Choose file ═══════════════
  function ChooseStep({ format, setFormat, setSelected, pickedFile, setPickedFile }) {
    const fileRef = React.useRef(null);

    function onFile(file) {
      if (!file) return;
      setPickedFile(file);
      setSelected(null);
      setFormat(formatOf(file.name));
    }

    return (
      <div className="imp-pane">
        <div className="imp-field">
          <span className="field-label">Statement Format</span>
          <div className="seg imp-fmt-seg">
            {Object.keys(FMT).map(k => (
              <button key={k} id={'imp-format-' + k + '-btn'} className={format === k ? 'on-fmt' : ''} onClick={() => { setFormat(k); setSelected(null); }}
                style={format === k ? { background: 'color-mix(in srgb, ' + FMT[k].color + ' 16%, transparent)', color: FMT[k].color } : {}}>
                <Icon name={FMT[k].icon} size={14} />{FMT[k].label}
              </button>
            ))}
          </div>
        </div>

        <div className={'imp-drop' + (pickedFile ? ' has-file' : '')} onClick={() => fileRef.current && fileRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }}
          onDragLeave={(e) => e.currentTarget.classList.remove('over')}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); onFile(e.dataTransfer.files[0]); }}>
          {pickedFile ? (
            <React.Fragment>
              <span className="imp-drop-ico" style={{ color: FMT[format].color }}><Icon name={FMT[format].icon} size={26} /></span>
              <span className="imp-drop-t">{pickedFile.name}</span>
              <span className="imp-drop-s">Ready to parse · <b>choose a different file</b></span>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <span className="imp-drop-ico"><Icon name="upload-cloud" size={26} /></span>
              <span className="imp-drop-t">Drop your {FMT[format].label} statement here</span>
              <span className="imp-drop-s">or <b>browse files</b> · max 10 MB</span>
            </React.Fragment>
          )}
          <input id="imp-file-input" ref={fileRef} type="file" hidden accept=".csv,.xls,.xlsx,.pdf"
            onChange={(e) => onFile(e.target.files[0])} />
        </div>
      </div>
    );
  }

  // One detected statement identity (bank account / card) → its resolved account,
  // with a "Create from statement…" option that pre-fills the Add-Account modal.
  function SourceRow({ rec, accounts, value, onPick, onCreate }) {
    const t = ACCOUNT_TYPES[rec.type] || ACCOUNT_TYPES.bank;
    const ident = rec.iban || rec.card_number || rec.number || rec.source;
    const sub = [t.label, rec.holder ? titleCase(rec.holder) : null, rec.branch ? titleCase(rec.branch) : null, rec.currency]
      .filter(Boolean).join(' · ');
    return (
      <div className={'imp-src-row' + (value ? ' matched' : '')}>
        <span className="acct-type-ico" style={{ width: 32, height: 32, color: t.color,
          background: 'color-mix(in srgb, ' + t.color + ' 13%, transparent)',
          borderColor: 'color-mix(in srgb, ' + t.color + ' 40%, transparent)' }}><Icon name={t.icon} size={15} /></span>
        <div className="imp-src-meta">
          <span className="imp-src-id mono">{ident}</span>
          <span className="imp-src-sub">{sub}</span>
        </div>
        <StyledSelect className="field-input imp-src-sel" value={value || ''}
          onChange={(e) => { e.target.value === '__create__' ? onCreate(rec) : onPick(rec.source, e.target.value); }}>
          <option value="" disabled>Select account…</option>
          <option value="__create__">＋ Create from statement…</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}
        </StyledSelect>
        {value
          ? <span className="imp-src-flag ok" title="Resolved"><Icon name="badge-check" size={15} /></span>
          : <span className="imp-src-flag warn" title="No matching account"><Icon name="alert-triangle" size={15} /></span>}
      </div>
    );
  }

  // ═══════════════ STEP 2 — Detect account ═══════════════
  function DetectStep({ doc, accId, setAccId, accounts, sourceMap, resolveSource, onPick, onCreate }) {
    const detected = doc.statementAccounts || [];
    const cur = doc.rows.length ? doc.rows[0][3] : 'TRY';
    const totals = doc.rows.reduce((s, r) => { r[2] >= 0 ? s.in += r[2] : s.out += -r[2]; return s; },
      { in: 0, out: 0 });
    const dates = doc.rows.map(r => r[0]).sort();
    const acc = accounts.find(a => a.id === accId);
    const t = acc ? ACCOUNT_TYPES[acc.type] : null;
    const unresolved = detected.filter(rec => !resolveSource(rec.source)).length;

    return (
      <div className="imp-pane">
        <div className="imp-detect-card">
          <div className="imp-detect-top">
            <span className="imp-doc-ico lg" style={{ color: FMT[doc.format].color }}><Icon name={FMT[doc.format].icon} size={20} /></span>
            <div className="imp-detect-file">
              <span className="imp-doc-name">{doc.fileName}</span>
              <span className="imp-doc-sub">{doc.institution} · {doc.period} · {doc.rows.length} transactions</span>
            </div>
            <span className="imp-detect-ok"><Icon name="check-circle-2" size={13} />Parsed</span>
          </div>
          <div className="imp-detect-grid">
            <div className="imp-stat"><span className="imp-stat-k">Account No. (from file)</span><span className="imp-stat-v mono">{doc.accountNumber || '—'}</span></div>
            <div className="imp-stat"><span className="imp-stat-k">Date Range</span><span className="imp-stat-v">{dates[0]} → {dates[dates.length - 1]}</span></div>
            <div className="imp-stat"><span className="imp-stat-k">Money In</span><span className="imp-stat-v pos">+{SYM[cur]}{grp(totals.in)}</span></div>
            <div className="imp-stat"><span className="imp-stat-k">Money Out</span><span className="imp-stat-v neg">−{SYM[cur]}{grp(totals.out)}</span></div>
          </div>
        </div>

        {detected.length ? (
          <div className="imp-field">
            <span className="field-label">Detected Account{detected.length > 1 ? 's' : ''} ({detected.length})</span>
            {unresolved
              ? <div className="imp-nomatch-banner"><Icon name="alert-triangle" size={14} />{unresolved} of {detected.length} not matched to an account. Create each from the statement (or pick an existing one) before continuing.</div>
              : <div className="imp-match-banner"><Icon name="badge-check" size={14} />All detected accounts are mapped — each row will be assigned to its own account.</div>}
            <div className="imp-src-list">
              {detected.map(rec => (
                <SourceRow key={rec.source} rec={rec} accounts={accounts}
                  value={resolveSource(rec.source)} onPick={onPick} onCreate={onCreate} />
              ))}
            </div>
            <span className="imp-hint"><Icon name="info" size={11} />Bank accounts are keyed by IBAN, cards by card number — pick a matching account or create it pre-filled from the statement.</span>
          </div>
        ) : (
          <div className="imp-field">
            <span className="field-label">Related Account</span>
            {matchBySource(accounts, doc.accountNumber)
              ? <div className="imp-match-banner"><Icon name="badge-check" size={14} />Auto-matched by account number <b>{doc.accountNumber}</b> → <b>{matchBySource(accounts, doc.accountNumber).name}</b></div>
              : <div className="imp-nomatch-banner"><Icon name="alert-triangle" size={14} />No account matched automatically. Pick the destination account below.</div>}
            <div className="imp-acc-select">
              {t && <span className="acct-type-ico" style={{ width: 30, height: 30, color: t.color,
                background: 'color-mix(in srgb, ' + t.color + ' 13%, transparent)',
                borderColor: 'color-mix(in srgb, ' + t.color + ' 40%, transparent)' }}><Icon name={t.icon} size={15} /></span>}
              <StyledSelect id="imp-detect-account-select" className="field-input" value={accId || ''} onChange={(e) => setAccId(e.target.value)}>
                <option value="" disabled>Select account…</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{accLabel(a)} ({a.owner})</option>)}
              </StyledSelect>
            </div>
            <span className="imp-hint"><Icon name="info" size={11} />This becomes the default account for every row — you can still change individual rows in the next step.</span>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════ STEP 2' — Account identity only (no movements) ═══════════════
  // Terminal step for statements that describe an account but carry no rows.
  function IdentityStep({ doc, accounts, resolveSource, onPick, onCreate }) {
    const detected = doc.statementAccounts || [];
    const unresolved = detected.filter(rec => !resolveSource(rec.source)).length;
    return (
      <div className="imp-detect">
        <div className="imp-doc-card">
          <span className="imp-doc-ico"><Icon name="file-text" size={18} /></span>
          <div className="imp-doc-meta">
            <span className="imp-doc-name">{doc.fileName}</span>
            <span className="imp-doc-sub">{doc.institution} · no transactions</span>
          </div>
        </div>

        <div className="imp-nomatch-banner" id="imp-identity-note">
          <Icon name="info" size={14} />
          {doc.note || 'This statement contains no transactions.'}
        </div>

        <div className="imp-field">
          <span className="field-label">Detected Account{detected.length > 1 ? 's' : ''}</span>
          {unresolved === 0
            ? <div className="imp-match-banner"><Icon name="badge-check" size={14} />Account is set up — nothing further to import from this file.</div>
            : null}
          <div className="imp-src-list">
            {detected.map(rec => (
              <SourceRow key={rec.source} rec={rec} accounts={accounts}
                value={resolveSource(rec.source)} onPick={onPick} onCreate={onCreate} />
            ))}
          </div>
          <span className="imp-hint"><Icon name="info" size={11} />Create the account now and it will be matched by IBAN when you import a statement that does have movements.</span>
        </div>
      </div>
    );
  }

  // Amount field — displays grouped like the Accounts balance (`grp`, e.g.
  // "3,360.31"), yet stays editable: shows raw digits while focused (so the
  // thousands separators don't fight the caret) and reformats on blur. The sign
  // and currency symbol live in the sibling `.imp-amt-sign` span.
  function AmountInput({ id, amount, onAmount }) {
    const [editing, setEditing] = React.useState(null);
    const value = editing != null ? editing : grp(amount);
    return (
      <input id={id} type="text" inputMode="decimal" className="imp-cell imp-amt"
        value={value}
        onFocus={() => setEditing(Math.abs(amount) === 0 ? '' : String(Math.abs(amount)))}
        onBlur={() => setEditing(null)}
        onChange={(e) => {
          setEditing(e.target.value);
          const v = parseFloat(e.target.value.replace(/,/g, '')) || 0;
          onAmount(amount < 0 ? -v : v);
        }} />
    );
  }

  // ── DateInput — same flatpickr control the "Add Spending" modal uses ──────
  // Accounts.html doesn't load controls.jsx (which owns the shared DateInput),
  // so this is a self-contained twin: readonly text field + calendar icon +
  // the app's themed flatpickr popup, styled identically via .date-input-wrap /
  // datepicker.css. `wrapClassName` lets the wrapper carry the grid-cell area so
  // the inner input keeps the .imp-cell look.
  if (!window.HL_enhanceFpYear) {
    window.HL_enhanceFpYear = function (fp) {
      const head = fp.calendarContainer &&
        fp.calendarContainer.querySelector('.flatpickr-current-month');
      const numWrap = head && head.querySelector('.numInputWrapper');
      if (!numWrap || numWrap.dataset.hlYear) return;
      const today = new Date();
      const minYear = fp.config.minDate ? fp.config.minDate.getFullYear() : today.getFullYear() - 80;
      let maxYear = fp.config.maxDate ? fp.config.maxDate.getFullYear() : today.getFullYear() + 10;
      if (maxYear < minYear) maxYear = minYear;
      const sel = document.createElement('select');
      sel.className = 'flatpickr-yearDropdown-years';
      sel.setAttribute('aria-label', 'Year');
      for (let y = maxYear; y >= minYear; y--) {
        const o = document.createElement('option');
        o.value = String(y);
        o.textContent = String(y);
        sel.appendChild(o);
      }
      sel.value = String(fp.currentYear);
      sel.addEventListener('change', (e) => fp.changeYear(parseInt(e.target.value, 10)));
      numWrap.dataset.hlYear = '1';
      numWrap.style.display = 'none';
      numWrap.parentNode.insertBefore(sel, numWrap.nextSibling);
      fp._hlYearSelect = sel;
    };
  }

  function DateInput({ id, value, onChange, className, wrapClassName }) {
    const inputRef = React.useRef(null);
    const fpRef = React.useRef(null);

    React.useEffect(() => {
      if (!inputRef.current || typeof flatpickr === 'undefined') return;
      fpRef.current = flatpickr(inputRef.current, {
        dateFormat: 'Y-m-d',
        defaultDate: value || null,
        disableMobile: true,
        monthSelectorType: 'dropdown',
        onReady: (_, __, fp) => window.HL_enhanceFpYear(fp),
        onYearChange: (_, __, fp) => { if (fp._hlYearSelect) fp._hlYearSelect.value = String(fp.currentYear); },
        onChange: (_, dateStr) => onChange({ target: { value: dateStr } }),
      });
      return () => { if (fpRef.current) { fpRef.current.destroy(); fpRef.current = null; } };
    }, []); // eslint-disable-line

    React.useEffect(() => {
      if (!fpRef.current) return;
      const cur = fpRef.current.selectedDates[0]
        ? fpRef.current.formatDate(fpRef.current.selectedDates[0], 'Y-m-d') : '';
      if (value !== cur) fpRef.current.setDate(value || null, false);
    }, [value]);

    return (
      <div className={'date-input-wrap ' + (wrapClassName || '')}>
        <input id={id} ref={inputRef} type="text" className={className || 'field-input'}
          placeholder="YYYY-MM-DD" readOnly />
        <span className="date-input-icon"><Icon name="calendar" size={14} /></span>
      </div>
    );
  }

  // ═══════════════ STEP 3 — Review & edit ═══════════════
  function ReviewRow({ row, idx, update, remove, accounts }) {
    return (
      <div className={'imp-rev-row' + (row.include ? '' : ' excluded')}>
        <button id={'imp-row-' + idx + '-include-btn'} className="imp-inc" onClick={() => update(idx, { include: !row.include })} title={row.include ? 'Exclude row' : 'Include row'}>
          <Icon name={row.include ? 'check-square' : 'square'} size={16} />
        </button>
        <DateInput id={'imp-row-' + idx + '-date-input'} className="imp-cell imp-date" wrapClassName="imp-date-wrap" value={row.date} onChange={(e) => update(idx, { date: e.target.value })} />
        <input id={'imp-row-' + idx + '-desc-input'} className="imp-cell imp-desc" placeholder="Description" title="Transaction description" value={row.desc} onChange={(e) => update(idx, { desc: e.target.value })} />
        <div className="imp-cell-cat">
          <StyledSelect id={'imp-row-' + idx + '-cat-select'} className="imp-cell imp-catsel" value={row.cat} onChange={(e) => update(idx, { cat: e.target.value })}>
            {Object.keys(CATS).map(k => <option key={k} value={k}>{CATS[k].label}</option>)}
          </StyledSelect>
        </div>
        <div className={'imp-amt-wrap ' + (row.amount >= 0 ? 'pos' : 'neg')}>
          <span className="imp-amt-sign">{row.amount >= 0 ? '+' : '−'}{SYM[row.cur]}</span>
          <AmountInput id={'imp-row-' + idx + '-amount-input'} amount={row.amount}
            onAmount={(v) => update(idx, { amount: v })} />
          <button id={'imp-row-' + idx + '-flip-btn'} className="imp-amt-flip" title="Flip income/expense" onClick={() => update(idx, { amount: -row.amount })}><Icon name="repeat" size={11} /></button>
        </div>
        <StyledSelect id={'imp-row-' + idx + '-account-select'} className="imp-cell imp-acc" value={row.accId || ''} onChange={(e) => update(idx, { accId: e.target.value })}>
          <option value="" disabled>Account…</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}
        </StyledSelect>
        <button id={'imp-row-' + idx + '-delete-btn'} className="imp-del" onClick={() => remove(idx)} title="Remove row"><Icon name="trash-2" size={13} /></button>
      </div>
    );
  }

  function ReviewStep({ rows, setRows, accounts }) {
    const update = (i, patch) => setRows(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
    const remove = (i) => setRows(prev => prev.filter((_, j) => j !== i));
    const incl = rows.filter(r => r.include);
    const allOn = incl.length === rows.length && rows.length > 0;

    return (
      <div className="imp-pane imp-review">
        <div className="imp-rev-head">
          <button id="imp-bulk-select-btn" className="imp-bulk" onClick={() => setRows(prev => prev.map(r => ({ ...r, include: !allOn })))}>
            <Icon name={allOn ? 'check-square' : 'square'} size={14} />{allOn ? 'Deselect all' : 'Select all'}
          </button>
          <span className="imp-rev-count">{incl.length} of {rows.length} rows selected for import</span>
        </div>
        <div className="imp-rev-table">
          <div className="imp-rev-thead">
            <span></span><span>DATE</span><span>DESCRIPTION</span><span>CATEGORY</span><span className="ar">AMOUNT</span><span>RELATED ACCOUNT</span><span></span>
          </div>
          <div className="imp-rev-body">
            {rows.map((r, i) => <ReviewRow key={r.key} row={r} idx={i} update={update} remove={remove} accounts={accounts} />)}
            {rows.length === 0 && <div className="imp-rev-empty"><Icon name="inbox" size={24} />All rows removed.</div>}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════ STEP 4 — Done ═══════════════
  function DoneStep({ result }) {
    return (
      <div className="imp-pane imp-done">
        <div className="imp-done-ico"><Icon name="check-check" size={34} /></div>
        <span className="imp-done-t">Import Complete</span>
        <span className="imp-done-s">
          {result.count} transaction{result.count !== 1 ? 's' : ''} imported across {result.accounts} account{result.accounts !== 1 ? 's' : ''}
          {result.skipped ? ' · ' + result.skipped + ' duplicate' + (result.skipped !== 1 ? 's' : '') + ' skipped' : ''}.
        </span>
        <div className="imp-done-grid">
          {result.perAccount.map(p => (
            <div className="imp-done-row" key={p.accId}>
              <span className="imp-done-acc">{p.name}</span>
              <span className="imp-done-n">{p.n} rows</span>
              <span className={'imp-done-delta ' + (p.delta >= 0 ? 'pos' : 'neg')}>{p.delta >= 0 ? '+' : '−'}{SYM[p.cur]}{grp(p.delta)}</span>
            </div>
          ))}
        </div>
        {result.creditPayments && result.creditPayments.length > 0 && (
          <div className="imp-done-cp" id="imp-done-credit-payments">
            <Icon name="credit-card" size={13} />
            Created {result.creditPayments.length} Credit Payment{result.creditPayments.length !== 1 ? 's' : ''} with the statement attached: {result.creditPayments.join(', ')}
          </div>
        )}
        {result.statements && result.statements.length > 0 && (
          <div className="imp-done-cp" id="imp-done-statements">
            <Icon name="files" size={13} />
            Created {result.statements.length} Statement{result.statements.length !== 1 ? 's' : ''} with the document attached: {result.statements.join(', ')}
          </div>
        )}
      </div>
    );
  }

  // ═══════════════ STEP 3′ — Review holdings (broker portfolio) ═══════════════
  function InvReviewRow({ row, idx, update, remove }) {
    return (
      <div className={'imp-inv-row' + (row.include ? '' : ' excluded')}>
        <button id={'imp-inv-' + idx + '-include-btn'} className="imp-inc" onClick={() => update(idx, { include: !row.include })} title={row.include ? 'Exclude holding' : 'Include holding'}>
          <Icon name={row.include ? 'check-square' : 'square'} size={16} />
        </button>
        <span className="imp-inv-ticker mono" title={row.ticker}>{row.ticker}</span>
        <input id={'imp-inv-' + idx + '-name-input'} className="imp-cell imp-inv-name" placeholder="Asset name" title="Asset name" value={row.name} onChange={(e) => update(idx, { name: e.target.value })} />
        <StyledSelect id={'imp-inv-' + idx + '-type-select'} className="imp-cell imp-inv-type" value={row.assetType} onChange={(e) => update(idx, { assetType: e.target.value })}>
          {ASSET_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </StyledSelect>
        <input id={'imp-inv-' + idx + '-qty-input'} type="number" step="any" className="imp-cell imp-inv-qty" title="Quantity held" value={row.qty} onChange={(e) => update(idx, { qty: parseFloat(e.target.value) || 0 })} />
        <div className="imp-inv-cost-wrap">
          <span className="imp-amt-sign">{SYM[row.cur]}</span>
          <input id={'imp-inv-' + idx + '-cost-input'} type="number" step="0.01" className="imp-cell imp-inv-cost" title="Average cost per unit" value={row.cost} onChange={(e) => update(idx, { cost: parseFloat(e.target.value) || 0 })} />
        </div>
        <span className="imp-inv-value" title="Current market value (from statement)">{SYM[row.cur]}{grp(row.value)}</span>
        <button id={'imp-inv-' + idx + '-delete-btn'} className="imp-del" onClick={() => remove(idx)} title="Remove holding"><Icon name="trash-2" size={13} /></button>
      </div>
    );
  }

  function InvReviewStep({ rows, setRows, summary }) {
    const update = (i, patch) => setRows(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
    const remove = (i) => setRows(prev => prev.filter((_, j) => j !== i));
    const incl = rows.filter(r => r.include);
    const allOn = incl.length === rows.length && rows.length > 0;
    const cur = rows.length ? rows[0].cur : 'TRY';

    return (
      <div className="imp-pane imp-review">
        {summary && (
          <div className="imp-inv-summary">
            <div className="imp-stat"><span className="imp-stat-k">Cash Balance</span><span className="imp-stat-v">{SYM[cur]}{grp(summary.cash || 0)}</span></div>
            <div className="imp-stat"><span className="imp-stat-k">Portfolio Value</span><span className="imp-stat-v pos">{SYM[cur]}{grp(summary.total || 0)}</span></div>
            <div className="imp-stat"><span className="imp-stat-k">Holdings</span><span className="imp-stat-v">{rows.length}</span></div>
          </div>
        )}
        <div className="imp-rev-head">
          <button id="imp-inv-bulk-select-btn" className="imp-bulk" onClick={() => setRows(prev => prev.map(r => ({ ...r, include: !allOn })))}>
            <Icon name={allOn ? 'check-square' : 'square'} size={14} />{allOn ? 'Deselect all' : 'Select all'}
          </button>
          <span className="imp-rev-count">{incl.length} of {rows.length} holdings selected · existing positions are updated in place</span>
        </div>
        <div className="imp-rev-table imp-inv-table">
          <div className="imp-inv-thead">
            <span></span><span>SYMBOL</span><span>NAME</span><span>TYPE</span><span className="ar">QTY</span><span className="ar">AVG COST</span><span className="ar">VALUE</span><span></span>
          </div>
          <div className="imp-rev-body">
            {rows.map((r, i) => <InvReviewRow key={r.key} row={r} idx={i} update={update} remove={remove} />)}
            {rows.length === 0 && <div className="imp-rev-empty"><Icon name="inbox" size={24} />All holdings removed.</div>}
          </div>
        </div>
      </div>
    );
  }

  function InvDoneStep({ result }) {
    return (
      <div className="imp-pane imp-done">
        <div className="imp-done-ico"><Icon name="check-check" size={34} /></div>
        <span className="imp-done-t">Portfolio Imported</span>
        <span className="imp-done-s">
          {result.created} investment{result.created !== 1 ? 's' : ''} created
          {result.updated ? ' · ' + result.updated + ' updated' : ''}.
        </span>
        <div className="imp-done-grid">
          {result.holdings.map(h => (
            <div className="imp-done-row" key={h.key}>
              <span className="imp-done-acc mono">{h.ticker}</span>
              <span className="imp-done-n">{grp(h.qty, 0)} @ {SYM[h.cur]}{grp(h.cost)}</span>
              <span className="imp-done-delta pos">{SYM[h.cur]}{grp(h.value)}</span>
            </div>
          ))}
        </div>
        {result.accounts && result.accounts.length > 0 && (
          <div className="imp-done-cp" id="imp-done-invest-account">
            <Icon name="trending-up" size={13} />
            Created investment account{result.accounts.length !== 1 ? 's' : ''}: {result.accounts.join(', ')} — open it on the Accounts page to see these holdings.
          </div>
        )}
      </div>
    );
  }

  // ═══════════════ STEP 3″ — Review BES funds (retirement plan) ═══════════════
  function PenReviewStep({ pension, rows, setRows }) {
    const update = (i, patch) => setRows(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
    const remove = (i) => setRows(prev => prev.filter((_, j) => j !== i));
    const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
    // Investment return is derived exactly as the detail view derives it, so what
    // you see here is what the account will show.
    const ret = (pension.total != null && pension.state_contribution != null && pension.total_paid != null)
      ? +(pension.total - pension.state_contribution - pension.total_paid).toFixed(2) : null;

    return (
      <div className="imp-pane imp-review">
        <div className="imp-pen-id" id="imp-pen-identity">
          <Icon name="piggy-bank" size={14} />
          <span className="imp-pen-plan">{pension.plan || 'Retirement Plan'}</span>
          <span className="imp-pen-contract mono">Contract {pension.contract_no || '—'}</span>
        </div>

        <div className="imp-inv-summary">
          <div className="imp-stat"><span className="imp-stat-k">Total Savings</span><span className="imp-stat-v">₺{grp(pension.total || 0)}</span></div>
          <div className="imp-stat"><span className="imp-stat-k">Paid In</span><span className="imp-stat-v">₺{grp(pension.total_paid || 0)}</span></div>
          <div className="imp-stat"><span className="imp-stat-k">State Contrib.</span><span className="imp-stat-v pos">₺{grp(pension.state_contribution || 0)}</span></div>
          {ret != null && <div className="imp-stat"><span className="imp-stat-k">Return</span><span className={'imp-stat-v ' + (ret < 0 ? 'neg' : 'pos')}>{ret < 0 ? '−' : ''}₺{grp(ret)}</span></div>}
        </div>

        {(pension.next_payment_date || pension.next_payment_amount != null) && (
          <div className="imp-pen-next" id="imp-pen-next-payment">
            <Icon name="calendar-clock" size={12} />
            Next payment {fmtDateTr(pension.next_payment_date)}
            {pension.next_payment_amount != null && <b> · ₺{grp(pension.next_payment_amount)}</b>}
          </div>
        )}

        <div className="imp-rev-head">
          <span className="imp-rev-count">
            {rows.length} fund{rows.length !== 1 ? 's' : ''} · the plan's fund split is replaced by this statement
          </span>
        </div>
        <div className="imp-rev-table imp-pen-table">
          <div className="imp-pen-thead">
            <span>FUND</span><span className="ar">SHARE</span><span className="ar">VALUE</span><span></span>
          </div>
          <div className="imp-rev-body">
            {rows.map((r, i) => (
              <div className="imp-pen-row" key={r.key}>
                <input id={'imp-pen-' + i + '-name-input'} className="imp-cell imp-pen-name" title="Fund name"
                  value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                <span className="imp-pen-pct mono" title={r.state ? 'State contribution fund' : 'Participant fund'}>
                  {r.state && <Icon name="landmark" size={10} />}{grp(r.pct)}%
                </span>
                <div className="imp-pen-val-wrap">
                  <span className="imp-amt-sign">₺</span>
                  <input id={'imp-pen-' + i + '-value-input'} type="number" step="0.01" className="imp-cell imp-pen-val" title="Value in TRY"
                    value={r.value} onChange={(e) => update(i, { value: parseFloat(e.target.value) || 0 })} />
                </div>
                <button id={'imp-pen-' + i + '-delete-btn'} className="imp-del" onClick={() => remove(i)} title="Remove fund"><Icon name="trash-2" size={13} /></button>
              </div>
            ))}
            {rows.length === 0 && <div className="imp-rev-empty"><Icon name="inbox" size={24} />All funds removed.</div>}
          </div>
        </div>
        <div className="imp-pen-foot" id="imp-pen-reconcile">
          <span>Funds total</span>
          <span className={'mono' + (Math.abs(total - (pension.total || 0)) < 0.01 ? ' ok' : ' warn')}>
            ₺{grp(total)}{Math.abs(total - (pension.total || 0)) >= 0.01 ? ' ≠ ₺' + grp(pension.total || 0) : ''}
          </span>
        </div>
      </div>
    );
  }

  function PenDoneStep({ result }) {
    return (
      <div className="imp-pane imp-done">
        <div className="imp-done-ico"><Icon name="check-check" size={34} /></div>
        <span className="imp-done-t">Retirement Plan Imported</span>
        <span className="imp-done-s">
          {result.account_name} · ₺{grp(result.balance || 0)}
        </span>
        <div className="imp-done-grid">
          {result.funds.map(f => (
            <div className="imp-done-row" key={f.key}>
              <span className="imp-done-acc">{f.name}</span>
              <span className="imp-done-n">{grp(f.pct)}%</span>
              <span className="imp-done-delta pos">₺{grp(f.value)}</span>
            </div>
          ))}
        </div>
        <div className="imp-done-cp" id="imp-done-pension-account">
          <Icon name="piggy-bank" size={13} />
          {result.account_created ? 'Created' : 'Updated'} retirement plan account — {result.funds_created} fund{result.funds_created !== 1 ? 's' : ''} added
          {result.funds_updated ? ', ' + result.funds_updated + ' updated' : ''}
          {result.funds_removed ? ', ' + result.funds_removed + ' removed' : ''}. Open it on the Accounts page.
        </div>
      </div>
    );
  }

  // ═══════════════ Wizard shell ═══════════════
  function ImportWizard({ preAccId, onClose, onCommit }) {
    const [step, setStep] = React.useState('choose');
    const [format, setFormat] = React.useState('csv');
    const [selected, setSelected] = React.useState(null);     // sample doc id
    const [pickedFile, setPickedFile] = React.useState(null); // real File
    const [accId, setAccId] = React.useState(null);
    const [rows, setRows] = React.useState([]);
    const [doc, setDoc] = React.useState(null);               // normalized statement
    const [result, setResult] = React.useState(null);
    const [mode, setMode] = React.useState('tx');             // 'tx' | 'inv' (broker portfolio) | 'pen' (BES) | 'identity' (account, no movements)
    const [invRows, setInvRows] = React.useState([]);         // editable holdings
    const [invSummary, setInvSummary] = React.useState(null); // { cash, total, period_* }
    const [invResult, setInvResult] = React.useState(null);   // { created, updated, holdings }
    const [penSummary, setPenSummary] = React.useState(null); // BES figures (accounts.pension shape)
    const [penRows, setPenRows] = React.useState([]);         // editable funds
    const [penResult, setPenResult] = React.useState(null);   // confirm-pension response + funds
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(null);
    const [sourceMap, setSourceMap] = React.useState({});     // statement source → chosen account id
    const [createDraft, setCreateDraft] = React.useState(null); // AccountFormModal initial (pre-filled)
    const createSrcRef = React.useRef(null);                  // source the draft is being created for

    // Hydrate accounts from the backend (the static placeholder is empty).
    const seed = (window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.ACCOUNTS) || [];
    const [accounts, setAccounts] = React.useState(seed);
    React.useEffect(() => {
      if (window.HL_ACCOUNTS_API) {
        window.HL_ACCOUNTS_API.list().then(setAccounts).catch(() => {});
      }
    }, []);

    const ownerOf = (id) => { const a = accounts.find(x => x.id === id); return a ? a.owner : null; };
    const canContinue = !!pickedFile || !!selected;

    // True once the wizard has written anything to the backend (an account created
    // from a statement identity, a committed import). From that point the host
    // page's list behind the modal is stale, so closing has to re-hydrate it —
    // the commit paths are not the only way to leave the wizard dirty (identity
    // mode never commits at all, it just creates the account and ends).
    const dirtyRef = React.useRef(false);

    // Re-hydrate the host page now; clears the flag so closing afterwards doesn't
    // fetch a second time.
    function refreshHost(importedRows, byAccount) {
      dirtyRef.current = false;
      onCommit && onCommit(importedRows || [], byAccount || {});
    }

    function closeWizard() {
      if (dirtyRef.current) refreshHost([], {});
      onClose();
    }

    // Resolve a statement source to an account id: an explicit pick wins, otherwise
    // auto-match by IBAN / card number. Returns null when still unmapped.
    function resolveSource(source) {
      if (sourceMap[source]) return sourceMap[source];
      const rec = (doc && doc.statementAccounts || []).find(r => r.source === source);
      const m = rec ? matchStatementAccount(accounts, rec) : matchBySource(accounts, source);
      return m ? m.id : null;
    }

    // Detect step is satisfied when every detected source resolves to an account
    // (the "create the account first" gate). Falls back to the doc-level account
    // for statements that surfaced no identities (sample/simple-parser path).
    const detected = (doc && doc.statementAccounts) || [];
    const allResolved = detected.length ? detected.every(rec => !!resolveSource(rec.source)) : !!accId;

    const pickSource = (source, id) => setSourceMap(prev => ({ ...prev, [source]: id }));
    const openCreate = (rec) => { createSrcRef.current = rec.source; setCreateDraft(accountDraftFromRecord(rec)); };

    // Persist a brand-new account created from a statement identity, then map its
    // source to it so the row auto-resolves.
    async function saveNewAccount(formResult) {
      if (!window.HL_ACCOUNTS_API) { setError('Accounts API unavailable — cannot create the account.'); return; }
      setError(null);
      try {
        const created = await window.HL_ACCOUNTS_API.create(formResult);
        setAccounts(prev => [...prev, created]);
        dirtyRef.current = true;
        const src = createSrcRef.current;
        if (src) setSourceMap(prev => ({ ...prev, [src]: created.id }));
      } catch (e) {
        setError(e.message || 'Could not create the account.');
        return;
      }
      createSrcRef.current = null;
      setCreateDraft(null);
    }

    async function goDetect() {
      setError(null);
      if (pickedFile) {
        setBusy(true);
        try {
          const res = await window.HL_IMPORT_API.preview(pickedFile, 'auto');
          // BES birikim özeti → a "pension" Account + its fund split. Like the
          // broker path, the statement identifies its own account (by contract
          // number), so the account-detection step is skipped.
          if (res.kind === 'pension') {
            const funds = res.funds || [];
            if (!funds.length) {
              setError('No funds could be parsed from this retirement plan statement.');
              setBusy(false);
              return;
            }
            setMode('pen');
            setPenSummary(res.pension || {});
            setPenRows(funds.map((f, i) => ({
              key: 'f' + i,
              name: f.name || '',
              pct: Number(f.pct) || 0,
              state: !!f.state,
              value: Number(f.value) || 0,
            })));
            setDoc({ fileName: pickedFile.name, format: formatOf(pickedFile.name),
              institution: res.bank_detected || 'Pension' });
            setStep('review');
            setBusy(false);
            return;
          }
          // Broker portfolio statement (Midas) → holdings become Investments,
          // skipping the account-detection step entirely.
          if (res.kind === 'investments') {
            const holdings = res.investments || [];
            if (!holdings.length) {
              setError('No portfolio holdings could be parsed from this file.');
              setBusy(false);
              return;
            }
            setMode('inv');
            setInvSummary(res.portfolio || null);
            setInvRows(holdings.map((h, i) => ({
              key: 'h' + i,
              include: true,
              ticker: h.ticker || (h.name || '').split(' - ')[0],
              name: h.name || '',
              assetType: h.asset_type || 'stock',
              cur: h.currency || 'TRY',
              qty: Number(h.amount) || 0,
              cost: h.purchase_price != null ? Number(h.purchase_price) : 0,
              value: Number(h.current_value) || 0,
            })));
            setDoc({ fileName: pickedFile.name, format: formatOf(pickedFile.name),
              institution: res.bank_detected || 'Broker' });
            setStep('review');
            setBusy(false);
            return;
          }
          if (!res.rows || !res.rows.length) {
            // A statement can legitimately carry an account identity but no
            // movements (e.g. a TEB dijital hesap cüzdanı for a dormant or
            // newly-opened account). Don't dead-end — let the user create or
            // match the account the file describes.
            const idOnly = (res.accounts || []).filter(a => a && a.source);
            if (idOnly.length) {
              setMode('identity');
              // Keyed `statementAccounts` like the tx path, so resolveSource()
              // auto-matches these by IBAN rather than falling back to last-4.
              setDoc({ fileName: pickedFile.name, format: formatOf(pickedFile.name),
                institution: res.bank_detected || 'Bank',
                note: res.has_movements
                  ? 'This statement lists movements, but no transaction parser exists for its layout yet — only the account was read.'
                  : 'This statement covers a period with no movements — only the account was read.',
                statementAccounts: idOnly });
              setStep('identity');
              setBusy(false);
              return;
            }
            setError('No transactions could be parsed from this file.');
            setBusy(false);
            return;
          }
          setMode('tx');
          const norm = normalizePreview(pickedFile, res);
          setDoc(norm);
          const matched = matchBySource(accounts, norm.accountNumber);
          setAccId(preAccId || (matched ? matched.id : null));
          setStep('detect');
        } catch (e) {
          setError(e.message || 'Could not parse the statement.');
        }
        setBusy(false);
      } else {
        const d = DOCUMENTS.find(x => x.id === selected);
        setDoc(d);
        const matched = findByNumber(accounts, d.accountNumber);
        setAccId(preAccId || (matched ? matched.id : null));
        setStep('detect');
      }
    }

    function goReview() {
      // Build editable rows. Category is taken from the Turkish "Etiket" tag when
      // mappable (falling back to keyword guessing); the account is auto-mapped per
      // card/source, falling back to the document-level account when unmatched.
      // Keep the bank's ORIGINAL description casing verbatim for every source —
      // never Title-case or normalize it. Some line items carry meaningful mixed
      // casing (e.g. "Sadun Sevıngen--EFT-CEP ŞUBE", "K.Kartı Ödeme") that must be
      // preserved exactly as the bank sent it.
      // Sources that resolve to a bank account (drives the "Diğer/Other → Transfer"
      // rule, which is scoped to bank statements — see guessCategory).
      const bankSources = new Set(
        (doc.statementAccounts || []).filter(a => a.type === 'bank').map(a => a.source));
      const built = doc.rows.map((r, i) => {
        const etiket = r[4];
        return {
          key: 'r' + i,
          include: true,
          date: r[0],
          desc: r[1],
          cat: r[6] || guessCategory(r[1], r[2] >= 0, etiket, bankSources.has(r[5])),
          amount: r[2],
          cur: r[3],
          accId: resolveSource(r[5]) || accId,
        };
      });
      setRows(built);
      setStep('review');
    }

    // Persist a reviewed BES statement: the backend upserts the pension Account by
    // contract number and rewrites its fund split in one call.
    async function commitPension() {
      setError(null);
      setBusy(true);
      let outcome;
      try {
        outcome = await window.HL_IMPORT_API.confirmPension(
          { ...penSummary, total: penRows.reduce((s, r) => s + (Number(r.value) || 0), 0) },
          penRows.map(r => ({ name: r.name, pct: r.pct, state: r.state, value: r.value })),
        );
      } catch (e) {
        setError(e.message || 'Import failed.');
        setBusy(false);
        return;
      }
      setBusy(false);
      setPenResult({ ...outcome, funds: penRows });
      // Re-hydrate the parent Accounts list so the plan and its new balance show.
      refreshHost([], {});
      setStep('done');
    }

    // Persist reviewed broker holdings as Investments (upsert by platform+symbol).
    async function commitInvestments() {
      setError(null);
      const incl = invRows.filter(r => r.include);
      const holdings = incl.map(r => ({
        ticker: r.ticker,
        name: r.name,
        platform: 'Midas',
        asset_type: r.assetType,
        currency: r.cur,
        amount: r.qty,
        purchase_price: r.cost,
      }));
      setBusy(true);
      let outcome;
      try {
        outcome = await window.HL_IMPORT_API.confirmInvestments(holdings, true);
      } catch (e) {
        setError(e.message || 'Import failed.');
        setBusy(false);
        return;
      }
      // Auto-create an "invest"-type account per platform so the holdings surface
      // under it on the Accounts page (matched by platform == account name). Skip
      // platforms that already have an invest account. Non-fatal: the Investment
      // records are already saved above.
      const createdAccounts = [];
      const platforms = [...new Set(incl.map(r => r.platform || 'Midas'))];
      if (window.HL_ACCOUNTS_API) {
        for (const p of platforms) {
          const exists = accounts.some(a => a.type === 'invest' && (a.name || '').trim().toLowerCase() === p.trim().toLowerCase());
          if (exists) continue;
          const mine = incl.filter(r => (r.platform || 'Midas') === p);
          // Portfolio value: statement total when it's the only platform, else the
          // sum of the platform's holdings' market value (cost basis as fallback).
          const value = (platforms.length === 1 && invSummary && invSummary.total)
            ? invSummary.total
            : +mine.reduce((s, r) => s + (Number(r.value) || (r.qty * (r.cost || 0))), 0).toFixed(2);
          const cur = (mine[0] && mine[0].cur) || 'TRY';
          try {
            const acc = await window.HL_ACCOUNTS_API.create({ type: 'invest', name: p, owner: 'Sadun', cur, balance: value, institution: p });
            createdAccounts.push(acc.name);
          } catch (e) { /* non-fatal: holdings still imported */ }
        }
      }

      setBusy(false);
      setInvResult({ created: outcome.created || 0, updated: outcome.updated || 0, holdings: incl, accounts: createdAccounts });
      // Refresh the parent Accounts list — a freshly created invest account has to
      // appear, and an existing one's holdings changed underneath it either way.
      refreshHost([], {});
      setStep('done');
    }

    async function commit() {
      setError(null);
      const incl = rows.filter(r => r.include);

      // Persist the reviewed rows as real transactions.
      const backendRows = incl.map(r => ({
        date: r.date,
        amount: Math.abs(r.amount),
        type: r.amount >= 0 ? 'income' : 'expense',
        currency: r.cur,
        description: r.desc,
        category_key: r.cat,
        payment_method: r.accId || null,
        payer: ownerOf(r.accId),
      }));

      setBusy(true);
      let outcome;
      try {
        outcome = await window.HL_IMPORT_API.confirm(backendRows, true, doc.fileName);
      } catch (e) {
        setError(e.message || 'Import failed.');
        setBusy(false);
        return;
      }
      setBusy(false);

      // Credit-card statement summary → create a dedicated Credit Payments record
      // (with the uploaded extract attached) instead of a loose "Credit Card Payment"
      // spending. The backend auto-links every imported purchase in the statement
      // window to the record, so the extract is viewable on the Credit Payments page.
      // Non-fatal: the purchase rows are already saved above.
      const createdCP = [];
      const stmts = (doc.statementAccounts || []).filter(
        rec => rec.type === 'credit' && rec.payment_due && rec.total);
      for (const rec of stmts) {
        const cardId = resolveSource(rec.source);        // 'acc-N' account key
        const acct = accounts.find(a => a.id === cardId);
        if (!acct) continue;
        // Persist the statement's Last Payment Date on the card (unchanged behavior).
        try {
          await window.HL_ACCOUNTS_API.update(acct._dbId, { ...acct, paymentDue: rec.payment_due });
        } catch (e) { /* non-fatal */ }
        // "Dönemiçi İşlemler" (interim, in-period) dumps are not a billed statement —
        // their total is a running period sum, not the final debt — so never create a
        // Credit Payment record from them (the purchase rows are still imported above).
        if (rec.interim) continue;
        if (!window.HL_CREDIT_PAYMENTS_API) continue;
        try {
          // Cutover ≈ the statement's last transaction date for this card; the backend
          // links purchases dated within (cutover − 1 month, cutover] to the record.
          const cardDates = incl.filter(r => r.accId === cardId).map(r => r.date).sort();
          const cutover = cardDates.length ? cardDates[cardDates.length - 1] : rec.payment_due;
          const [cy, cm] = String(cutover || rec.payment_due).split('-');
          const cp = await window.HL_CREDIT_PAYMENTS_API.create({
            accountId: acct._dbId,
            year: Number(cy),
            month: Number(cm),
            cutoverDate: cutover,
            paymentDate: rec.payment_due,
            total: rec.total,
            minimum: rec.minimum || rec.min_payment || 0,
            cur: rec.currency || 'TRY',
          });
          // Attach the uploaded statement to the record (stores the file; does not
          // re-import rows). Skipped on the sample-document path where there is no file.
          if (pickedFile) {
            try { await window.HL_CREDIT_PAYMENTS_API.previewStatement(cp.id, pickedFile); }
            catch (e) { /* attachment failed; the record + its links still stand */ }
          }
          createdCP.push(cp);
        } catch (e) { /* non-fatal: purchases already imported, just no CP record */ }
      }

      // Bank-account statements are archived as Statement records with the uploaded
      // file attached — the bank twin of the Credit Payment above. Card accounts are
      // deliberately skipped: their ekstre already produced a Credit Payment and must
      // not be archived twice. Non-fatal: the movements are already saved.
      const createdStatements = [];
      if (window.HL_STATEMENTS_API) {
        const ARCHIVE_TYPES = window.HL_STATEMENTS_API.STATEMENT_TYPES;
        const rowsByAcc = {};
        incl.forEach(r => { (rowsByAcc[r.accId] = rowsByAcc[r.accId] || []).push(r); });
        for (const accKey of Object.keys(rowsByAcc)) {
          const acct = accounts.find(a => a.id === accKey);
          if (!acct || ARCHIVE_TYPES.indexOf(acct.type) === -1) continue;
          const mine = rowsByAcc[accKey];
          const dates = mine.map(r => r.date).filter(Boolean).sort();
          const from = dates[0] || null;
          const to = dates[dates.length - 1] || null;
          // The record's period (and therefore its "YYYY.MM - Account Name") is keyed
          // on the LAST movement — a statement is named for the month it closes in.
          const [py, pm] = String(to || from || '').split('-');
          const ident = (doc.statementAccounts || []).find(s => resolveSource(s.source) === accKey);
          try {
            const st = await window.HL_STATEMENTS_API.create({
              accountId: acct._dbId,
              year: Number(py) || new Date().getFullYear(),
              month: Number(pm) || (new Date().getMonth() + 1),
              from, to,
              cur: mine[0].cur || 'TRY',
              moneyIn: +mine.filter(r => r.amount >= 0).reduce((s, r) => s + r.amount, 0).toFixed(2),
              moneyOut: +mine.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0).toFixed(2),
              closingBalance: ident && ident.balance != null ? ident.balance : null,
              bank: doc.institution || null,
            });
            if (pickedFile) {
              try { await window.HL_STATEMENTS_API.attachFile(st.id, pickedFile); }
              catch (e) { /* attachment failed; the record + its links still stand */ }
            }
            createdStatements.push(st);
          } catch (e) { /* non-fatal: movements already imported, just no record */ }
        }
      }

      // Per-account summary for the Done screen + the host's balance sync.
      const byAcc = {};
      incl.forEach(r => {
        if (!byAcc[r.accId]) byAcc[r.accId] = { delta: 0, n: 0 };
        byAcc[r.accId].delta += r.amount;
        byAcc[r.accId].n += 1;
      });
      const perAccount = Object.keys(byAcc).map(id => {
        const a = accounts.find(x => x.id === id);
        return { accId: id, name: a ? a.name : id, cur: a ? a.cur : 'TRY', n: byAcc[id].n, delta: byAcc[id].delta };
      });
      setResult({ count: outcome.imported, skipped: outcome.skipped || 0, accounts: perAccount.length, perAccount,
        creditPayments: createdCP.map(c => c.name),
        statements: createdStatements.map(s => s.name) });
      refreshHost(incl, byAcc);
      setStep('done');
    }

    // BES funds have no per-row include toggle (the split is all-or-nothing — it has
    // to reconcile to the balance), so the count is simply how many rows remain.
    const inclCount = mode === 'pen' ? penRows.length
      : (mode === 'inv' ? invRows : rows).filter(r => r.include).length;

    // Footer buttons per step
    function Footer() {
      if (step === 'choose') return (
        <React.Fragment>
          <button id="imp-choose-cancel-btn" className="amb cancel" onClick={closeWizard} disabled={busy}><Icon name="x" size={14} />Cancel</button>
          <button id="imp-choose-continue-btn" className="amb ok" disabled={!canContinue || busy} onClick={goDetect}>
            <Icon name={busy ? 'loader' : 'arrow-right'} size={14} />{busy ? 'Parsing…' : 'Continue'}
          </button>
        </React.Fragment>
      );
      if (step === 'detect') return (
        <React.Fragment>
          <button id="imp-detect-back-btn" className="amb cancel" onClick={() => setStep('choose')}><Icon name="arrow-left" size={14} />Back</button>
          <button id="imp-detect-review-btn" className="amb ok" disabled={!allResolved} onClick={goReview}><Icon name="arrow-right" size={14} />Review</button>
        </React.Fragment>
      );
      // Identity-only files have nothing to import — the account is created via
      // the modal, so this step is terminal.
      if (step === 'identity') return (
        <React.Fragment>
          <button id="imp-identity-back-btn" className="amb cancel" onClick={() => { setMode('tx'); setStep('choose'); }}><Icon name="arrow-left" size={14} />Back</button>
          <button id="imp-identity-done-btn" className="amb ok" onClick={closeWizard}><Icon name="check" size={14} />Done</button>
        </React.Fragment>
      );
      if (step === 'review') return (
        <React.Fragment>
          <button id="imp-review-back-btn" className="amb cancel" onClick={() => setStep(mode === 'tx' ? 'detect' : 'choose')} disabled={busy}><Icon name="arrow-left" size={14} />Back</button>
          <button id="imp-review-import-btn" className="amb ok" disabled={inclCount === 0 || busy}
            onClick={mode === 'pen' ? commitPension : mode === 'inv' ? commitInvestments : commit}>
            <Icon name={busy ? 'loader' : 'check'} size={14} />{busy ? 'Importing…' : 'Import'}
          </button>
        </React.Fragment>
      );
      return <button id="imp-done-btn" className="amb ok" style={{ marginLeft: 'auto' }} onClick={closeWizard}><Icon name="check" size={14} />Done</button>;
    }

    return (
      <div className="backdrop" onMouseDown={(e) => { if (e.target.classList.contains('backdrop') && step !== 'review' && !busy) closeWizard(); }}>
        <div className="modal imp-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name="file-down" size={16} />{mode === 'pen' ? 'Import Retirement Plan' : mode === 'inv' ? 'Import Portfolio' : mode === 'identity' ? 'Add Account From Statement' : 'Import Transactions'}</span>
              <span className="modal-sub">{doc ? doc.fileName : 'From CSV, Excel, or PDF statement'}</span>
            </div>
            <button id="imp-close-btn" className="m-close" onClick={closeWizard}><Icon name="x" size={17} /></button>
          </div>

          <div className="imp-stepper-wrap"><Stepper current={step} steps={mode === 'pen' ? PEN_STEPS : mode === 'inv' ? INV_STEPS : mode === 'identity' ? ID_STEPS : STEPS} /></div>

          <div className="modal-body imp-body">
            {error && <div className="imp-error-banner"><Icon name="alert-triangle" size={14} />{error}</div>}
            {step === 'choose' && <ChooseStep format={format} setFormat={setFormat} setSelected={setSelected}
              pickedFile={pickedFile} setPickedFile={setPickedFile} />}
            {step === 'detect' && mode === 'tx' && doc && <DetectStep doc={doc} accId={accId} setAccId={setAccId} accounts={accounts}
              sourceMap={sourceMap} resolveSource={resolveSource} onPick={pickSource} onCreate={openCreate} />}
            {step === 'identity' && mode === 'identity' && doc && <IdentityStep doc={doc} accounts={accounts}
              resolveSource={resolveSource} onPick={pickSource} onCreate={openCreate} />}
            {step === 'review' && mode === 'tx' && <ReviewStep rows={rows} setRows={setRows} accounts={accounts} />}
            {step === 'review' && mode === 'inv' && <InvReviewStep rows={invRows} setRows={setInvRows} summary={invSummary} />}
            {step === 'review' && mode === 'pen' && penSummary && <PenReviewStep pension={penSummary} rows={penRows} setRows={setPenRows} />}
            {step === 'done' && mode === 'tx' && result && <DoneStep result={result} />}
            {step === 'done' && mode === 'inv' && invResult && <InvDoneStep result={invResult} />}
            {step === 'done' && mode === 'pen' && penResult && <PenDoneStep result={penResult} />}
          </div>

          <div className="modal-foot"><Footer /></div>
        </div>

        {createDraft && window.AccountFormModal &&
          <window.AccountFormModal initial={createDraft} accounts={accounts}
            onClose={() => { createSrcRef.current = null; setCreateDraft(null); }}
            onSave={saveNewAccount} />}
      </div>
    );
  }

  window.ImportWizard = ImportWizard;
})();
