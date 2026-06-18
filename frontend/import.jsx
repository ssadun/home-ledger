// import.jsx — Statement import wizard: choose file → detect account → approve → done.
(function () {
  const Icon = window.Icon;
  const { ACCOUNTS, ACCOUNT_TYPES, FX } = window.ACCOUNTS_DATA;
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
  function findByNumber(num) { return ACCOUNTS.find(a => a.number === num); }

  // ═══════════════ STEP 1 — Choose file ═══════════════
  function ChooseStep({ format, setFormat, selected, setSelected }) {
    const fileRef = React.useRef(null);
    const docs = DOCUMENTS.filter(d => d.format === format);

    function onPick(e) {
      // Prototype: any dropped/picked file maps to the first sample of this format
      if (docs[0]) setSelected(docs[0].id);
    }

    return (
      <div className="imp-pane">
        <div className="imp-field">
          <span className="field-label">Statement Format</span>
          <div className="seg imp-fmt-seg">
            {Object.keys(FMT).map(k => (
              <button key={k} className={format === k ? 'on-fmt' : ''} onClick={() => { setFormat(k); setSelected(null); }}
                style={format === k ? { background: 'color-mix(in srgb, ' + FMT[k].color + ' 16%, transparent)', color: FMT[k].color } : {}}>
                <Icon name={FMT[k].icon} size={14} />{FMT[k].label}
              </button>
            ))}
          </div>
        </div>

        <div className="imp-drop" onClick={() => fileRef.current && fileRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }}
          onDragLeave={(e) => e.currentTarget.classList.remove('over')}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); onPick(e); }}>
          <span className="imp-drop-ico"><Icon name="upload-cloud" size={26} /></span>
          <span className="imp-drop-t">Drop your {FMT[format].label} statement here</span>
          <span className="imp-drop-s">or <b>browse files</b> · max 10 MB</span>
          <input ref={fileRef} type="file" hidden accept={'.' + (format === 'excel' ? 'xlsx' : format)} onChange={onPick} />
        </div>

        <div className="imp-field">
          <span className="field-label">Available {FMT[format].label} Statements</span>
          <div className="imp-doc-list">
            {docs.map(d => {
              const acc = findByNumber(d.accountNumber);
              return (
                <button key={d.id} className={'imp-doc-row' + (selected === d.id ? ' sel' : '')} onClick={() => setSelected(d.id)}>
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
  function DetectStep({ doc, accId, setAccId }) {
    const matched = findByNumber(doc.accountNumber);
    const totals = doc.rows.reduce((s, r) => { r[2] >= 0 ? s.in += r[2] : s.out += -r[2]; return s; },
      { in: 0, out: 0 });
    const dates = doc.rows.map(r => r[0]).sort();
    const acc = ACCOUNTS.find(a => a.id === accId);
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
            <div className="imp-stat"><span className="imp-stat-k">Account No. (from file)</span><span className="imp-stat-v mono">{doc.accountNumber}</span></div>
            <div className="imp-stat"><span className="imp-stat-k">Date Range</span><span className="imp-stat-v">{dates[0]} → {dates[dates.length - 1]}</span></div>
            <div className="imp-stat"><span className="imp-stat-k">Money In</span><span className="imp-stat-v pos">+{SYM[doc.rows[0][3]]}{grp(totals.in)}</span></div>
            <div className="imp-stat"><span className="imp-stat-k">Money Out</span><span className="imp-stat-v neg">−{SYM[doc.rows[0][3]]}{grp(totals.out)}</span></div>
          </div>
        </div>

        <div className="imp-field">
          <span className="field-label">Related Account</span>
          {matched
            ? <div className="imp-match-banner"><Icon name="badge-check" size={14} />Auto-matched by account number <b>{doc.accountNumber}</b> → <b>{matched.name}</b></div>
            : <div className="imp-nomatch-banner"><Icon name="alert-triangle" size={14} />No account matched <b>{doc.accountNumber}</b>. Pick the destination account below.</div>}
          <div className="imp-acc-select">
            {t && <span className="acct-type-ico" style={{ width: 30, height: 30, color: t.color,
              background: 'color-mix(in srgb, ' + t.color + ' 13%, transparent)',
              borderColor: 'color-mix(in srgb, ' + t.color + ' 40%, transparent)' }}><Icon name={t.icon} size={15} /></span>}
            <select className="field-input" value={accId || ''} onChange={(e) => setAccId(e.target.value)}>
              <option value="" disabled>Select account…</option>
              {ACCOUNTS.map(a => <option key={a.id} value={a.id}>{accLabel(a)} ({a.owner})</option>)}
            </select>
          </div>
          <span className="imp-hint"><Icon name="info" size={11} />This becomes the default account for every row — you can still change individual rows in the next step.</span>
        </div>
      </div>
    );
  }

  // ═══════════════ STEP 3 — Review & edit ═══════════════
  function ReviewRow({ row, idx, update, remove }) {
    const cat = CATS[row.cat];
    return (
      <div className={'imp-rev-row' + (row.include ? '' : ' excluded')}>
        <button className="imp-inc" onClick={() => update(idx, { include: !row.include })} title={row.include ? 'Exclude row' : 'Include row'}>
          <Icon name={row.include ? 'check-square' : 'square'} size={16} />
        </button>
        <input type="date" className="imp-cell imp-date" value={row.date} onChange={(e) => update(idx, { date: e.target.value })} />
        <input className="imp-cell imp-desc" placeholder="Description" title="Transaction description" value={row.desc} onChange={(e) => update(idx, { desc: e.target.value })} />
        <div className="imp-cell-cat">
          <select className="imp-cell imp-catsel" value={row.cat} onChange={(e) => update(idx, { cat: e.target.value })}>
            {Object.keys(CATS).map(k => <option key={k} value={k}>{CATS[k].label}</option>)}
          </select>
        </div>
        <div className={'imp-amt-wrap ' + (row.amount >= 0 ? 'pos' : 'neg')}>
          <span className="imp-amt-sign">{row.amount >= 0 ? '+' : '−'}{SYM[row.cur]}</span>
          <input type="number" step="0.01" className="imp-cell imp-amt" value={Math.abs(row.amount)}
            onChange={(e) => { const v = parseFloat(e.target.value) || 0; update(idx, { amount: row.amount < 0 ? -v : v }); }} />
          <button className="imp-amt-flip" title="Flip income/expense" onClick={() => update(idx, { amount: -row.amount })}><Icon name="repeat" size={11} /></button>
        </div>
        <select className="imp-cell imp-acc" value={row.accId} onChange={(e) => update(idx, { accId: e.target.value })}>
          {ACCOUNTS.map(a => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}
        </select>
        <button className="imp-del" onClick={() => remove(idx)} title="Remove row"><Icon name="trash-2" size={13} /></button>
      </div>
    );
  }

  function ReviewStep({ rows, setRows }) {
    const update = (i, patch) => setRows(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
    const remove = (i) => setRows(prev => prev.filter((_, j) => j !== i));
    const incl = rows.filter(r => r.include);
    const allOn = incl.length === rows.length && rows.length > 0;

    return (
      <div className="imp-pane imp-review">
        <div className="imp-rev-head">
          <button className="imp-bulk" onClick={() => setRows(prev => prev.map(r => ({ ...r, include: !allOn })))}>
            <Icon name={allOn ? 'check-square' : 'square'} size={14} />{allOn ? 'Deselect all' : 'Select all'}
          </button>
          <span className="imp-rev-count">{incl.length} of {rows.length} rows selected for import</span>
        </div>
        <div className="imp-rev-table">
          <div className="imp-rev-thead">
            <span></span><span>DATE</span><span>DESCRIPTION</span><span>CATEGORY</span><span className="ar">AMOUNT</span><span>RELATED ACCOUNT</span><span></span>
          </div>
          <div className="imp-rev-body">
            {rows.map((r, i) => <ReviewRow key={r.key} row={r} idx={i} update={update} remove={remove} />)}
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
        <span className="imp-done-s">{result.count} transaction{result.count !== 1 ? 's' : ''} imported across {result.accounts} account{result.accounts !== 1 ? 's' : ''}.</span>
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
    const [selected, setSelected] = React.useState(null);
    const [accId, setAccId] = React.useState(null);
    const [rows, setRows] = React.useState([]);
    const [result, setResult] = React.useState(null);

    const doc = DOCUMENTS.find(d => d.id === selected);

    function goDetect() {
      const matched = findByNumber(doc.accountNumber);
      setAccId(preAccId || (matched ? matched.id : null));
      setStep('detect');
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

    function commit() {
      const incl = rows.filter(r => r.include);
      const byAcc = {};
      incl.forEach(r => {
        if (!byAcc[r.accId]) byAcc[r.accId] = { delta: 0, n: 0 };
        byAcc[r.accId].delta += r.amount;
        byAcc[r.accId].n += 1;
      });
      const perAccount = Object.keys(byAcc).map(id => {
        const a = ACCOUNTS.find(x => x.id === id);
        return { accId: id, name: a ? a.name : id, cur: a ? a.cur : 'TRY', n: byAcc[id].n, delta: byAcc[id].delta };
      });
      setResult({ count: incl.length, accounts: perAccount.length, perAccount });
      onCommit && onCommit(incl, byAcc);
      setStep('done');
    }

    const inclCount = rows.filter(r => r.include).length;

    // Footer buttons per step
    function Footer() {
      if (step === 'choose') return (
        <React.Fragment>
          <button className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
          <button className="amb ok" disabled={!selected} onClick={goDetect}><Icon name="arrow-right" size={14} />Continue</button>
        </React.Fragment>
      );
      if (step === 'detect') return (
        <React.Fragment>
          <button className="amb cancel" onClick={() => setStep('choose')}><Icon name="arrow-left" size={14} />Back</button>
          <button className="amb ok" disabled={!accId} onClick={goReview}><Icon name="arrow-right" size={14} />Review</button>
        </React.Fragment>
      );
      if (step === 'review') return (
        <React.Fragment>
          <button className="amb cancel" onClick={() => setStep('detect')}><Icon name="arrow-left" size={14} />Back</button>
          <button className="amb ok" disabled={inclCount === 0} onClick={commit}><Icon name="check" size={14} />Import</button>
        </React.Fragment>
      );
      return <button className="amb ok" style={{ marginLeft: 'auto' }} onClick={onClose}><Icon name="check" size={14} />Done</button>;
    }

    return (
      <div className="backdrop" onMouseDown={(e) => { if (e.target.classList.contains('backdrop') && step !== 'review') onClose(); }}>
        <div className="modal imp-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name="file-down" size={16} />Import Transactions</span>
              <span className="modal-sub">{doc ? doc.fileName : 'From CSV, Excel, or PDF statement'}</span>
            </div>
            <button className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          <div className="imp-stepper-wrap"><Stepper current={step} /></div>

          <div className="modal-body imp-body">
            {step === 'choose' && <ChooseStep format={format} setFormat={setFormat} selected={selected} setSelected={setSelected} />}
            {step === 'detect' && doc && <DetectStep doc={doc} accId={accId} setAccId={setAccId} />}
            {step === 'review' && <ReviewStep rows={rows} setRows={setRows} />}
            {step === 'done' && result && <DoneStep result={result} />}
          </div>

          <div className="modal-foot"><Footer /></div>
        </div>
      </div>
    );
  }

  window.ImportWizard = ImportWizard;
})();
