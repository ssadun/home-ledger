// subscriptions-components.jsx — Presentational components for Subscriptions.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { CATS, FX, PAYERS } = window.LEDGER;
  const { grp, SYM, fmtDate, dowOf } = window.LEDGER_FMT;
  const { DateInput } = window;
  const { PayerBadge, PayingForCell, CategoryCell, PaymentMethodCell } = window;

  // ── Status badge ──────────────────────────────────────────────────────
  const STATUS_MAP = {
    active: { label: 'Active', icon: 'circle-check', cls: 'rec-active' },
    paused: { label: 'Paused', icon: 'pause-circle', cls: 'rec-paused' },
    ended:  { label: 'Ended',  icon: 'circle-x',     cls: 'rec-ended' },
  };
  function StatusBadge({ status }) {
    const s = STATUS_MAP[status] || STATUS_MAP.active;
    return (
      <span className={'rec-status-badge ' + s.cls}>
        <Icon name={s.icon} size={11} />{s.label}
      </span>
    );
  }

  // ── Frequency badge ───────────────────────────────────────────────────
  const FREQ_MAP = {
    daily:   { label: 'Daily',   icon: 'calendar-clock' },
    weekly:  { label: 'Weekly',  icon: 'calendar-range' },
    monthly: { label: 'Monthly', icon: 'calendar-days' },
  };
  function FreqBadge({ frequency, paymentDay }) {
    const f = FREQ_MAP[frequency] || FREQ_MAP.monthly;
    let dayLabel = '';
    if (frequency === 'monthly') {
      if (paymentDay === -1) dayLabel = ' (Last)';
      else if (paymentDay === 1) dayLabel = ' (1st)';
      else dayLabel = ' (' + paymentDay + ordSuffix(paymentDay) + ')';
    }
    return (
      <span className="rec-freq-badge">
        <Icon name={f.icon} size={11} />{f.label}{dayLabel}
      </span>
    );
  }
  function ordSuffix(n) {
    if (n >= 11 && n <= 13) return 'th';
    switch (n % 10) { case 1: return 'st'; case 2: return 'nd'; case 3: return 'rd'; default: return 'th'; }
  }

  // ── Weekend-rule badge ────────────────────────────────────────────────
  function WeekendBadge({ rule }) {
    if (!rule || rule === 'none') return <span className="rec-wr-none">No Adjust</span>;
    const isDefer = rule === 'defer';
    return (
      <span className={'rec-wr-badge ' + (isDefer ? 'wr-defer' : 'wr-advance')}>
        <Icon name={isDefer ? 'arrow-right' : 'arrow-left'} size={10} />
        {isDefer ? 'Defer' : 'Advance'}
      </span>
    );
  }

  // ── Summary strip for recurring ───────────────────────────────────────
  function RecSummaryStrip({ items }) {
    const active = items.filter(r => r.status === 'active');
    const paused = items.filter(r => r.status === 'paused');
    const ended  = items.filter(r => r.status === 'ended');
    let monthlyTRY = 0;
    active.forEach(r => {
      let m = r.tryAmount;
      if (r.frequency === 'daily') m *= 30;
      else if (r.frequency === 'weekly') m *= 4.33;
      monthlyTRY += m;
    });
    const cards = [
      { label: 'Monthly Cost', icon: 'calculator', cls: 'expense', val: '₺' + grp(monthlyTRY), sub: 'Active recurring' },
      { label: 'Active', icon: 'circle-check', cls: 'income', val: String(active.length), sub: 'Bills & subs' },
      { label: 'Paused', icon: 'pause-circle', cls: 'net', val: String(paused.length), sub: 'Temporarily off' },
      { label: 'Ended', icon: 'circle-x', cls: 'count', val: String(ended.length), sub: 'Cancelled' },
    ];
    return (
      <div className="summary-row">
        {cards.map(c => (
          <div className="summary-card" key={c.label}>
            <span className="summary-label"><Icon name={c.icon} size={13} />{c.label}</span>
            <span className={'summary-value ' + c.cls}>{c.val}</span>
            <span className="summary-sub">{c.sub}</span>
          </div>
        ))}
      </div>
    );
  }

  // ── Table row ─────────────────────────────────────────────────────────
  const REC_DEFAULT_ORDER = ['name', 'status', 'frequency', 'weekendRule', 'payer', 'paymentMethod', 'nextDue', 'amount'];
  const REC_CELLS = {
    name: (rec) => {
      const c = CATS[rec.cat] || CATS.subscriptions;
      return (
        <td key="name" data-label="Name">
          <span className="rec-name-cell">
            <span className="cat-ico cat-chip" style={{ '--cat': c.color }}>
              <Icon name={c.icon} size={13} />
            </span>
            <span className="rec-name-text">
              <span className="rec-name-primary">{rec.name}</span>
              <span className="rec-name-desc">{rec.desc}</span>
            </span>
          </span>
        </td>
      );
    },
    status: (rec) => <td key="status" data-label="Status"><StatusBadge status={rec.status} /></td>,
    frequency: (rec) => <td key="frequency" data-label="Frequency"><FreqBadge frequency={rec.frequency} paymentDay={rec.paymentDay} /></td>,
    weekendRule: (rec) => <td key="weekendRule" data-label="Weekend"><WeekendBadge rule={rec.weekendRule} /></td>,
    payer: (rec) => <td key="payer" data-label="Payer"><PayerBadge name={rec.payer} /></td>,
    paymentMethod: (rec) => <td key="paymentMethod" data-label="Payment Method"><PaymentMethodCell value={rec.paymentMethod} /></td>,
    nextDue: (rec) => (
      <td key="nextDue" data-label="Next Due">
        {rec.nextDue ? (
          <span className="td-date">{fmtDate(rec.nextDue)}<span className="dow">{dowOf(rec.nextDue)}</span></span>
        ) : <span className="for-na">–</span>}
      </td>
    ),
    amount: (rec) => (
      <td key="amount" className="num" data-label="Amount">
        <span className="amount-cell">
          <span className="amount-val expense"><span className="sign">−</span>{grp(rec.amount)}<span className="cur-sym suffix">{SYM[rec.cur]}</span></span>
        </span>
      </td>
    ),
  };
  function RecRow({ rec, flash, onEdit, onHistory, extraClass, order, selectable, selected, onToggleSelect }) {
    const keys = order && order.length ? order : REC_DEFAULT_ORDER;
    return (
      <tr className={'tx-row rec-row' + (flash ? ' row-flash' : '') + (selected ? ' row-selected' : '') + (extraClass ? ' ' + extraClass : '')} onClick={() => onEdit(rec)} title="Edit recurring item">
        {selectable && (
          <td className="td-select" data-label="" onClick={(e) => { e.stopPropagation(); onToggleSelect(rec.id); }}>
            <input id={'row-select-' + rec.id} type="checkbox" className="row-select-box" checked={!!selected}
              onChange={() => {}} aria-label="Select row" />
          </td>
        )}
        {keys.map(k => REC_CELLS[k] && REC_CELLS[k](rec))}
        {/* Mobile meta */}
        <td className="td-meta-mobile" data-label="Meta">
          <StatusBadge status={rec.status} />
          <span className="meta-sep">·</span>
          <FreqBadge frequency={rec.frequency} paymentDay={rec.paymentDay} />
          <span className="meta-sep">·</span>
          <PayerBadge name={rec.payer} />
        </td>
      </tr>
    );
  }

  // ── History panel (payment history for a recurring item) ──────────────
  function HistoryPanel({ rec, onClose }) {
    if (!rec) return null;
    const c = CATS[rec.cat] || CATS.subscriptions;
    return (
      <div className="backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal rec-history-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name="history" size={16} />Payment History</span>
              <span className="modal-sub">{rec.name}</span>
            </div>
            <button id="sub-history-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>
          <div className="modal-body" style={{ padding: 0 }}>
            <div className="rec-history-list">
              {rec.history && rec.history.length > 0 ? rec.history.map((h, i) => (
                <div key={i} className="rec-history-item">
                  <div className="rh-left">
                    <span className={'rh-dot ' + (h.status === 'paid' ? 'rh-paid' : 'rh-missed')}></span>
                    <span className="rh-date">{fmtDate(h.date)} <span className="dow">{dowOf(h.date)}</span></span>
                    {h.note && <span className="rh-note"><Icon name="info" size={10} />{h.note}</span>}
                  </div>
                  <div className="rh-right">
                    <span className="amount-val expense"><span className="sign">−</span><span className="cur-sym">{SYM[rec.cur]}</span>{grp(h.amount)}</span>
                    <span className={'cur-badge cur-' + rec.cur}>{rec.cur}</span>
                  </div>
                </div>
              )) : (
                <div className="empty-state" style={{ padding: '40px 20px' }}>
                  <Icon name="receipt-text" size={28} />
                  <span className="et">No payment history yet</span>
                </div>
              )}
            </div>
          </div>
          <div className="modal-foot">
            <button id="sub-history-close-foot-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Close</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Payment method select (reuse from controls.jsx via window) ────────
  const PM_TYPE_ICONS  = { credit: 'credit-card', debit: 'wallet-cards', cash: 'banknote', bank: 'landmark' };
  const PM_TYPE_COLORS = { credit: '#4f8ef7', debit: '#22c55e', cash: '#f97316', bank: '#8b5cf6' };

  function RecPaymentMethodSelect({ value, onChange }) {
    const accounts = (window.ACCOUNTS_DATA ? window.ACCOUNTS_DATA.ACCOUNTS : []).filter(a => ['credit','debit','cash'].includes(a.type) || (a.type === 'bank' && a.showInPaymentMethod));
    const groups = [
      { label: 'Credit Cards',  type: 'credit' },
      { label: 'Debit Cards',   type: 'debit' },
      { label: 'Cash',          type: 'cash' },
      { label: 'Bank Accounts', type: 'bank' },
    ];
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef();
    React.useEffect(() => {
      if (!open) return;
      function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
      document.addEventListener('mousedown', handle);
      return () => document.removeEventListener('mousedown', handle);
    }, [open]);
    const selected = value ? accounts.find(a => String(a.id) === String(value)) : null;
    const selectedGroup = selected ? groups.find(g => g.type === selected.type) : null;
    return (
      <div className="pm-select" ref={ref}>
        <button type="button" id="sub-payment-method-trigger-btn" className={'pm-trigger field-input' + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
          {selected && selectedGroup ? (
            <span className="pm-trigger-inner">
              <span className="pm-icon" style={{ color: PM_TYPE_COLORS[selectedGroup.type] }}>
                <Icon name={PM_TYPE_ICONS[selectedGroup.type]} size={14} /></span>
              <span className="pm-name">{selected.name}{selected.number && (selected.type === 'credit' || selected.type === 'debit') ? ' ' + selected.number : ''}{selected.owner && selected.owner !== 'Shared' ? ' (' + selected.owner + ')' : ''}</span>
            </span>
          ) : <span className="pm-placeholder">— Select —</span>}
          <Icon name="chevron-down" size={14} />
        </button>
        {open && (
          <div className="pm-dropdown">
            <div id="sub-payment-method-option-none" className="pm-option" onClick={() => { onChange(''); setOpen(false); }}>
              <span className="pm-placeholder">— Select —</span>
            </div>
            {groups.map(g => {
              const accts = accounts.filter(a => a.type === g.type);
              if (!accts.length) return null;
              return (
                <div key={g.type} className="pm-group">
                  <div className="pm-group-label">
                    <Icon name={PM_TYPE_ICONS[g.type]} size={12} color={PM_TYPE_COLORS[g.type]} />
                    {g.label}
                  </div>
                  {accts.map(a => (
                    <div key={a.id} id={'sub-payment-method-option-' + a.id} className={'pm-option' + (String(value) === String(a.id) ? ' selected' : '')}
                      onClick={() => { onChange(String(a.id)); setOpen(false); }}>
                      <span className="pm-icon" style={{ color: PM_TYPE_COLORS[g.type] }}>
                        <Icon name={PM_TYPE_ICONS[g.type]} size={13} /></span>
                      <span className="pm-name">{a.name}{a.number && (a.type === 'credit' || a.type === 'debit') ? ' ' + a.number : ''}{a.owner && a.owner !== 'Shared' ? ' (' + a.owner + ')' : ''}</span>
                      {String(value) === String(a.id) && <Icon name="check" size={12} color="var(--accent)" />}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Generic colored dropdown (Status, Weekend rule) ───────────────────
  // Reuses the pm-* dropdown chrome; each option carries its own accent color
  // so the trigger + options echo the old segmented-button colors.
  function ColorSelect({ value, onChange, options, id }) {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef();
    React.useEffect(() => {
      if (!open) return;
      function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
      document.addEventListener('mousedown', handle);
      return () => document.removeEventListener('mousedown', handle);
    }, [open]);
    const sel = options.find(o => o.value === value) || options[0];
    return (
      <div className="pm-select" ref={ref}>
        <button type="button" id={id + '-trigger-btn'} className={'pm-trigger field-input' + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
          <span className="pm-trigger-inner">
            <span className="pm-icon" style={{ color: sel.color }}><Icon name={sel.icon} size={14} /></span>
            <span className="pm-name" style={{ color: sel.color }}>{sel.label}</span>
          </span>
          <Icon name="chevron-down" size={14} />
        </button>
        {open && (
          <div className="pm-dropdown">
            {options.map(o => (
              <div key={o.value} id={o.id} className={'pm-option' + (o.value === value ? ' selected' : '')}
                onClick={() => { onChange(o.value); setOpen(false); }}>
                <span className="pm-icon" style={{ color: o.color }}><Icon name={o.icon} size={13} /></span>
                <span className="pm-name" style={{ color: o.color }}>{o.label}</span>
                {o.value === value && <Icon name="check" size={12} color={o.color} />}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Linked Transactions list (inside RecModal) ─────────────────────────
  function LinkedTransactionsList({ recId }) {
    const linkedTxs = (window.RECURRING_DATA && window.RECURRING_DATA.REC_TX_MAP && window.RECURRING_DATA.REC_TX_MAP[recId]) || [];
    if (!linkedTxs.length) {
      return (
        <div className="rec-linked-empty">
          <Icon name="link-2-off" size={28} />
          <span className="et">No Linked Transactions</span>
          <span className="es">Transactions matching this recurring item will appear here.</span>
        </div>
      );
    }
    return (
      <div className="rec-linked-list">
        <div className="rec-linked-header">
          <span className="rec-linked-count"><Icon name="link-2" size={12} />{linkedTxs.length} Transaction{linkedTxs.length !== 1 ? 's' : ''} Linked</span>
        </div>
        {linkedTxs.map(tx => {
          const c = CATS[tx.cat] || CATS.shopping;
          return (
            <a key={tx.id} className="rec-linked-row" href={'Spending.html?month=' + (parseInt(tx.date.slice(5,7)) - 1) + '&year=' + tx.date.slice(0,4) + '&highlight=' + tx.id} title="View in Spending">
              <div className="rl-left">
                <span className="cat-ico cat-chip" style={{ '--cat': c.color }}>
                  <Icon name={c.icon} size={11} />
                </span>
                <div className="rl-info">
                  <span className="rl-desc">{tx.desc}</span>
                  <span className="rl-date">{fmtDate(tx.date)} <span className="dow">{dowOf(tx.date)}</span></span>
                </div>
              </div>
              <div className="rl-right">
                <span className={'amount-val ' + tx.type}><span className="sign">{tx.type === 'expense' ? '−' : '+'}</span>{grp(tx.amt)}</span>
                <span className={'cur-badge cur-' + tx.cur}>{tx.cur}</span>
                <Icon name="external-link" size={11} className="rl-ext" />
              </div>
            </a>
          );
        })}
      </div>
    );
  }

  // ── Add / Edit Recurring modal ────────────────────────────────────────
  function RecModal({ initial, onClose, onSave, onDelete }) {
    const editing = !!initial.id;
    const [tab, setTab] = React.useState('details');
    const linkedCount = editing && window.RECURRING_DATA && window.RECURRING_DATA.REC_TX_MAP
      ? (window.RECURRING_DATA.REC_TX_MAP[initial.id] || []).length : 0;

    const [f, setF] = React.useState({
      name: initial.name || '',
      desc: initial.desc || '',
      cat: initial.cat || 'subscriptions',
      status: initial.status || 'active',
      frequency: initial.frequency || 'monthly',
      paymentDay: initial.paymentDay != null ? String(initial.paymentDay) : '1',
      weekendRule: initial.weekendRule || 'defer',
      startDate: initial.startDate || new Date().toISOString().slice(0, 10),
      endDate: initial.endDate || '',
      payer: initial.payer || 'Sadun',
      payingFor: initial.payingFor || 'Shared',
      cur: initial.cur || 'TRY',
      amount: initial.amount != null ? String(initial.amount) : '',
      paymentMethod: initial.paymentMethod || '',
    });
    const [invalid, setInvalid] = React.useState({});
    const [formErr, setFormErr] = React.useState('');
    const set = (k, v) => { if (formErr) { setFormErr(''); setInvalid({}); } setF(p => ({ ...p, ...(typeof k === 'object' ? k : { [k]: v }) })); };
    const amtNum = parseFloat(f.amount) || 0;
    const tryV = +(amtNum * FX[f.cur].toTRY).toFixed(2);

    function submit() {
      const v = window.HL_FORM.checkRequired([
        { key: 'name', label: 'Name', ok: !!f.name.trim() },
        { key: 'amount', label: 'Amount', ok: !!amtNum },
        { key: 'paymentMethod', label: 'Payment Method', ok: !!f.paymentMethod },
      ]);
      setInvalid(v.keys); setFormErr(v.message);
      if (!v.ok) return;
      const saved = {
        ...initial,
        name: f.name.trim(), desc: f.desc.trim(), cat: f.cat, status: f.status,
        frequency: f.frequency, paymentDay: parseInt(f.paymentDay) || 1,
        weekendRule: f.weekendRule,
        startDate: f.startDate, endDate: f.endDate || null,
        payer: f.payer, payingFor: f.payingFor, cur: f.cur, amount: amtNum,
        paymentMethod: f.paymentMethod,
        tryAmount: tryV,
        usdAmount: +(amtNum * FX[f.cur].toUSD).toFixed(2),
      };
      if (!editing) {
        saved.id = 'rec-' + Date.now();
        saved.history = [];
        saved.lastPaid = null;
        saved.nextDue = f.startDate;
      }
      onSave(saved);
    }

    // Payment day options for monthly
    const dayOptions = [];
    for (let i = 1; i <= 28; i++) dayOptions.push(i);
    dayOptions.push(-1); // last day

    return (
      <div className="backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal rec-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name={editing ? 'pencil' : 'plus-circle'} size={16} />{editing ? 'Edit Subscription' : 'Add Subscription'}</span>
              <span className="modal-sub">{editing ? initial.name : 'Set up a new bill or subscription'}</span>
            </div>
            <button id="sub-modal-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          {/* Tab bar — only in edit mode */}
          {editing && (
            <div className="rec-modal-tabs">
              <button id="sub-modal-tab-details-btn" className={'rec-modal-tab' + (tab === 'details' ? ' active' : '')} onClick={() => setTab('details')}>
                <Icon name="settings-2" size={13} />Details
              </button>
              <button id="sub-modal-tab-linked-btn" className={'rec-modal-tab' + (tab === 'linked' ? ' active' : '')} onClick={() => setTab('linked')}>
                <Icon name="link-2" size={13} />Linked Transactions
                {linkedCount > 0 && <span className="rec-tab-count">{linkedCount}</span>}
              </button>
            </div>
          )}

          {/* Details tab */}
          {(tab === 'details' || !editing) && (
            <div className="modal-body">
              {/* Row 1: Name + Category */}
              <div className="form-grid">
                <div className={"form-field" + (invalid.name ? ' field-invalid' : '')}>
                  <span className="field-label">Name<span className="field-required-mark">*</span></span>
                  <input id="sub-modal-name-input" className="field-input" placeholder="e.g. Netflix, Rent, Gym" value={f.name} onChange={e => set('name', e.target.value)} />
                </div>
                <div className="form-field">
                  <span className="field-label">Category</span>
                  <StyledSelect id="sub-modal-category-select" className="field-input" value={f.cat} onChange={e => set('cat', e.target.value)}>
                    {Object.keys(CATS).filter(k => CATS[k].kind === 'expense').map(k => (
                      <option key={k} value={k}>{CATS[k].label}</option>
                    ))}
                  </StyledSelect>
                </div>
              </div>

              {/* Row 2: Payer + Paying For */}
              <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Payer</span>
                  <StyledSelect id="sub-modal-payer-select" className="field-input" value={f.payer} onChange={e => set('payer', e.target.value)}>
                    {PAYERS.map(p => <option key={p} value={p}>{p}</option>)}
                  </StyledSelect>
                </div>
                <div className="form-field">
                  <span className="field-label">Paying For</span>
                  <StyledSelect id="sub-modal-payingfor-select" className="field-input" value={f.payingFor} onChange={e => set('payingFor', e.target.value)}>
                    <option value="Shared">Shared</option>
                    {PAYERS.map(p => <option key={p} value={p}>{p}</option>)}
                    <option value="–">Other</option>
                  </StyledSelect>
                </div>
              </div>

              {/* Row 3: Frequency + Payment Day */}
              <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Frequency</span>
                  <StyledSelect id="sub-modal-frequency-select" className="field-input" value={f.frequency} onChange={e => set('frequency', e.target.value)}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </StyledSelect>
                </div>
                {f.frequency === 'monthly' && (
                  <div className="form-field">
                    <span className="field-label">Payment Day</span>
                    <StyledSelect id="sub-modal-paymentday-select" className="field-input" value={f.paymentDay} onChange={e => set('paymentDay', e.target.value)}>
                      {dayOptions.map(d => (
                        <option key={d} value={d}>{d === -1 ? 'Last Day of Month' : d === 1 ? '1st Day of Month' : 'Day ' + d}</option>
                      ))}
                    </StyledSelect>
                  </div>
                )}
              </div>

              {/* Row 4: Status + Weekend/Holiday Rule */}
              <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Status</span>
                  <ColorSelect id="sub-modal-status" value={f.status} onChange={v => set('status', v)} options={[
                    { value: 'active', label: 'Active', icon: 'circle-check', color: 'var(--green)',  id: 'sub-modal-status-active-btn' },
                    { value: 'paused', label: 'Paused', icon: 'pause-circle', color: 'var(--yellow)', id: 'sub-modal-status-paused-btn' },
                    { value: 'ended',  label: 'Ended',  icon: 'circle-x',     color: 'var(--slate)',  id: 'sub-modal-status-ended-btn' },
                  ]} />
                </div>
                <div className="form-field">
                  <span className="field-label">On Weekend / Holiday</span>
                  <ColorSelect id="sub-modal-weekend" value={f.weekendRule} onChange={v => set('weekendRule', v)} options={[
                    { value: 'defer',   label: 'Defer',     icon: 'arrow-right', color: 'var(--orange)', id: 'sub-modal-weekend-defer-btn' },
                    { value: 'advance', label: 'Advance',   icon: 'arrow-left',  color: 'var(--sky)',    id: 'sub-modal-weekend-advance-btn' },
                    { value: 'none',    label: 'No Change', icon: 'minus',       color: 'var(--slate)',  id: 'sub-modal-weekend-none-btn' },
                  ]} />
                </div>
              </div>

              {/* Row 5: Start & End date */}
              <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Start Date</span>
                  <DateInput id="sub-modal-start-date-input" className="field-input" value={f.startDate} onChange={e => set('startDate', e.target.value)} />
                </div>
                <div className="form-field">
                  <span className="field-label">End Date <span style={{ color: 'var(--muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></span>
                  <DateInput id="sub-modal-end-date-input" className="field-input" value={f.endDate} onChange={e => set('endDate', e.target.value)} min={f.startDate} placeholder="No end date" />
                </div>
              </div>

              {/* Row 6: Payment Method */}
              <div className="form-grid">
                <div className={"form-field full" + (invalid.paymentMethod ? ' field-invalid' : '')}>
                  <span className="field-label">Payment Method<span className="field-required-mark">*</span></span>
                  <RecPaymentMethodSelect value={f.paymentMethod} onChange={v => set('paymentMethod', v)} />
                </div>
              </div>

              {/* Row 7: Amount */}
              <div className="form-grid">
                <div className={"form-field full" + (invalid.amount ? ' field-invalid' : '')}>
                  <span className="field-label">Amount<span className="field-required-mark">*</span></span>
                  <div className="amount-input-wrap">
                    <input id="sub-modal-amount-input" className="field-input" type="number" step="0.01" min="0" placeholder="0.00" value={f.amount} onChange={e => set('amount', e.target.value)} />
                    <StyledSelect id="sub-modal-currency-select" className="field-input" value={f.cur} onChange={e => set('cur', e.target.value)}>
                      <option>TRY</option><option>USD</option><option>EUR</option>
                    </StyledSelect>
                  </div>
                </div>
              </div>

              {/* Conversion preview */}
              <div className="conv-preview">
                <div className="cp"><span className="cp-k">Monthly (TRY)</span><span className="cp-v">₺{grp(tryV)}</span></div>
                <div className="cp"><span className="cp-k">Yearly (TRY)</span><span className="cp-v">₺{grp(tryV * 12)}</span></div>
              </div>
            </div>
          )}

          {/* Linked Transactions tab */}
          {tab === 'linked' && editing && (
            <div className="modal-body" style={{ padding: 0 }}>
              <LinkedTransactionsList recId={initial.id} />
            </div>
          )}

          {tab === 'details' && <window.HL_FORM.FormError message={formErr} id="sub-modal-form-error" />}

          <div className="modal-foot">
            {editing && <button id="sub-modal-delete-btn" className="amb danger" style={{ marginRight: 'auto' }} onClick={() => onDelete(initial)}><Icon name="trash-2" size={14} />Delete</button>}
            <button id="sub-modal-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            {(tab === 'details' || !editing) && <button id="sub-modal-save-btn" className="amb ok" onClick={submit}><Icon name="save" size={14} />Save</button>}
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, { StatusBadge, FreqBadge, WeekendBadge, RecSummaryStrip, RecRow, HistoryPanel, RecModal });
})();
