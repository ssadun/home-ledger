// controls.jsx — filter bar, summary strip, pagination, add/edit modal, delete confirm.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { CATS, PAYERS, FX } = window.LEDGER;
  const { grp, SYM, MONTHS } = window.LEDGER_FMT;

  // ── Payment method icons map ───────────────────────────────────────────
  const PM_TYPE_ICONS  = { credit: 'credit-card', debit: 'wallet-cards', cash: 'banknote' };
  const PM_TYPE_COLORS = { credit: '#4f8ef7', debit: '#22c55e', cash: '#f97316' };

  // ── Calendar enhancer — month + year dropdowns ─────────────────────────
  // Flatpickr ships a month dropdown but only a year spinner; this swaps the
  // year spinner for a dropdown so users can jump years quickly. Idempotent and
  // shared via window so it's defined once regardless of script load order.
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

  // ── DateInput — flatpickr wrapper for dark-theme date picking ──────────
  function DateInput({ value, onChange, min, max, className, placeholder, id }) {
    const inputRef = React.useRef(null);
    const wrapRef  = React.useRef(null);
    const fpRef    = React.useRef(null);

    function syncWidth(fp) {
      if (!wrapRef.current || !fp.calendarContainer) return;
      const w = wrapRef.current.getBoundingClientRect().width;
      if (w > 0) fp.calendarContainer.style.width = w + 'px';
    }

    React.useEffect(() => {
      if (!inputRef.current || typeof flatpickr === 'undefined') return;
      fpRef.current = flatpickr(inputRef.current, {
        dateFormat:    'Y-m-d',
        defaultDate:   value || null,
        minDate:       min   || null,
        maxDate:       max   || null,
        disableMobile: true,
        monthSelectorType: 'dropdown',
        onReady: (_, __, fp) => { syncWidth(fp); window.HL_enhanceFpYear(fp); },
        onOpen:  (_, __, fp) => syncWidth(fp),
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

    React.useEffect(() => { if (fpRef.current) fpRef.current.set('minDate', min || null); }, [min]);
    React.useEffect(() => { if (fpRef.current) fpRef.current.set('maxDate', max || null); }, [max]);

    return (
      <div ref={wrapRef} className="date-input-wrap">
        <input
          id={id}
          ref={inputRef}
          type="text"
          className={className || 'field-input'}
          placeholder={placeholder || 'YYYY-MM-DD'}
          readOnly
        />
        <span className="date-input-icon"><Icon name="calendar" size={14} /></span>
      </div>
    );
  }

  function PaymentMethodSelect({ value, onChange, groups, accounts, id }) {
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
        <button type="button" id={id} className={'pm-trigger field-input' + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
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
            <div id={(id || 'pm') + '-option-none'} className="pm-option" onClick={() => { onChange(''); setOpen(false); }}>
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
                    <div key={a.id} id={(id || 'pm') + '-option-' + a.id} className={'pm-option' + (String(value) === String(a.id) ? ' selected' : '')}
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

  // ── Currency-aware input (formats on blur) ──────────────────────────────
  function parseCurrencyInput(raw, currency) {
    if (!raw) return '';
    let cleaned = currency === 'TRY'
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? '' : String(num);
  }
  function fmtCurrencyVal(value, currency) {
    if (!value && value !== 0) return '';
    const num = parseFloat(value);
    if (isNaN(num)) return '';
    return currency === 'TRY'
      ? num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function CurrencyInput({ value, currency, onChange, id }) {
    const [focused, setFocused] = React.useState(false);
    const [raw, setRaw] = React.useState(value || '');
    React.useEffect(() => { if (!focused) setRaw(value || ''); }, [value, focused]);
    function handleFocus() { setFocused(true); setRaw(value || ''); }
    function handleChange(e) { setRaw(e.target.value); onChange(parseCurrencyInput(e.target.value, currency)); }
    function handleBlur() {
      setFocused(false);
      const parsed = parseCurrencyInput(raw, currency);
      setRaw(parsed);
      onChange(parsed);
    }
    return (
      <input id={id} className="field-input" type="text" inputMode="decimal"
        placeholder={currency === 'TRY' ? '0,00' : '0.00'}
        value={focused ? raw : fmtCurrencyVal(value, currency)}
        onFocus={handleFocus} onChange={handleChange} onBlur={handleBlur} />
    );
  }

  // ── Select with chevron ────────────────────────────────────────────────
  function Select({ label, icon, value, onChange, children, id }) {
    return (
      <div className="filter-field">
        <span className="filter-label">{icon && <Icon name={icon} size={11} />}{label}</span>
        <div className="select-wrap">
          <StyledSelect id={id} className="sel" value={value} onChange={(e) => onChange(e.target.value)}>{children}</StyledSelect>
        </div>
      </div>
    );
  }

  // ── Filter bar ──────────────────────────────────────────────────────────
  function FilterBar({ month, year, onMonthStep, type, setType, payer, setPayer, payingFor, setPayingFor, cat, setCat, source, setSource, search, setSearch, onAdd, onScan, onResetCols, onResetOrder, orderIsDefault, extra, popActions }) {
    const [open, setOpen] = React.useState(false);
    const anchorRef = React.useRef(null);
    React.useEffect(() => {
      if (!open) return;
      const onDoc = (e) => { if (anchorRef.current && !anchorRef.current.contains(e.target)) setOpen(false); };
      const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
      return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    const forLabel = (v) => v === '–' ? 'N/A' : v;
    // Recurring source labels
    const recItems = window.RECURRING_DATA ? window.RECURRING_DATA.RECURRING : [];
    const sourceLabel = (v) => {
      if (v === 'recurring') return 'Recurring';
      if (v === 'manual') return 'Manual';
      const rec = recItems.find(r => r.id === v);
      return rec ? rec.name : v;
    };
    const active = [
      type !== 'all' && { key: 'type', label: 'Type', val: cap(type), clear: () => setType('all') },
      payer !== 'all' && { key: 'payer', label: 'Payer', val: payer, clear: () => setPayer('all') },
      payingFor !== 'all' && { key: 'payingFor', label: 'Paying For', val: forLabel(payingFor), clear: () => setPayingFor('all') },
      cat !== 'all' && { key: 'cat', label: 'Category', val: CATS[cat].label, clear: () => setCat('all') },
      source !== 'all' && { key: 'source', label: 'Source', val: sourceLabel(source), clear: () => setSource('all') },
    ].filter(Boolean);
    const clearAll = () => { setType('all'); setPayer('all'); setPayingFor('all'); setCat('all'); setSource('all'); };

    return (
      <div className="filter-wrap">
        <div className="filter-bar">
          <div className="filter-field ff-period">
            <span className="filter-label"><Icon name="calendar" size={11} />Period</span>
            <div className="month-step">
              <button id="filter-period-prev-btn" className="ms-btn" onClick={() => onMonthStep(-1)} title="Previous month"><Icon name="chevron-left" size={14} /></button>
              <span className="ms-label"><Icon name="calendar-days" size={13} />{MONTHS[month]} {year}</span>
              <button id="filter-period-next-btn" className="ms-btn" onClick={() => onMonthStep(1)} title="Next month"><Icon name="chevron-right" size={14} /></button>
            </div>
          </div>

          <div className="filter-field ff-search">
            <span className="filter-label"><Icon name="search" size={11} />Search</span>
            <div className="search-wrap">
              <Icon name="search" size={13} />
              <input id="filter-search-input" className="search-input" placeholder="Description…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {extra}

          <div className="filter-field ff-filters">
            <span className="filter-label"><Icon name="sliders-horizontal" size={11} />Filters</span>
            <div className="filters-anchor" ref={anchorRef}>
              <button id="filter-toggle-btn" className={'filters-btn' + (active.length ? ' has' : '') + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
                <Icon name="sliders-horizontal" size={14} /><span className="filters-text">Filters</span>
                {active.length > 0 && <span className="filters-count">{active.length}</span>}
                <svg className="filters-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {open && (
                <div className="filters-pop">
                  {popActions && <div className="fp-actions"><div className="filters-pop-head"><span>More Actions</span></div>{popActions}</div>}
                  <div className="filters-pop-head">
                    <span>Filter By Column</span>
                    {active.length > 0 && <button id="filter-clear-all-btn" className="fp-clear" onClick={clearAll}><Icon name="x" size={12} />Clear All</button>}
                  </div>
                  <Select id="filter-type-select" label="Type" icon="filter" value={type} onChange={setType}>
                    <option value="all">All Types</option>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </Select>
                  <Select id="filter-payer-select" label="Payer" icon="user" value={payer} onChange={setPayer}>
                    <option value="all">All Payers</option>
                    {PAYERS.map(p => <option key={p} value={p}>{p}</option>)}
                  </Select>
                  <Select id="filter-payingfor-select" label="Paying For" icon="users" value={payingFor} onChange={setPayingFor}>
                    <option value="all">All Beneficiaries</option>
                    <option value="Shared">Shared</option>
                    {PAYERS.map(p => <option key={p} value={p}>{p}</option>)}
                    <option value="–">N/A</option>
                  </Select>
                  <Select id="filter-category-select" label="Category" icon="tag" value={cat} onChange={setCat}>
                    <option value="all">All Categories</option>
                    {Object.keys(CATS).map(k => <option key={k} value={k}>{CATS[k].label}</option>)}
                  </Select>
                  <Select id="filter-source-select" label="Source" icon="repeat" value={source} onChange={setSource}>
                    <option value="all">All Sources</option>
                    <option value="recurring">Recurring Only</option>
                    <option value="manual">Manual Only</option>
                    {recItems.filter(r => r.status !== 'ended').map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </Select>
                  {(onResetCols || onResetOrder) && (
                    <div className="fp-col-tools">
                      {onResetCols && <window.FitColumnsButton onClick={onResetCols} />}
                      {onResetOrder && <window.ResetOrderButton onClick={onResetOrder} disabled={orderIsDefault} />}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>

        {active.length > 0 && (
          <div className="active-chips">
            <span className="chips-lead"><Icon name="filter" size={12} />Active</span>
            {active.map(a => (
              <button key={a.key} id={'filter-chip-' + a.key} className="chip" onClick={a.clear} title={'Clear ' + a.label + ' filter'}>
                <span className="chip-k">{a.label}:</span><span className="chip-v">{a.val}</span><Icon name="x" size={11} />
              </button>
            ))}
            <button id="filter-chips-clear-btn" className="chip chip-clear" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>
    );
  }

  // ── Summary strip ─────────────────────────────────────────────────────
  function SummaryStrip({ rows }) {
    let inc = 0, exp = 0;
    rows.forEach(t => { if (t.type === 'income') inc += t.tryV; else exp += t.tryV; });
    const net = inc - exp;
    const cards = [
      { label: 'Income', icon: 'arrow-down-left', cls: 'income', val: '₺' + grp(inc), sub: 'Money in' },
      { label: 'Expense', icon: 'arrow-up-right', cls: 'expense', val: '₺' + grp(exp), sub: 'Money out' },
      { label: 'Net', icon: 'scale', cls: 'net', val: (net < 0 ? '−₺' : '₺') + grp(Math.abs(net)), sub: net < 0 ? 'Over budget' : 'Surplus' },
      { label: 'Transactions', icon: 'receipt', cls: 'count', val: String(rows.length), sub: 'In view' },
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

  // ── Pagination ──────────────────────────────────────────────────────────
  function Pagination({ page, pages, total, start, end, perPage, setPage, setPerPage }) {
    const nums = [];
    if (pages <= 7) { for (let i = 1; i <= pages; i++) nums.push(i); }
    else {
      nums.push(1);
      let lo = Math.max(2, page - 1), hi = Math.min(pages - 1, page + 1);
      if (lo > 2) nums.push('…');
      for (let i = lo; i <= hi; i++) nums.push(i);
      if (hi < pages - 1) nums.push('…');
      nums.push(pages);
    }
    return (
      <div className="pagination">
        <span className="page-info">
          <span className="page-count">Showing <b>{total ? start + 1 : 0}–{end}</b> of <b>{total}</b></span>
          <span className="sep">|</span>
          <span className="pager-rows">
            <span className="pager-rows-label">Rows</span>
            <div className="select-wrap">
              <StyledSelect id="pagination-rows-select" className="sel" style={{ minWidth: 62, padding: '4px 10px' }} value={perPage} onChange={(e) => setPerPage(+e.target.value)}>
                <option>10</option><option>20</option><option>30</option><option>40</option><option>50</option><option>100</option>
              </StyledSelect>
            </div>
          </span>
        </span>
        <div className="page-controls">
          <button id="pagination-prev-btn" className="page-btn" disabled={page === 1} onClick={() => setPage(page - 1)}><Icon name="chevron-left" size={14} /><span className="page-btn-label">Prev</span></button>
          {nums.map((n, i) => n === '…'
            ? <span className="page-ellipsis" key={'e' + i}>…</span>
            : <button key={n} id={'pagination-page-' + n + '-btn'} className={'page-btn' + (n === page ? ' active' : '')} onClick={() => setPage(n)}>{n}</button>)}
          <button id="pagination-next-btn" className="page-btn" disabled={page === pages || pages === 0} onClick={() => setPage(page + 1)}><span className="page-btn-label">Next</span><Icon name="chevron-right" size={14} /></button>
        </div>
      </div>
    );
  }

  // ── Add / Edit modal ──────────────────────────────────────────────────
  function TxModal({ initial, onClose, onSave, onDelete, scan }) {
    const editing = !!initial.id;
    const [f, setF] = React.useState({
      date: initial.date || new Date().toISOString().slice(0, 10),
      payer: initial.payer || 'Sadun',
      payingFor: initial.payingFor || 'Shared',
      cat: initial.cat || 'groceries',
      desc: initial.desc || '',
      type: initial.type || 'expense',
      cur: initial.cur || 'TRY',
      amt: initial.amt != null ? String(initial.amt) : '',
      paymentMethod: initial.paymentMethod || '',
    });
    const set = (k, v) => setF(p => ({ ...p, ...(typeof k === 'object' ? k : { [k]: v }) }));
    const amtNum = parseFloat(f.amt) || 0;
    const tryV = +(amtNum * FX[f.cur].toTRY).toFixed(2);
    const usdV = +(amtNum * FX[f.cur].toUSD).toFixed(2);

    // Every field must be filled before a record can be created/saved.
    const valid = !!(f.date && f.cat && f.payer && f.payingFor && f.type && f.cur
      && f.desc.trim() && amtNum && f.paymentMethod);
    function submit() {
      if (!valid) return;
      onSave({ ...initial, date: f.date, payer: f.payer, payingFor: f.payingFor, cat: f.cat, desc: f.desc.trim(), type: f.type, cur: f.cur, amt: amtNum, paymentMethod: f.paymentMethod, tryV, usdV });
    }
    const paymentAccounts = (window.ACCOUNTS_DATA ? window.ACCOUNTS_DATA.ACCOUNTS : []).filter(a => ['credit','debit','cash'].includes(a.type));
    const pmGroups = [
      { label: 'Credit Cards', type: 'credit', icon: 'credit-card' },
      { label: 'Debit Cards',  type: 'debit',  icon: 'wallet-cards' },
      { label: 'Cash',         type: 'cash',   icon: 'banknote' },
    ];

    return (
      <div className="backdrop">
        <div className="modal tx-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name={editing ? 'pencil' : 'plus-circle'} size={16} />{editing ? 'Edit Transaction' : 'Add Spending'}</span>
              <span className="modal-sub">{editing ? (initial.desc || initial.id) : (scan ? 'Pre-filled from receipt · review & save' : 'Record a new income or expense')}</span>
            </div>
            <button id="tx-modal-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          <div className="modal-body">
            {scan && <div className="scan-banner"><Icon name="sparkles" size={14} />Details extracted from your receipt — double-check before saving.</div>}

            {/* Source Recurring — read-only link field (only when editing a linked TX) */}
            {editing && (() => {
              const recMap = window.RECURRING_DATA && window.RECURRING_DATA.TX_REC_MAP;
              const rec = recMap && recMap[initial.id];
              if (!rec) return null;
              return (
                <div className="form-field full">
                  <span className="field-label">Source Recurring</span>
                  <a className="src-rec-link" href={'Recurring.html#rec=' + rec.id} title={'Open recurring record: ' + rec.name}>
                    <Icon name="repeat" size={13} />
                    <span className="src-rec-name">{rec.name}</span>
                    <span className="src-rec-freq">{rec.frequency} · {rec.status}</span>
                    <Icon name="external-link" size={11} />
                  </a>
                </div>
              );
            })()}

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Date</span>
                <DateInput id="tx-modal-date-input" className="field-input" value={f.date} onChange={(e) => set('date', e.target.value)} />
              </div>
              <div className="form-field">
                <span className="field-label">Category</span>
                <StyledSelect id="tx-modal-category-select" className="field-input" value={f.cat} onChange={(e) => set('cat', e.target.value)}>
                  {Object.keys(CATS).map(k => <option key={k} value={k}>{CATS[k].label}</option>)}
                </StyledSelect>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Payer</span>
                <StyledSelect id="tx-modal-payer-select" className="field-input" value={f.payer} onChange={(e) => set('payer', e.target.value)}>
                  {PAYERS.map(p => <option key={p} value={p}>{p}</option>)}
                </StyledSelect>
              </div>
              <div className="form-field">
                <span className="field-label">Paying For</span>
                <StyledSelect id="tx-modal-payingfor-select" className="field-input" value={f.payingFor} onChange={(e) => set('payingFor', e.target.value)}>
                  <option value="Shared">Shared</option>
                  {PAYERS.map(p => <option key={p} value={p}>{p}</option>)}
                  <option value="–">Other</option>
                </StyledSelect>
              </div>
            </div>

            <div className="form-field full">
              <span className="field-label">Description</span>
              <input id="tx-modal-desc-input" className="field-input" placeholder="e.g. Migros weekly shop" value={f.desc} onChange={(e) => set('desc', e.target.value)} />
            </div>

            <div className="form-grid">
              <div className="form-field full">
                <span className="field-label">Payment Method</span>
                <PaymentMethodSelect id="tx-modal-payment-method" value={f.paymentMethod} onChange={(v) => set('paymentMethod', v)}
                  groups={pmGroups} accounts={paymentAccounts} />
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field full">
                <span className="field-label">Amount</span>
                <div className="amount-input-wrap">
                  <CurrencyInput id="tx-modal-amount-input" value={f.amt} currency={f.cur} onChange={(v) => set('amt', v)} />
                  <StyledSelect id="tx-modal-currency-select" className="field-input" value={f.cur} onChange={(e) => set('cur', e.target.value)}>
                    <option>TRY</option><option>USD</option><option>EUR</option>
                  </StyledSelect>
                </div>
              </div>
            </div>
          </div>

          <div className="modal-foot">
            {editing && <button id="tx-modal-delete-btn" className="amb danger" style={{ marginRight: 'auto' }} onClick={() => onDelete(initial)}><Icon name="trash-2" size={14} />Delete</button>}
            <button id="tx-modal-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            <button id="tx-modal-save-btn" className="amb ok" onClick={submit} disabled={!valid} title={valid ? '' : 'Fill in all fields to continue'}><Icon name="save" size={14} />Save</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Delete confirm ──────────────────────────────────────────────────────
  function DeleteConfirm({ tx, count, onClose, onConfirm }) {
    const batch = typeof count === 'number';
    return (
      <div className="backdrop">
        <div className="modal confirm-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name="trash-2" size={16} />{batch ? 'Delete Selected' : 'Delete Transaction'}</span>
            </div>
            <button id="delete-confirm-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>
          <div className="confirm-body">
            <div className="confirm-ico"><Icon name="alert-triangle" size={20} /></div>
            <div className="confirm-text">
              {batch
                ? <>Delete <b>{count}</b> selected {count === 1 ? 'record' : 'records'}?</>
                : <>Delete <b>{tx.desc}</b> ({SYM[tx.cur]}{grp(tx.amt)})?</>}
              <span className="warn">⚠ This cannot be undone.</span>
            </div>
          </div>
          <div className="modal-foot">
            <button id="delete-confirm-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            <button id="delete-confirm-delete-btn" className="amb danger" onClick={onConfirm}><Icon name="trash-2" size={14} />Delete</button>
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, { FilterBar, SummaryStrip, Pagination, TxModal, DeleteConfirm, DateInput, CurrencyInput });
})();
