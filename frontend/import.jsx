// import.jsx — Statement import wizard: choose file → detect account → approve → done.
// Wired to the backend: a picked file is parsed by /api/import/preview and the
// reviewed rows are persisted by /api/import/confirm (via window.HL_IMPORT_API).
// Static sample statements remain as an offline demo path.
(function () {
  const Icon = window.Icon;
  const { ACCOUNT_TYPES, FINANCIAL_INSTITUTIONS, FX } = window.ACCOUNTS_DATA;   // static config maps
  const { CATS } = window.LEDGER;
  const { DOCUMENTS, guessCategory, tidyDesc } = window.IMPORT_DATA;

  const SYM = { TRY: '₺', USD: '$', EUR: '€' };
  const grp = (v, d = 2) => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const FMT = { csv: { label: 'CSV', icon: 'file-spreadsheet', color: 'var(--green)' },
                excel: { label: 'Excel', icon: 'sheet', color: 'var(--emerald)' },
                pdf: { label: 'PDF', icon: 'file-text', color: 'var(--red)' } };

  const STEPS = [
    { key: 'choose', label: 'Choose File', icon: 'upload' },
    { key: 'detect', label: 'Detect Account', icon: 'scan-search' },
    { key: 'review', label: 'Review & Edit', icon: 'list-checks' },
    { key: 'done',   label: 'Done', icon: 'check-check' },
  ];

  // ── Step indicator ──
  function Stepper({ current }) {
    const idx = STEPS.findIndex(s => s.key === current);
    return (
      <div className="imp-stepper">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.key}>
            <div className={'imp-step' + (i === idx ? ' active' : '') + (i < idx ? ' done' : '')}>
              <span className="imp-step-dot"><Icon name={i < idx ? 'check' : s.icon} size={13} /></span>
              <span className="imp-step-label">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <span className={'imp-step-bar' + (i < idx ? ' done' : '')}></span>}
          </React.Fragment>
        ))}
      </div>
    );
  }

  // ── Account option helpers ──
  function accLabel(a) { return a.name + ' · ' + a.number; }
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

  // Pre-fill an AccountFormModal `initial` from a parsed statement identity record,
  // so the user only confirms/edits before the account is created.
  function accountDraftFromRecord(rec) {
    const isCard = rec.type === 'credit' || rec.type === 'debit';
    const inst = (FINANCIAL_INSTITUTIONS || {})[rec.institution];
    const instName = inst ? inst.name : '';
    const holder = rec.holder ? titleCase(rec.holder) : '';
    const last4 = String(rec.card_number || rec.number || '').replace(/\D/g, '').slice(-4);
    const name = isCard
      ? (instName || 'Card') + (last4 ? ' ••' + last4 : '')
      : (instName || 'Bank') + (holder ? ' · ' + holder : '');
    return {
      type: rec.type || 'bank',
      name,
      owner: 'Sadun',
      cur: rec.currency || 'TRY',
      number: rec.number || rec.card_number || '',
      iban: rec.iban || '',
      institution: instName,
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
    // Row tuple: [date, description, amount(signed), currency, etiket, source]
    // The API returns a positive `amount` plus a `type` ('income'|'expense');
    // re-apply the sign so the wizard's signed-amount slot is correct.
    const rows = (res.rows || []).map(r => {
      const signed = (Number(r.amount) || 0) * (r.type === 'expense' ? -1 : 1);
      return [r.date, r.description || '', signed, r.currency || 'TRY', r.etiket || null, r.source || null];
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
        <select className="field-input imp-src-sel" value={value || ''}
          onChange={(e) => { e.target.value === '__create__' ? onCreate(rec) : onPick(rec.source, e.target.value); }}>
          <option value="" disabled>Select account…</option>
          <option value="__create__">＋ Create from statement…</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}
        </select>
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
              <select id="imp-detect-account-select" className="field-input" value={accId || ''} onChange={(e) => setAccId(e.target.value)}>
                <option value="" disabled>Select account…</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{accLabel(a)} ({a.owner})</option>)}
              </select>
            </div>
            <span className="imp-hint"><Icon name="info" size={11} />This becomes the default account for every row — you can still change individual rows in the next step.</span>
          </div>
        )}
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
        <input id={'imp-row-' + idx + '-date-input'} type="date" className="imp-cell imp-date" value={row.date} onChange={(e) => update(idx, { date: e.target.value })} />
        <input id={'imp-row-' + idx + '-desc-input'} className="imp-cell imp-desc" placeholder="Description" title="Transaction description" value={row.desc} onChange={(e) => update(idx, { desc: e.target.value })} />
        <div className="imp-cell-cat">
          <select id={'imp-row-' + idx + '-cat-select'} className="imp-cell imp-catsel" value={row.cat} onChange={(e) => update(idx, { cat: e.target.value })}>
            {Object.keys(CATS).map(k => <option key={k} value={k}>{CATS[k].label}</option>)}
          </select>
        </div>
        <div className={'imp-amt-wrap ' + (row.amount >= 0 ? 'pos' : 'neg')}>
          <span className="imp-amt-sign">{row.amount >= 0 ? '+' : '−'}{SYM[row.cur]}</span>
          <input id={'imp-row-' + idx + '-amount-input'} type="number" step="0.01" className="imp-cell imp-amt" value={Math.abs(row.amount)}
            onChange={(e) => { const v = parseFloat(e.target.value) || 0; update(idx, { amount: row.amount < 0 ? -v : v }); }} />
          <button id={'imp-row-' + idx + '-flip-btn'} className="imp-amt-flip" title="Flip income/expense" onClick={() => update(idx, { amount: -row.amount })}><Icon name="repeat" size={11} /></button>
        </div>
        <select id={'imp-row-' + idx + '-account-select'} className="imp-cell imp-acc" value={row.accId || ''} onChange={(e) => update(idx, { accId: e.target.value })}>
          <option value="" disabled>Account…</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}
        </select>
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
          if (!res.rows || !res.rows.length) {
            setError('No transactions could be parsed from this file.');
            setBusy(false);
            return;
          }
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
      // Credit-card statements keep the bank's original description casing as-is
      // (no Title-casing); other sources are still tidied.
      const creditSources = new Set(
        (doc.statementAccounts || []).filter(a => a.type === 'credit').map(a => a.source));
      const built = doc.rows.map((r, i) => {
        const etiket = r[4];
        const fromCredit = creditSources.has(r[5]);
        return {
          key: 'r' + i,
          include: true,
          date: r[0],
          desc: fromCredit ? r[1] : tidyDesc(r[1]),
          cat: guessCategory(r[1], r[2] >= 0, etiket),
          amount: r[2],
          cur: r[3],
          accId: resolveSource(r[5]) || accId,
        };
      });
      setRows(built);
      setStep('review');
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
        outcome = await window.HL_IMPORT_API.confirm(backendRows, true);
      } catch (e) {
        setError(e.message || 'Import failed.');
        setBusy(false);
        return;
      }
      setBusy(false);

      // Credit-card statement summary → (1) store the actual Last Payment Date
      // (Son Ödeme Tarihi) on the card, (2) add ONE budget-exempt "Credit Card
      // Payment" record (Dönem Borcunuz, dated on that day) so it shows on the
      // calendar as a single expense item. Non-fatal: the rows are already saved.
      const stmts = (doc.statementAccounts || []).filter(
        rec => rec.type === 'credit' && rec.payment_due && rec.total);
      for (const rec of stmts) {
        const accId = resolveSource(rec.source);
        const acct = accounts.find(a => a.id === accId);
        if (!acct) continue;
        try {
          await window.HL_ACCOUNTS_API.update(acct._dbId, { ...acct, paymentDue: rec.payment_due });
          if (window.HL_SPENDING_API) {
            const cur = rec.currency || 'TRY';
            await window.HL_SPENDING_API.create({
              date: rec.payment_due,
              amt: rec.total,
              cur,
              type: 'expense',
              cat: 'credit-card-payment',
              desc: 'Credit Card Payment — ' + (acct.name || rec.source),
              payingFor: '–',
              paymentMethod: accId,
              payer: ownerOf(accId),
              // TRY statements are 1:1; provide the TRY value as the client fallback so
              // calendar/summary totals are correct even when no TCMB rate row exists yet.
              tryV: cur === 'TRY' ? rec.total : null,
            });
          }
        } catch (e) { /* card already imported; surfacing this would confuse the Done screen */ }
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
      setResult({ count: outcome.imported, skipped: outcome.skipped || 0, accounts: perAccount.length, perAccount });
      onCommit && onCommit(incl, byAcc);
      setStep('done');
    }

    const inclCount = rows.filter(r => r.include).length;

    // Footer buttons per step
    function Footer() {
      if (step === 'choose') return (
        <React.Fragment>
          <button id="imp-choose-cancel-btn" className="amb cancel" onClick={onClose} disabled={busy}><Icon name="x" size={14} />Cancel</button>
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
      if (step === 'review') return (
        <React.Fragment>
          <button id="imp-review-back-btn" className="amb cancel" onClick={() => setStep('detect')} disabled={busy}><Icon name="arrow-left" size={14} />Back</button>
          <button id="imp-review-import-btn" className="amb ok" disabled={inclCount === 0 || busy} onClick={commit}>
            <Icon name={busy ? 'loader' : 'check'} size={14} />{busy ? 'Importing…' : 'Import'}
          </button>
        </React.Fragment>
      );
      return <button id="imp-done-btn" className="amb ok" style={{ marginLeft: 'auto' }} onClick={onClose}><Icon name="check" size={14} />Done</button>;
    }

    return (
      <div className="backdrop" onMouseDown={(e) => { if (e.target.classList.contains('backdrop') && step !== 'review' && !busy) onClose(); }}>
        <div className="modal imp-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name="file-down" size={16} />Import Transactions</span>
              <span className="modal-sub">{doc ? doc.fileName : 'From CSV, Excel, or PDF statement'}</span>
            </div>
            <button id="imp-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          <div className="imp-stepper-wrap"><Stepper current={step} /></div>

          <div className="modal-body imp-body">
            {error && <div className="imp-error-banner"><Icon name="alert-triangle" size={14} />{error}</div>}
            {step === 'choose' && <ChooseStep format={format} setFormat={setFormat} setSelected={setSelected}
              pickedFile={pickedFile} setPickedFile={setPickedFile} />}
            {step === 'detect' && doc && <DetectStep doc={doc} accId={accId} setAccId={setAccId} accounts={accounts}
              sourceMap={sourceMap} resolveSource={resolveSource} onPick={pickSource} onCreate={openCreate} />}
            {step === 'review' && <ReviewStep rows={rows} setRows={setRows} accounts={accounts} />}
            {step === 'done' && result && <DoneStep result={result} />}
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
