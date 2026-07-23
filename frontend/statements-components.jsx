// statements-components.jsx — table, add/edit modal, statement detail/upload, delete confirm.
// The bank-account twin of credit-payments-components.jsx.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { grp, SYM, MONTHS } = window.LEDGER_FMT;
  const { DateInput, CurrencyInput } = window;
  const ST_API = window.HL_STATEMENTS_API;

  const money = (cur, v) => (SYM[cur] || '') + grp(Math.abs(Number(v) || 0));
  const fmtDate = (s) => s || '–';
  const period = (r) => (r.from && r.to) ? (r.from + ' → ' + r.to) : (r.from || r.to || '–');

  // ── Records table ─────────────────────────────────────────────────────────
  function StatementTable({ records, onRowClick, onEdit, onDelete, selectable, selected, onToggleSelect, allSelected, someSelected, onToggleSelectAll }) {
    if (!records.length) {
      return (
        <div className="st-empty" id="st-empty-state">
          <Icon name="files" size={36} />
          <span className="st-empty-t">No statements yet</span>
          <span className="st-empty-s">Import a bank statement to archive it against its account.</span>
        </div>
      );
    }
    return (
      <div className="st-table-wrap">
        <table className="st-table" id="st-table">
          <thead>
            <tr>
              {selectable && (
                <th className="st-th-select" title="Select all">
                  <input id="st-select-all" type="checkbox" className="row-select-box" checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected; }}
                    onChange={onToggleSelectAll} aria-label="Select all statements" />
                </th>
              )}
              <th>STATEMENT</th>
              <th>ACCOUNT</th>
              <th>PERIOD</th>
              <th className="num">MONEY IN</th>
              <th className="num">MONEY OUT</th>
              <th className="num">MOVEMENTS</th>
              <th>DOCUMENT</th>
              <th className="st-th-actions">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id} id={'st-row-' + r.id} className={'st-row' + (selectable && selected.has(r.id) ? ' row-selected' : '')} onClick={() => onRowClick(r)}>
                {selectable && (
                  <td className="st-td-select" data-label="" onClick={(e) => { e.stopPropagation(); onToggleSelect(r.id); }}>
                    <input id={'st-row-select-' + r.id} type="checkbox" className="row-select-box" checked={selected.has(r.id)}
                      onChange={() => {}} aria-label="Select row" />
                  </td>
                )}
                <td data-label="Statement">
                  <span className="st-name"><Icon name="file-text" size={14} />{r.name || '–'}</span>
                </td>
                <td data-label="Account">
                  {r.acctNamePart ? (
                    <span className="st-acct">
                      {r.acctInst && <span className="st-acct-inst">{r.acctInst}</span>}
                      {r.acctInst && <span className="st-acct-dot">·</span>}
                      <span className="st-acct-name">{r.acctNamePart}</span>
                    </span>
                  ) : (r.acctLabel || r.accountKey || '–')}
                </td>
                <td data-label="Period"><span className="st-period">{period(r)}</span></td>
                <td className="num" data-label="Money In"><span className="st-in">{money(r.cur, r.moneyIn)}</span></td>
                <td className="num" data-label="Money Out"><span className="st-out">{money(r.cur, r.moneyOut)}</span></td>
                <td className="num" data-label="Movements">
                  <span className="st-chip">{r.linkedCount}</span>
                </td>
                <td data-label="Document">
                  {r.fileName
                    ? <span className="st-doc"><Icon name="paperclip" size={13} /><span className="st-doc-name" title={r.fileName}>{r.fileName}</span></span>
                    : <span className="st-doc-none">–</span>}
                </td>
                <td className="st-td-actions" onClick={(e) => e.stopPropagation()}>
                  <button id={'st-edit-' + r.id} className="list-btn blue" onClick={() => onEdit(r)}>
                    <Icon name="pencil" size={12} />Edit
                  </button>
                  <button id={'st-delete-' + r.id} className="list-btn red" onClick={() => onDelete(r)}>
                    <Icon name="trash-2" size={12} />Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Add / Edit modal ──────────────────────────────────────────────────────
  function StatementFormModal({ initial, accounts, onClose, onSave }) {
    const editing = !!initial.id;
    const now = new Date();
    const [f, setF] = React.useState({
      accountId: initial.accountId != null ? String(initial.accountId) : '',
      year: initial.year != null ? String(initial.year) : String(now.getFullYear()),
      month: initial.month != null ? String(initial.month) : String(now.getMonth() + 1),
      from: initial.from || '',
      to: initial.to || '',
      moneyIn: initial.moneyIn != null ? String(initial.moneyIn) : '',
      moneyOut: initial.moneyOut != null ? String(initial.moneyOut) : '',
      closingBalance: initial.closingBalance != null ? String(initial.closingBalance) : '',
      cur: initial.cur || 'TRY',
    });
    const [invalid, setInvalid] = React.useState({});
    const [formErr, setFormErr] = React.useState('');
    const set = (k, v) => { if (formErr) { setFormErr(''); setInvalid({}); } setF(p => ({ ...p, ...(typeof k === 'object' ? k : { [k]: v }) })); };

    function submit() {
      const v = window.HL_FORM.checkRequired([
        { key: 'accountId', label: 'Account', ok: !!f.accountId },
      ]);
      setInvalid(v.keys); setFormErr(v.message);
      if (!v.ok) return;
      onSave({
        ...initial,
        accountId: Number(f.accountId),
        year: Number(f.year),
        month: Number(f.month),
        from: f.from,
        to: f.to,
        moneyIn: parseFloat(f.moneyIn) || 0,
        moneyOut: parseFloat(f.moneyOut) || 0,
        closingBalance: f.closingBalance === '' ? null : (parseFloat(f.closingBalance) || 0),
        cur: f.cur,
      });
    }

    const years = [];
    for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 6; y--) years.push(y);

    return (
      <div className="backdrop">
        <div className="modal st-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name={editing ? 'pencil' : 'plus-circle'} size={16} />{editing ? 'Edit Statement' : 'Add Statement'}</span>
              <span className="modal-sub">{editing ? (initial.name || '') : 'Record a bank-account statement'}</span>
            </div>
            <button id="st-modal-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          <div className="modal-body">
            <div className={"form-field full" + (invalid.accountId ? ' field-invalid' : '')}>
              <span className="field-label">Account<span className="field-required-mark">*</span></span>
              <StyledSelect id="st-modal-account-select" className="field-input" value={f.accountId} onChange={(e) => set('accountId', e.target.value)}>
                <option value="">— Select Account —</option>
                {accounts.map(a => (
                  <option key={a._dbId} value={a._dbId}>
                    {a.name}{a.number && a.number !== '–' ? ' ' + a.number : ''}{a.owner && a.owner !== 'Shared' ? ' (' + a.owner + ')' : ''}
                  </option>
                ))}
              </StyledSelect>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Statement Month</span>
                <StyledSelect id="st-modal-month-select" className="field-input" value={f.month} onChange={(e) => set('month', e.target.value)}>
                  {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </StyledSelect>
              </div>
              <div className="form-field">
                <span className="field-label">Statement Year</span>
                <StyledSelect id="st-modal-year-select" className="field-input" value={f.year} onChange={(e) => set('year', e.target.value)}>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </StyledSelect>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Period From</span>
                <DateInput id="st-modal-from-input" className="field-input" value={f.from} onChange={(e) => set('from', e.target.value)} />
              </div>
              <div className="form-field">
                <span className="field-label">Period To</span>
                <DateInput id="st-modal-to-input" className="field-input" value={f.to} onChange={(e) => set('to', e.target.value)} />
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Money In</span>
                <div className="amount-input-wrap">
                  <CurrencyInput id="st-modal-in-input" value={f.moneyIn} currency={f.cur} onChange={(v) => set('moneyIn', v)} />
                  <StyledSelect id="st-modal-currency-select" className="field-input" value={f.cur} onChange={(e) => set('cur', e.target.value)}>
                    <option>TRY</option><option>USD</option><option>EUR</option>
                  </StyledSelect>
                </div>
              </div>
              <div className="form-field">
                <span className="field-label">Money Out</span>
                <CurrencyInput id="st-modal-out-input" value={f.moneyOut} currency={f.cur} onChange={(v) => set('moneyOut', v)} />
              </div>
            </div>

            <div className="form-field full">
              <span className="field-label">Closing Balance</span>
              <CurrencyInput id="st-modal-balance-input" value={f.closingBalance} currency={f.cur} onChange={(v) => set('closingBalance', v)} />
            </div>
          </div>

          <window.HL_FORM.FormError message={formErr} id="st-modal-form-error" />

          <div className="modal-foot">
            <button id="st-modal-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            <button id="st-modal-save-btn" className="amb ok" onClick={submit}><Icon name="save" size={14} />Save</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Statement detail / document upload ─────────────────────────────────────
  function StatementDetail({ record, onClose, onEdit, onDelete, onChanged }) {
    const [busy, setBusy] = React.useState(false);
    const [err, setErr] = React.useState(null);
    const fileRef = React.useRef(null);

    function pick() { if (fileRef.current) fileRef.current.click(); }

    async function onFile(file) {
      if (!file) return;
      setErr(null); setBusy(true);
      try {
        await ST_API.attachFile(record.id, file);
        if (onChanged) onChanged();          // attachment filename now stored
      } catch (e) { setErr(e.message); }
      finally { setBusy(false); }
    }

    async function download() {
      setErr(null);
      try { await ST_API.downloadFile(record.id, record.fileName); }
      catch (e) { setErr(e.message); }
    }

    // Deep-link into Account Activity, pre-pinned to this statement's account and
    // opened on the month the period ends in (that page is month-scoped).
    const activityHref = record.accountKey
      ? 'Account Activity.html?account=' + encodeURIComponent(record.accountKey)
      : 'Account Activity.html';

    return (
      <div className="backdrop">
        <div className="modal st-detail-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name="file-text" size={16} />{record.name || 'Statement'}</span>
              <span className="modal-sub">{record.acctLabel || record.accountKey || ''}</span>
            </div>
            <button id="st-detail-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          <div className="modal-body">
            <div className="st-detail-grid">
              <div className="st-stat"><span className="st-stat-l">Period From</span><span className="st-stat-v">{fmtDate(record.from)}</span></div>
              <div className="st-stat"><span className="st-stat-l">Period To</span><span className="st-stat-v">{fmtDate(record.to)}</span></div>
              <div className="st-stat"><span className="st-stat-l">Money In</span><span className="st-stat-v pos">{money(record.cur, record.moneyIn)}</span></div>
              <div className="st-stat"><span className="st-stat-l">Money Out</span><span className="st-stat-v neg">{money(record.cur, record.moneyOut)}</span></div>
              {record.closingBalance != null && (
                <div className="st-stat"><span className="st-stat-l">Closing Balance</span><span className="st-stat-v">{money(record.cur, record.closingBalance)}</span></div>
              )}
              <div className="st-stat"><span className="st-stat-l">Movements</span><span className="st-stat-v">{record.linkedCount}</span></div>
            </div>

            <a className="st-link" id="st-detail-activity-link" href={activityHref}>
              <Icon name="external-link" size={12} />View these movements on Account Activity
            </a>

            <div className="st-section" style={{ marginTop: 16 }}>
              <span className="st-section-title"><Icon name="paperclip" size={13} />Statement Document</span>
              {record.fileName ? (
                <div className="st-file-row">
                  <span className="st-file-name"><Icon name="file" size={13} />{record.fileName}</span>
                  <button id="st-download-btn" className="list-btn blue" onClick={download}><Icon name="download" size={12} />Download</button>
                </div>
              ) : (
                <span className="st-file-none">No document uploaded yet.</span>
              )}

              <div className="st-drop" id="st-drop" onClick={pick}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }}
                onDragLeave={(e) => e.currentTarget.classList.remove('over')}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); onFile(e.dataTransfer.files[0]); }}>
                <Icon name="upload" size={18} />
                <span className="st-drop-t">{record.fileName ? 'Replace document' : 'Upload document'} (CSV, XLS, XLSX, PDF)</span>
                <input id="st-file-input" ref={fileRef} type="file" hidden accept=".csv,.xls,.xlsx,.pdf"
                  onChange={(e) => onFile(e.target.files[0])} />
              </div>
              <span className="st-note"><Icon name="info" size={12} />Uploading here only archives the file — use Import Statement to read movements from it.</span>

              {busy && <div className="st-note"><Icon name="loader" size={13} />Working…</div>}
              {err && <div className="st-error"><Icon name="alert-triangle" size={13} />{err}</div>}
            </div>
          </div>

          <div className="modal-foot">
            <button id="st-detail-delete-btn" className="amb danger" style={{ marginRight: 'auto' }} onClick={() => onDelete(record)}><Icon name="trash-2" size={14} />Delete</button>
            <button id="st-detail-edit-btn" className="amb ok" onClick={() => onEdit(record)}><Icon name="pencil" size={14} />Edit</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Delete confirm ──────────────────────────────────────────────────────────
  function DeleteStatementConfirm({ record, count, onClose, onConfirm }) {
    const batch = typeof count === 'number';
    return (
      <div className="backdrop">
        <div className="modal confirm-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name="trash-2" size={16} />{batch ? 'Delete Selected' : 'Delete Statement'}</span>
            </div>
            <button id="st-del-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>
          <div className="confirm-body">
            <div className="confirm-ico"><Icon name="alert-triangle" size={20} /></div>
            <div className="confirm-text">
              {batch
                ? <>Delete <b>{count}</b> selected {count === 1 ? 'statement' : 'statements'}?</>
                : <>Delete <b>{record.name}</b>?</>}
              <span className="warn">⚠ The uploaded document is removed. Movements stay on Account Activity, but lose their statement link. This cannot be undone.</span>
            </div>
          </div>
          <div className="modal-foot">
            <button id="st-del-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            <button id="st-del-confirm-btn" className="amb danger" onClick={onConfirm}><Icon name="trash-2" size={14} />Delete</button>
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, {
    StatementTable, StatementFormModal, StatementDetail, DeleteStatementConfirm,
  });
})();
