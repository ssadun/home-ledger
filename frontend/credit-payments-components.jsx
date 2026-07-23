// credit-payments-components.jsx — table, add/edit modal, statement detail/upload, delete confirm.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { grp, SYM, MONTHS } = window.LEDGER_FMT;
  const { DateInput, CurrencyInput } = window;
  const CP_API = window.HL_CREDIT_PAYMENTS_API;

  const money = (cur, v) => (SYM[cur] || '') + grp(Math.abs(Number(v) || 0));
  const fmtDate = (s) => s || '–';

  // ── Records table ─────────────────────────────────────────────────────────
  function CreditPaymentTable({ records, onRowClick, onEdit, onDelete, selectable, selected, onToggleSelect, allSelected, someSelected, onToggleSelectAll }) {
    if (!records.length) {
      return (
        <div className="cp-empty" id="cp-empty-state">
          <Icon name="credit-card" size={36} />
          <span className="cp-empty-t">No credit payments yet</span>
          <span className="cp-empty-s">Add a statement to start tracking card payments.</span>
        </div>
      );
    }
    return (
      <div className="cp-table-wrap">
        <table className="cp-table" id="cp-table">
          <thead>
            <tr>
              {selectable && (
                <th className="cp-th-select" title="Select all">
                  <input id="cp-select-all" type="checkbox" className="row-select-box" checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected; }}
                    onChange={onToggleSelectAll} aria-label="Select all credit payments" />
                </th>
              )}
              <th>STATEMENT</th>
              <th>CARD</th>
              <th>CUTOVER</th>
              <th>PAYMENT DUE</th>
              <th className="num">TOTAL</th>
              <th className="num">MINIMUM</th>
              <th className="num">SPENDINGS</th>
              <th className="cp-th-actions">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id} id={'cp-row-' + r.id} className={'cp-row' + (selectable && selected.has(r.id) ? ' row-selected' : '')} onClick={() => onRowClick(r)}>
                {selectable && (
                  <td className="cp-td-select" data-label="" onClick={(e) => { e.stopPropagation(); onToggleSelect(r.id); }}>
                    <input id={'cp-row-select-' + r.id} type="checkbox" className="row-select-box" checked={selected.has(r.id)}
                      onChange={() => {}} aria-label="Select row" />
                  </td>
                )}
                <td data-label="Statement">
                  {/* .cp-name-t is the ellipsis target — an anonymous text node
                      inside the flex .cp-name cannot take text-overflow, and the
                      name has to truncate in the compact mobile card. */}
                  <span className="cp-name"><Icon name="file-text" size={14} /><span className="cp-name-t">{r.name || '–'}</span></span>
                </td>
                <td data-label="Card">
                  {r.cardNamePart ? (
                    <span className="cp-card">
                      {r.cardInst && <span className="cp-card-inst">{r.cardInst}</span>}
                      {r.cardInst && <span className="cp-card-dot">·</span>}
                      <span className="cp-card-name">{r.cardNamePart}</span>
                    </span>
                  ) : (r.cardLabel || r.accountKey || '–')}
                </td>
                <td data-label="Cutover">{fmtDate(r.cutoverDate)}</td>
                <td data-label="Payment Due"><span className="cp-due">{fmtDate(r.paymentDate)}</span></td>
                <td className="num" data-label="Total">{money(r.cur, r.total)}</td>
                <td className="num" data-label="Minimum">{money(r.cur, r.minimum)}</td>
                <td className="num" data-label="Spendings">
                  <span className="cp-chip">{r.linkedCount}</span>
                </td>
                <td className="cp-td-actions" onClick={(e) => e.stopPropagation()}>
                  <button id={'cp-edit-' + r.id} className="list-btn blue" onClick={() => onEdit(r)}>
                    <Icon name="pencil" size={12} />Edit
                  </button>
                  <button id={'cp-delete-' + r.id} className="list-btn red" onClick={() => onDelete(r)}>
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
  function CreditPaymentFormModal({ initial, cards, onClose, onSave }) {
    const editing = !!initial.id;
    const now = new Date();
    const [f, setF] = React.useState({
      accountId: initial.accountId != null ? String(initial.accountId) : '',
      year: initial.year != null ? String(initial.year) : String(now.getFullYear()),
      month: initial.month != null ? String(initial.month) : String(now.getMonth() + 1),
      cutoverDate: initial.cutoverDate || '',
      paymentDate: initial.paymentDate || '',
      total: initial.total != null ? String(initial.total) : '',
      minimum: initial.minimum != null ? String(initial.minimum) : '',
      cur: initial.cur || 'TRY',
    });
    const [invalid, setInvalid] = React.useState({});
    const [formErr, setFormErr] = React.useState('');
    const set = (k, v) => { if (formErr) { setFormErr(''); setInvalid({}); } setF(p => ({ ...p, ...(typeof k === 'object' ? k : { [k]: v }) })); };

    function submit() {
      const v = window.HL_FORM.checkRequired([
        { key: 'accountId', label: 'Credit Card', ok: !!f.accountId },
        { key: 'paymentDate', label: 'Payment Due Date', ok: !!f.paymentDate },
      ]);
      setInvalid(v.keys); setFormErr(v.message);
      if (!v.ok) return;
      onSave({
        ...initial,
        accountId: Number(f.accountId),
        year: Number(f.year),
        month: Number(f.month),
        cutoverDate: f.cutoverDate,
        paymentDate: f.paymentDate,
        total: parseFloat(f.total) || 0,
        minimum: parseFloat(f.minimum) || 0,
        cur: f.cur,
      });
    }

    const years = [];
    for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 6; y--) years.push(y);

    return (
      <div className="backdrop">
        <div className="modal cp-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name={editing ? 'pencil' : 'plus-circle'} size={16} />{editing ? 'Edit Credit Payment' : 'Add Credit Payment'}</span>
              <span className="modal-sub">{editing ? (initial.name || '') : 'Record a credit-card statement'}</span>
            </div>
            <button id="cp-modal-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          <div className="modal-body">
            <div className={"form-field full" + (invalid.accountId ? ' field-invalid' : '')}>
              <span className="field-label">Credit Card<span className="field-required-mark">*</span></span>
              <StyledSelect id="cp-modal-card-select" className="field-input" value={f.accountId} onChange={(e) => set('accountId', e.target.value)}>
                <option value="">— Select Card —</option>
                {cards.map(c => (
                  <option key={c._dbId} value={c._dbId}>
                    {c.name}{c.number && c.number !== '–' ? ' ' + c.number : ''}{c.owner && c.owner !== 'Shared' ? ' (' + c.owner + ')' : ''}
                  </option>
                ))}
              </StyledSelect>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Statement Month</span>
                <StyledSelect id="cp-modal-month-select" className="field-input" value={f.month} onChange={(e) => set('month', e.target.value)}>
                  {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </StyledSelect>
              </div>
              <div className="form-field">
                <span className="field-label">Statement Year</span>
                <StyledSelect id="cp-modal-year-select" className="field-input" value={f.year} onChange={(e) => set('year', e.target.value)}>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </StyledSelect>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Cutover Date</span>
                <DateInput id="cp-modal-cutover-input" className="field-input" value={f.cutoverDate} onChange={(e) => set('cutoverDate', e.target.value)} />
              </div>
              <div className={"form-field" + (invalid.paymentDate ? ' field-invalid' : '')}>
                <span className="field-label">Payment Due Date<span className="field-required-mark">*</span></span>
                <DateInput id="cp-modal-payment-input" className="field-input" value={f.paymentDate} onChange={(e) => set('paymentDate', e.target.value)} />
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Total Payment</span>
                <div className="amount-input-wrap">
                  <CurrencyInput id="cp-modal-total-input" value={f.total} currency={f.cur} onChange={(v) => set('total', v)} />
                  <StyledSelect id="cp-modal-currency-select" className="field-input" value={f.cur} onChange={(e) => set('cur', e.target.value)}>
                    <option>TRY</option><option>USD</option><option>EUR</option>
                  </StyledSelect>
                </div>
              </div>
              <div className="form-field">
                <span className="field-label">Minimum Payment</span>
                <CurrencyInput id="cp-modal-minimum-input" value={f.minimum} currency={f.cur} onChange={(v) => set('minimum', v)} />
              </div>
            </div>
          </div>

          <window.HL_FORM.FormError message={formErr} id="cp-modal-form-error" />

          <div className="modal-foot">
            <button id="cp-modal-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            <button id="cp-modal-save-btn" className="amb ok" onClick={submit}><Icon name="save" size={14} />Save</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Statement detail / upload wizard ───────────────────────────────────────
  function CreditPaymentDetail({ record, onClose, onEdit, onDelete, onChanged }) {
    const [busy, setBusy] = React.useState(false);
    const [err, setErr] = React.useState(null);
    const [preview, setPreview] = React.useState(null);   // { rows: [...] }
    const [result, setResult] = React.useState(null);     // { imported, skipped }
    const fileRef = React.useRef(null);

    function pick() { if (fileRef.current) fileRef.current.click(); }

    async function onFile(file) {
      if (!file) return;
      setErr(null); setResult(null); setBusy(true);
      try {
        const res = await CP_API.previewStatement(record.id, file);
        setPreview(res);
        if (onChanged) onChanged();          // attachment filename now stored
      } catch (e) { setErr(e.message); }
      finally { setBusy(false); }
    }

    async function importRows() {
      if (!preview || !preview.rows || !preview.rows.length) return;
      setBusy(true); setErr(null);
      try {
        const res = await CP_API.confirmStatement(record.id, preview.rows);
        setResult(res);
        setPreview(null);
        if (onChanged) onChanged();
      } catch (e) { setErr(e.message); }
      finally { setBusy(false); }
    }

    async function download() {
      setErr(null);
      try { await CP_API.downloadStatement(record.id, record.statementFilename); }
      catch (e) { setErr(e.message); }
    }

    const rowCount = preview && preview.rows ? preview.rows.length : 0;

    return (
      <div className="backdrop">
        <div className="modal cp-detail-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name="file-text" size={16} />{record.name || 'Credit Payment'}</span>
              <span className="modal-sub">{record.cardLabel || record.accountKey || ''}</span>
            </div>
            <button id="cp-detail-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          <div className="modal-body">
            <div className="cp-detail-grid">
              <div className="cp-stat"><span className="cp-stat-l">Cutover</span><span className="cp-stat-v">{fmtDate(record.cutoverDate)}</span></div>
              <div className="cp-stat"><span className="cp-stat-l">Payment Due</span><span className="cp-stat-v">{fmtDate(record.paymentDate)}</span></div>
              <div className="cp-stat"><span className="cp-stat-l">Total</span><span className="cp-stat-v">{money(record.cur, record.total)}</span></div>
              <div className="cp-stat"><span className="cp-stat-l">Minimum</span><span className="cp-stat-v">{money(record.cur, record.minimum)}</span></div>
              <div className="cp-stat"><span className="cp-stat-l">Linked Spendings</span><span className="cp-stat-v">{record.linkedCount}</span></div>
            </div>

            <div className="cp-section">
              <span className="cp-section-title"><Icon name="paperclip" size={13} />Statement Document</span>
              {record.statementFilename ? (
                <div className="cp-file-row">
                  <span className="cp-file-name"><Icon name="file" size={13} />{record.statementFilename}</span>
                  <button id="cp-download-btn" className="list-btn blue" onClick={download}><Icon name="download" size={12} />Download</button>
                </div>
              ) : (
                <span className="cp-file-none">No statement uploaded yet.</span>
              )}

              <div className="cp-drop" id="cp-drop" onClick={pick}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }}
                onDragLeave={(e) => e.currentTarget.classList.remove('over')}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); onFile(e.dataTransfer.files[0]); }}>
                <Icon name="upload" size={18} />
                <span className="cp-drop-t">{record.statementFilename ? 'Replace statement' : 'Upload statement'} (CSV, XLS, XLSX, PDF)</span>
                <input id="cp-file-input" ref={fileRef} type="file" hidden accept=".csv,.xls,.xlsx,.pdf"
                  onChange={(e) => onFile(e.target.files[0])} />
              </div>

              {busy && <div className="cp-note"><Icon name="loader" size={13} />Working…</div>}
              {err && <div className="cp-error"><Icon name="alert-triangle" size={13} />{err}</div>}

              {preview && (
                <div className="cp-preview">
                  <span className="cp-preview-t">Parsed <b>{rowCount}</b> row{rowCount === 1 ? '' : 's'} from the statement.</span>
                  <button id="cp-import-btn" className="amb ok" onClick={importRows} disabled={busy || !rowCount}>
                    <Icon name="check" size={14} />Import {rowCount} Spending{rowCount === 1 ? '' : 's'}
                  </button>
                </div>
              )}
              {result && (
                <div className="cp-result"><Icon name="check-circle" size={13} />Imported {result.imported}, skipped {result.skipped}.</div>
              )}
            </div>
          </div>

          <div className="modal-foot">
            <button id="cp-detail-delete-btn" className="amb danger" style={{ marginRight: 'auto' }} onClick={() => onDelete(record)}><Icon name="trash-2" size={14} />Delete</button>
            <button id="cp-detail-edit-btn" className="amb ok" onClick={() => onEdit(record)}><Icon name="pencil" size={14} />Edit</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Delete confirm ──────────────────────────────────────────────────────────
  function DeleteCreditPaymentConfirm({ record, count, onClose, onConfirm }) {
    const batch = typeof count === 'number';
    return (
      <div className="backdrop">
        <div className="modal confirm-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name="trash-2" size={16} />{batch ? 'Delete Selected' : 'Delete Credit Payment'}</span>
            </div>
            <button id="cp-del-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>
          <div className="confirm-body">
            <div className="confirm-ico"><Icon name="alert-triangle" size={20} /></div>
            <div className="confirm-text">
              {batch
                ? <>Delete <b>{count}</b> selected credit {count === 1 ? 'payment' : 'payments'}?</>
                : <>Delete <b>{record.name}</b>?</>}
              <span className="warn">⚠ Linked spendings stay, but lose their statement link. This cannot be undone.</span>
            </div>
          </div>
          <div className="modal-foot">
            <button id="cp-del-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            <button id="cp-del-confirm-btn" className="amb danger" onClick={onConfirm}><Icon name="trash-2" size={14} />Delete</button>
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, {
    CreditPaymentTable, CreditPaymentFormModal, CreditPaymentDetail, DeleteCreditPaymentConfirm,
  });
})();
