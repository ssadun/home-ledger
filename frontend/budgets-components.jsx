// budgets-components.jsx — Home Ledger Budgets presentational components.
(function () {
  const Icon = window.Icon;
  const DateInput = window.DateInput;
  const { CATS } = window.LEDGER;
  const { grp, MONTHS } = window.LEDGER_FMT;
  const { WARN_AT, OVER_AT } = window.BUDGETS_DATA;

  // month-range label, e.g. "Jan – Dec 2026", "Sep 2026 – Jun 2027", or "From Jan 2026" (no end)
  function monthRange(start, end) {
    if (!start) return null;
    const [sy, sm] = start.split('-');
    if (!end) return `From ${MONTHS[+sm - 1]} ${sy}`;
    const [ey, em] = end.split('-');
    if (sy === ey) return `${MONTHS[+sm - 1]} – ${MONTHS[+em - 1]} ${ey}`;
    return `${MONTHS[+sm - 1]} ${sy} – ${MONTHS[+em - 1]} ${ey}`;
  }
  // months-left label + tone class — null when the budget has no end date
  function monthsLeftLabel(row) {
    if (row.periodState === 'open') return null;
    if (row.periodState === 'upcoming') return { txt: row.monthsLeft <= 1 ? 'Starts next mo' : `Starts in ${row.monthsLeft} mo`, tone: 'upcoming' };
    if (row.periodState === 'ended') return { txt: 'Ended', tone: 'ended' };
    if (row.monthsLeft === 0) return { txt: 'Final month', tone: 'final' };
    return { txt: `${row.monthsLeft} mo left`, tone: row.monthsLeft <= 1 ? 'final' : 'active' };
  }

  // status from spent / limit
  function statusOf(spent, limit) {
    if (!limit) return 'none';
    const r = spent / limit;
    if (r > OVER_AT) return 'over';
    if (r >= WARN_AT) return 'warn';
    return 'under';
  }
  const STATUS_LABEL = { under: 'On Track', warn: 'Near Limit', over: 'Over Budget', none: 'No Limit' };
  window.BUDGET_STATUS = { statusOf, STATUS_LABEL };

  // ── Budget card ─────────────────────────────────────────────────────────
  function BudgetCard({ row, onClick, flash }) {
    const c = CATS[row.cat] || CATS.shopping;
    const pct = row.limit ? row.spent / row.limit : 0;
    const barPct = Math.min(pct, 1) * 100;
    const over = row.spent - row.limit;
    const remaining = row.limit - row.spent;
    const ml = monthsLeftLabel(row);
    const range = monthRange(row.start, row.end);

    return (
      <button id={'bgt-card-' + row.cat} className={'bgt-card status-' + row.status + (flash ? ' bgt-flash' : '')}
        onClick={() => onClick(row)} title="Edit budget">
        <div className="bgt-card-top">
          <span className="cat-ico cat-chip" style={{ '--cat': c.color }}>
            <Icon name={c.icon} size={16} />
          </span>
          <div className="bgt-meta">
            <span className="bgt-name">{c.label}</span>
            {range && <span className="bgt-period">
              <Icon name="calendar" size={11} />{range}
              {ml && <React.Fragment><span className="bgt-dot-sep">·</span><span className={'bgt-months ml-' + ml.tone}>{ml.txt}</span></React.Fragment>}
            </span>}
          </div>
          <span className={'bgt-status-pill st-' + row.status}>
            <span className="dot" />{STATUS_LABEL[row.status]}
          </span>
        </div>

        <div className="bgt-amounts">
          <span className="bgt-spent">₺{grp(row.spent, 0)}</span>
          <span className="bgt-limit">/ ₺{grp(row.limit, 0)}</span>
          <span className={'bgt-pct st-' + row.status}>{Math.round(pct * 100)}%</span>
        </div>

        <div className="bgt-bar">
          <div className={'bgt-fill st-' + row.status} style={{ width: barPct + '%' }} />
        </div>

        <div className="bgt-foot">
          {row.status === 'over'
            ? <span className="bgt-remain over"><Icon name="trending-up" size={12} />₺{grp(over, 0)} over</span>
            : <span className="bgt-remain"><Icon name="wallet" size={12} />₺{grp(Math.max(0, remaining), 0)} left</span>}
          <span className="bgt-edit"><Icon name="pencil" size={12} />Edit</span>
        </div>
      </button>
    );
  }

  // ── Summary strip ─────────────────────────────────────────────────────
  function BudgetsSummary({ rows }) {
    const budgeted = rows.reduce((s, r) => s + r.limit, 0);
    const spent = rows.reduce((s, r) => s + r.spent, 0);
    const remaining = budgeted - spent;
    const overCount = rows.filter(r => r.status === 'over').length;
    const usedPct = budgeted ? Math.round((spent / budgeted) * 100) : 0;

    const cards = [
      { label: 'Budgeted', icon: 'target', cls: 'net', val: '₺' + grp(budgeted, 0), sub: 'Monthly limit' },
      { label: 'Spent', icon: 'arrow-up-right', cls: 'expense', val: '₺' + grp(spent, 0), sub: usedPct + '% of budget' },
      { label: 'Remaining', icon: 'wallet', cls: remaining < 0 ? 'expense' : 'income', val: (remaining < 0 ? '−₺' : '₺') + grp(Math.abs(remaining), 0), sub: remaining < 0 ? 'Over budget' : 'Still available' },
      { label: 'Over Budget', icon: 'alert-triangle', cls: overCount ? 'expense' : 'count', val: String(overCount), sub: overCount === 1 ? 'category' : 'categories' },
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

  // ── Add / Edit budget modal ─────────────────────────────────────────────
  function BudgetModal({ initial, existingCats, onClose, onSave, onRemove }) {
    const editing = !!initial.cat;
    const expenseCats = Object.keys(CATS).filter(k => CATS[k].kind === 'expense');
    const firstFree = expenseCats.find(k => !existingCats.includes(k)) || expenseCats[0];

    const [cat, setCat] = React.useState(initial.cat || firstFree);
    const [limit, setLimit] = React.useState(initial.limit != null ? String(initial.limit) : '');
    const [limitFocused, setLimitFocused] = React.useState(false);
    const [limitRaw, setLimitRaw] = React.useState(limit);
    const [start, setStart] = React.useState(initial.start != null ? initial.start : '2026-01-01');
    const [end, setEnd] = React.useState(initial.end != null ? initial.end : '2026-12-31');
    const limitNum = parseFloat(limit) || 0;
    const c = CATS[cat] || CATS.shopping;
    const spent = initial.spent || 0;
    const pct = limitNum ? Math.round((spent / limitNum) * 100) : 0;
    const badRange = start && end && end < start;

    function submit() {
      if (!limitNum || badRange) return;
      onSave({ cat, limit: limitNum, start, end });
    }
    function bump(d) {
      const next = String(Math.max(0, (parseFloat(limit) || 0) + d));
      setLimit(next);
      setLimitRaw(next);
    }
    function fmtTRY(v) {
      const n = parseFloat(v);
      if (isNaN(n)) return '';
      return n.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    function handleLimitFocus() { setLimitFocused(true); setLimitRaw(limit); }
    function handleLimitChange(e) {
      const raw = e.target.value;
      setLimitRaw(raw);
      const cleaned = raw.replace(/\./g, '').replace(',', '.');
      const n = parseFloat(cleaned);
      setLimit(isNaN(n) ? '' : String(n));
    }
    function handleLimitBlur() {
      setLimitFocused(false);
      const cleaned = limitRaw.replace(/\./g, '').replace(',', '.');
      const n = parseFloat(cleaned);
      if (!isNaN(n)) { setLimit(String(n)); setLimitRaw(String(n)); }
    }

    return (
      <div className="backdrop">
        <div className="modal budget-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name={editing ? 'pencil' : 'plus-circle'} size={16} />{editing ? 'Edit Budget' : 'New Budget'}</span>
              <span className="modal-sub">{editing ? 'Adjust the monthly limit for this category' : 'Set a monthly spending limit'}</span>
            </div>
            <button id="bgt-modal-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          <div className="modal-body">
            <div className="form-field full">
              <span className="field-label">Category</span>
              {editing ? (
                <div className="bgt-cat-readonly">
                  <span className="cat-ico cat-chip" style={{ '--cat': c.color }}>
                    <Icon name={c.icon} size={15} />
                  </span>
                  {c.label}
                </div>
              ) : (
                <select id="bgt-modal-category-select" className="field-input" value={cat} onChange={(e) => setCat(e.target.value)}>
                  {expenseCats.map(k => (
                    <option key={k} value={k} disabled={existingCats.includes(k)}>
                      {CATS[k].label}{existingCats.includes(k) ? ' — already set' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-field full">
              <span className="field-label">Monthly Limit</span>
              <div className="amt-num">
                <span className="field-currency-prefix">₺</span>
                <input id="bgt-modal-limit-input" className="field-input field-input-currency" type="text" inputMode="decimal" placeholder="0" value={limitFocused ? limitRaw : fmtTRY(limit)} onFocus={handleLimitFocus} onChange={handleLimitChange} onBlur={handleLimitBlur} />
                <div className="amt-step">
                  <button id="bgt-modal-limit-up-btn" type="button" tabIndex={-1} title="Increase" onClick={() => bump(500)}><Icon name="chevron-up" size={12} /></button>
                  <button id="bgt-modal-limit-down-btn" type="button" tabIndex={-1} title="Decrease" onClick={() => bump(-500)}><Icon name="chevron-down" size={12} /></button>
                </div>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Start Date <span className="fl-opt">(optional)</span></span>
                <DateInput id="bgt-modal-start-input" className="field-input" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="form-field">
                <span className="field-label">End Date <span className="fl-opt">(optional)</span></span>
                <DateInput id="bgt-modal-end-input" className="field-input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>

            {badRange && <div className="bgt-range-warn"><Icon name="alert-triangle" size={13} />End date must be on or after the start date.</div>}

            <div className="conv-preview">
              <div className="cp"><span className="cp-k">Spent This Month</span><span className="cp-v">₺{grp(spent, 0)}</span></div>
              <div className="cp"><span className="cp-k">New Limit</span><span className="cp-v">₺{grp(limitNum, 0)}</span></div>
              <div className="cp"><span className="cp-k">Utilization</span><span className="cp-v" style={{ color: pct > 100 ? 'var(--red)' : pct >= 80 ? 'var(--orange)' : 'var(--green)' }}>{pct}%</span></div>
            </div>
          </div>

          <div className="modal-foot">
            {editing && <button id="bgt-modal-remove-btn" className="amb danger" style={{ marginRight: 'auto' }} onClick={() => onRemove(initial.cat)}><Icon name="trash-2" size={14} />Remove</button>}
            <button id="bgt-modal-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            <button id="bgt-modal-save-btn" className="amb ok" onClick={submit}><Icon name="save" size={14} />{editing ? 'Save Changes' : 'Add Budget'}</button>
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, { BudgetCard, BudgetsSummary, BudgetModal });
})();
