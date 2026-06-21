// import.jsx — Statement import wizard: choose file → detect account → approve → done.
// Wired to the backend: a picked file is parsed by /api/import/preview and the
// reviewed rows are persisted by /api/import/confirm (via window.HL_IMPORT_API).
// Static sample statements remain as an offline demo path.
(function () {
  const Icon = window.Icon;
  const { ACCOUNT_TYPES, FX } = window.ACCOUNTS_DATA;          // static config maps
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
    return {
      fileName: file.name,
      format: formatOf(file.name),
      institution: res.bank_detected || 'Bank',
      accountNumber: null,                       // not exposed by the parsers yet
      period: (dr.from || '?') + ' → ' + (dr.to || '?'),
      rows: (res.rows || []).map(r => [r.date, r.description || '', Number(r.amount) || 0, r.currency || 'TRY']),
    };
  }

  // ═══════════════ STEP 1 — Choose file ═══════════════
  function ChooseStep({ format, setFormat, selected, setSelected, pickedFile, setPickedFile, accounts }) {
    const fileRef = React.useRef(null);
    const docs = DOCUMENTS.filter(d => d.format === format);

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

        <div className="imp-field">
          <span className="field-label">Sample {FMT[format].label} Statements <i className="imp-demo-tag">demo</i></span>
          <div className="imp-doc-list">
            {docs.map(d => {
              const acc = findByNumber(accounts, d.accountNumber);
              return (
                <button key={d.id} id={'imp-doc-' + d.id + '-btn'} className={'imp-doc-row' + (selected === d.id ? ' sel' : '')}
                  onClick={() => { setSelected(d.id); setPickedFile(null); }}>
                  <span className="imp-doc-ico" style={{ color: FMT[d.format].color }}><Icon name={FMT[d.format].icon} size={17} /></span>
                  <span className="imp-doc-meta">
                    <span className="imp-doc-name">{d.fileName}</span>
                    <span className="imp-doc-sub">{d.institution} · {d.accountNumber} · {d.rows.length} rows · {d.size}</span>
                  </span>
                  {acc
                    ? <span className="imp-doc-match"><Icon name="link" size={11} />Matches {acc.name}</span>
                    : <span className="imp-doc-nomatch"><Icon name="link-2-off" size={11} />No match</span>}
                  <span className="imp-doc-check">{selected === d.id && <Icon name="check-circle-2" size={17} />}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════ STEP 2 — Detect account ═══════════════
  function DetectStep({ doc, accId, setAccId, accounts }) {
    const matched = findByNumber(accounts, doc.accountNumber);
    const cur = doc.rows.length ? doc.rows[0][3] : 'TRY';
    const totals = doc.rows.reduce((s, r) => { r[2] >= 0 ? s.in += r[2] : s.out += -r[2]; return s; },
      { in: 0, out: 0 });
    const dates = doc.rows.map(r => r[0]).sort();
    const acc = accounts.find(a => a.id === accId);
    const t = acc ? ACCOUNT_TYPES[acc.type] : null;

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

        <div className="imp-field">
          <span className="field-label">Related Account</span>
          {matched
            ? <div className="imp-match-banner"><Icon name="badge-check" size={14} />Auto-matched by account number <b>{doc.accountNumber}</b> → <b>{matched.name}</b></div>
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
          const matched = findByNumber(accounts, norm.accountNumber);
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
      // Build editable rows; each row defaults to the document-level account
      const built = doc.rows.map((r, i) => ({
        key: 'r' + i,
        include: true,
        date: r[0],
        desc: tidyDesc(r[1]),
        cat: guessCategory(r[1], r[2] >= 0),
        amount: r[2],
        cur: r[3],
        accId: accId,
      }));
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
          <button id="imp-detect-review-btn" className="amb ok" disabled={!accId} onClick={goReview}><Icon name="arrow-right" size={14} />Review</button>
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
            {step === 'choose' && <ChooseStep format={format} setFormat={setFormat} selected={selected} setSelected={setSelected}
              pickedFile={pickedFile} setPickedFile={setPickedFile} accounts={accounts} />}
            {step === 'detect' && doc && <DetectStep doc={doc} accId={accId} setAccId={setAccId} accounts={accounts} />}
            {step === 'review' && <ReviewStep rows={rows} setRows={setRows} accounts={accounts} />}
            {step === 'done' && result && <DoneStep result={result} />}
          </div>

          <div className="modal-foot"><Footer /></div>
        </div>
      </div>
    );
  }

  window.ImportWizard = ImportWizard;
})();
