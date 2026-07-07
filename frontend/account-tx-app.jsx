// account-tx-app.jsx — Home Ledger Account Activity page.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { FX, CURRENT_MONTH, CURRENT_YEAR } = window.LEDGER;
  const { ACCOUNTS } = window.ACCOUNTS_DATA;
  const { ACCT_TX, ACCT_TX_TYPES } = window.ACCT_TX_DATA;
  const { Pagination, DeleteConfirm } = window;
  const ExportData = window.ExportData;
  const { grp, SYM, MONTHS, fmtDate, dowOf } = window.LEDGER_FMT;
  const { useTweaks, TweaksPanel, TweakSection, TweakColor, TweakToggle, TweakRadio } = window;
  const { useResizableColumns, ColResizer } = window;

  const TWEAK_DEFAULTS = { accent: '#4f8ef7', zebra: true, density: 'compact', colorAmounts: true, groupByWeek: true };

  function weekOfMonth(iso) { return Math.ceil(+iso.split('-')[2] / 7); }
  function weekRangeLabel(wk, month, year) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const from = (wk - 1) * 7 + 1;
    const to = Math.min(wk * 7, daysInMonth);
    return MONTHS[month] + ' ' + from + '\u2013' + to;
  }

  const { Sidebar } = window.HL_NAV;

  // ── Type cell (plain: muted text + colorful icon) ────────────────────────
  function TxTypeBadge({ txType }) {
    const t = ACCT_TX_TYPES[txType] || { label: txType, icon: 'circle', color: 'var(--muted)' };
    return (
      <span className="atx-plain">
        <Icon name={t.icon} size={13} style={{ color: t.color }} />{t.label}
      </span>
    );
  }

  // ── Direction cell (plain) ───────────────────────────────────────────────
  function DirectionBadge({ direction }) {
    const isIn = direction === 'incoming';
    const col = isIn ? 'var(--green)' : 'var(--coral)';
    return (
      <span className="atx-plain">
        <Icon name={isIn ? 'arrow-down-left' : 'arrow-up-right'} size={13} style={{ color: col }} />{isIn ? 'In' : 'Out'}
      </span>
    );
  }

  // ── Account cell (plain) ─────────────────────────────────────────────────
  function AccountBadge({ accountId }) {
    const acc = ACCOUNTS.find(a => a.id === accountId);
    if (!acc) return <span className="for-na">–</span>;
    const typeColors = { bank: 'var(--accent)', credit: 'var(--orange)', debit: 'var(--sky)', wallet: 'var(--lavender)', cash: 'var(--green)', invest: 'var(--emerald)', overdraft: 'var(--coral)' };
    const typeIcons = { bank: 'landmark', credit: 'credit-card', debit: 'wallet-cards', wallet: 'smartphone', cash: 'banknote', invest: 'trending-up', overdraft: 'alert-circle' };
    const c = typeColors[acc.type] || 'var(--muted)';
    return (
      <span className="atx-plain">
        <Icon name={typeIcons[acc.type] || 'circle'} size={13} style={{ color: c }} />
        <span className="atx-acct-name">{acc.name}</span>
      </span>
    );
  }

  // ── Summary strip ───────────────────────────────────────────────────────
  function AcctTxSummary({ rows }) {
    let inflow = 0, outflow = 0;
    rows.forEach(t => { if (t.direction === 'incoming') inflow += t.tryV; else outflow += t.tryV; });
    const net = inflow - outflow;
    const cards = [
      { label: 'Inflow', icon: 'arrow-down-left', cls: 'income', val: '₺' + grp(inflow), sub: 'Received' },
      { label: 'Outflow', icon: 'arrow-up-right', cls: 'expense', val: '₺' + grp(outflow), sub: 'Sent' },
      { label: 'Net', icon: 'scale', cls: 'net', val: (net < 0 ? '−₺' : '₺') + grp(Math.abs(net)), sub: net < 0 ? 'Deficit' : 'Surplus' },
      { label: 'Records', icon: 'file-text', cls: 'count', val: String(rows.length), sub: 'In view' },
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

  // ── Filter bar ──────────────────────────────────────────────────────────
  function AcctFilterBar({ month, year, onMonthStep, account, setAccount, txType, setTxType, direction, setDirection, search, setSearch, onResetCols, onResetOrder, orderIsDefault, extra }) {
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
    const active = [
      account !== 'all' && { key: 'account', label: 'Account', val: (ACCOUNTS.find(a => a.id === account) || {}).name || account, clear: () => setAccount('all') },
      txType !== 'all' && { key: 'txType', label: 'Type', val: (ACCT_TX_TYPES[txType] || {}).label || txType, clear: () => setTxType('all') },
      direction !== 'all' && { key: 'direction', label: 'Direction', val: cap(direction), clear: () => setDirection('all') },
    ].filter(Boolean);
    const clearAll = () => { setAccount('all'); setTxType('all'); setDirection('all'); };

    function Sel({ label, icon, value, onChange, children, id }) {
      return (
        <div className="filter-field">
          <span className="filter-label">{icon && <Icon name={icon} size={11} />}{label}</span>
          <div className="select-wrap">
            <StyledSelect id={id} className="sel" value={value} onChange={e => onChange(e.target.value)}>{children}</StyledSelect>
          </div>
        </div>
      );
    }

    return (
      <div className="filter-wrap">
        <div className="filter-bar">
          <div className="filter-field ff-period">
            <span className="filter-label"><Icon name="calendar" size={11} />Period</span>
            <div className="month-step">
              <button id="atx-period-prev-btn" className="ms-btn" onClick={() => onMonthStep(-1)} title="Previous month"><Icon name="chevron-left" size={14} /></button>
              <span className="ms-label"><Icon name="calendar-days" size={13} />{MONTHS[month]} {year}</span>
              <button id="atx-period-next-btn" className="ms-btn" onClick={() => onMonthStep(1)} title="Next month"><Icon name="chevron-right" size={14} /></button>
            </div>
          </div>
          <div className="filter-field ff-search">
            <span className="filter-label"><Icon name="search" size={11} />Search</span>
            <div className="search-wrap">
              <Icon name="search" size={13} />
              <input id="atx-filter-search-input" className="search-input" placeholder="Description…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          {extra}
          <div className="filter-field ff-filters">
            <span className="filter-label"><Icon name="sliders-horizontal" size={11} />Filters</span>
            <div className="filters-anchor" ref={anchorRef}>
              <button id="atx-filter-toggle-btn" className={'filters-btn' + (active.length ? ' has' : '') + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
                <Icon name="sliders-horizontal" size={14} /><span className="filters-text">Filters</span>
                {active.length > 0 && <span className="filters-count">{active.length}</span>}
                <svg className="filters-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {open && (
                <div className="filters-pop">
                  <div className="filters-pop-head">
                    <span>Filter By Column</span>
                    {active.length > 0 && <button id="atx-filter-clear-all-btn" className="fp-clear" onClick={clearAll}><Icon name="x" size={12} />Clear All</button>}
                  </div>
                  <Sel id="atx-filter-account-select" label="Account" icon="landmark" value={account} onChange={setAccount}>
                    <option value="all">All Accounts</option>
                    {ACCOUNTS.map(a => <option key={a.id} value={a.id}>{a.name} ({a.institution})</option>)}
                  </Sel>
                  <Sel id="atx-filter-type-select" label="Type" icon="tag" value={txType} onChange={setTxType}>
                    <option value="all">All Types</option>
                    {Object.keys(ACCT_TX_TYPES).map(k => <option key={k} value={k}>{ACCT_TX_TYPES[k].label}</option>)}
                  </Sel>
                  <Sel id="atx-filter-direction-select" label="Direction" icon="arrow-left-right" value={direction} onChange={setDirection}>
                    <option value="all">All Directions</option>
                    <option value="incoming">Incoming</option>
                    <option value="outgoing">Outgoing</option>
                  </Sel>
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
              <button key={a.key} id={'atx-filter-chip-' + a.key} className="chip" onClick={a.clear} title={'Clear ' + a.label + ' filter'}>
                <span className="chip-k">{a.label}:</span><span className="chip-v">{a.val}</span><Icon name="x" size={11} />
              </button>
            ))}
            <button id="atx-filter-chips-clear-btn" className="chip chip-clear" onClick={clearAll}>Clear All</button>
          </div>
        )}
      </div>
    );
  }

  // ── Table row ───────────────────────────────────────────────────────────
  // Cells keyed by column key so they can be rendered in any column order.
  const ATX_DEFAULT_ORDER = ['date', 'accountId', 'txType', 'direction', 'desc', 'amt'];
  const ATX_CELLS = {
    date: (tx) => <td key="date" data-label="Date"><span className="td-date">{fmtDate(tx.date)}<span className="dow">{dowOf(tx.date)}</span></span></td>,
    accountId: (tx) => <td key="accountId" data-label="Account"><AccountBadge accountId={tx.accountId} /></td>,
    txType: (tx) => <td key="txType" data-label="Type"><TxTypeBadge txType={tx.txType} /></td>,
    direction: (tx) => <td key="direction" data-label="Direction"><DirectionBadge direction={tx.direction} /></td>,
    desc: (tx) => <td key="desc" data-label="Description"><span className="td-desc" title={tx.desc}>{tx.desc}</span></td>,
    amt: (tx) => {
      const isIn = tx.direction === 'incoming';
      return (
        <td key="amt" className="num" data-label="Amount">
          <span className="amount-cell">
            <span className={'amount-val ' + (isIn ? 'income' : 'expense')}>
              <span className="sign">{isIn ? '+' : '−'}</span>{grp(tx.amt)}<span className="cur-sym suffix">{SYM[tx.cur]}</span>
            </span>
          </span>
        </td>
      );
    },
  };
  function AtxRow({ tx, extraClass, order, selectable, selected, onToggleSelect }) {
    const keys = order && order.length ? order : ATX_DEFAULT_ORDER;
    return (
      <tr className={'tx-row' + (selected ? ' row-selected' : '') + (extraClass ? ' ' + extraClass : '')}>
        {selectable && (
          <td className="td-select" data-label="" onClick={(e) => { e.stopPropagation(); onToggleSelect(tx.id); }}>
            <input id={'row-select-' + tx.id} type="checkbox" className="row-select-box" checked={!!selected}
              onChange={() => {}} aria-label="Select row" />
          </td>
        )}
        {keys.map(k => ATX_CELLS[k] && ATX_CELLS[k](tx))}
        {/* Mobile meta row */}
        <td className="td-meta-mobile" data-label="Meta">
          <span className="meta-date">{fmtDate(tx.date)} {dowOf(tx.date)}</span>
          <span className="meta-sep">·</span>
          <AccountBadge accountId={tx.accountId} />
          <span className="meta-sep">·</span>
          <TxTypeBadge txType={tx.txType} />
        </td>
      </tr>
    );
  }

  // ── Columns ─────────────────────────────────────────────────────────────
  // size = default width; minSize / maxSize = drag constraints (px), enforced by TanStack
  const COLS = [
    { key: 'date', label: 'Date', size: 130, minSize: 96, maxSize: 240 },
    { key: 'accountId', label: 'Account', size: 190, minSize: 120, maxSize: 360 },
    { key: 'txType', label: 'Type', size: 160, minSize: 110, maxSize: 300 },
    { key: 'direction', label: 'Direction', size: 130, minSize: 96, maxSize: 240 },
    { key: 'desc', label: 'Description', size: 320, minSize: 160, maxSize: 640 },
    { key: 'amt', label: 'Amount', num: true, size: 150, minSize: 110, maxSize: 280 },
  ];

  // ── CSV export schema ──
  const EXPORT_COLS = [
    { key: 'date', label: 'Date' },
    { key: 'accountId', label: 'Account', get: tx => (ACCOUNTS.find(a => a.id === tx.accountId) || {}).name || tx.accountId },
    { key: 'txType', label: 'Type', get: tx => (ACCT_TX_TYPES[tx.txType] || {}).label || tx.txType },
    { key: 'direction', label: 'Direction', get: tx => tx.direction === 'incoming' ? 'In' : 'Out' },
    { key: 'desc', label: 'Description' },
    { key: 'cur', label: 'Currency' },
    { key: 'amt', label: 'Amount' },
    { key: 'tryV', label: 'Amount (TRY)' },
  ];

  // ══════════════════════════════════════════════════════════════════════════
  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    // Rows are the real imported bank-account movements (transactions tagged
    // note=="banka_import"), fetched per selected month from the backend.
    const [rows, setRows] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [loadErr, setLoadErr] = React.useState(null);
    const [accountsReady, setAccountsReady] = React.useState(false);
    const [month, setMonth] = React.useState(CURRENT_MONTH);
    const [year, setYear] = React.useState(CURRENT_YEAR);
    const [account, setAccount] = React.useState('all');
    const [txType, setTxType] = React.useState('all');
    const [direction, setDirection] = React.useState('all');
    const [search, setSearch] = React.useState('');
    const [sort, setSort] = React.useState({ col: 'date', dir: 'desc' });
    const [page, setPage] = React.useState(1);
    const [perPage, setPerPage] = React.useState(() => { const v = +localStorage.getItem('hl-rows-per-page'); return [10, 20, 30, 40, 50, 100].includes(v) ? v : 10; });
    React.useEffect(() => { try { localStorage.setItem('hl-rows-per-page', String(perPage)); } catch (e) {} }, [perPage]);
    // Mass-delete: ids of checkbox-selected rows + the batch-confirm dialog toggle.
    const [selected, setSelected] = React.useState(() => new Set());
    const [batchDel, setBatchDel] = React.useState(false);
    const toggleSelect = React.useCallback((id) => setSelected(s => {
      const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
    }), []);

    React.useEffect(() => { document.documentElement.style.setProperty('--accent', t.accent); }, [t.accent]);

    // Hydrate the household accounts once (starts empty in accounts-data.js).
    // Mutate the shared array in place so AccountBadge / AcctFilterBar — which
    // closed over the module-level ACCOUNTS reference — see the new entries.
    React.useEffect(() => {
      let alive = true;
      (async () => {
        try {
          const list = await window.HL_ACCOUNTS_API.list();
          if (!alive) return;
          ACCOUNTS.length = 0;
          list.forEach(a => ACCOUNTS.push(a));
        } catch (e) {
          if (alive) setLoadErr(e.message || 'Failed to load accounts');
        } finally {
          if (alive) setAccountsReady(true);
        }
      })();
      return () => { alive = false; };
    }, []);

    // Fetch imported bank-account activity for the selected month. Re-runs when
    // the period changes; waits until accounts are hydrated so payment_method
    // resolves to a named account.
    const reload = React.useCallback(() => {
      if (!accountsReady) return Promise.resolve();
      setLoading(true);
      return window.HL_ACCT_TX_API
        .listActivity({ year, month: month + 1, accounts: ACCOUNTS })
        .then(list => { setRows(list); setLoadErr(null); })
        .catch(e => { setRows([]); setLoadErr(e.message || 'Failed to load account activity'); })
        .finally(() => setLoading(false));
    }, [accountsReady, year, month]);

    React.useEffect(() => { reload(); }, [reload]);

    function monthStep(d) {
      let m = month + d, y = year;
      if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
      setMonth(m); setYear(y); setPage(1);
    }

    const filtered = React.useMemo(() => {
      const mm = String(month + 1).padStart(2, '0');
      const prefix = `${year}-${mm}`;
      return rows.filter(r => {
        if (!r.date.startsWith(prefix)) return false;
        if (account !== 'all' && r.accountId !== account) return false;
        if (txType !== 'all' && r.txType !== txType) return false;
        if (direction !== 'all' && r.direction !== direction) return false;
        if (search.trim() && !r.desc.toLowerCase().includes(search.trim().toLowerCase())) return false;
        return true;
      });
    }, [rows, month, year, account, txType, direction, search]);

    const sorted = React.useMemo(() => {
      const arr = [...filtered];
      const { col, dir } = sort;
      arr.sort((a, b) => {
        let av = a[col], bv = b[col];
        if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;
        return 0;
      });
      return arr;
    }, [filtered, sort]);

    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const curPage = Math.min(page, pages);
    const start = (curPage - 1) * perPage;
    const end = Math.min(start + perPage, total);
    const pageRows = sorted.slice(start, end);

    React.useEffect(() => { setPage(1); setSelected(new Set()); }, [month, year, account, txType, direction, search, perPage]);

    function toggleSort(col) {
      if (rz.isResizing || rz.wasResizingRef.current) return;   // don't sort during/after a column drag
      setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' });
    }

    // ── column resizing (TanStack Table) — widths persist in localStorage ──
    const rz = useResizableColumns({ columns: COLS, storageKey: 'hl-acct-tx-colwidths' });
    // Stable list of keys in the user's column order — drives <colgroup>, <thead>, and row cells.
    const orderKeys = React.useMemo(() => rz.orderedColumns.map(c => c.key), [rz.orderedColumns]);

    // Mass delete — removes the selected transactions from the backend, then
    // reloads the current month so the view reflects what persisted.
    async function confirmBatchDelete() {
      const targets = rows.filter(r => selected.has(r.id) && r._dbId != null);
      try {
        await Promise.all(targets.map(r => window.HL_ACCT_TX_API.remove(r._dbId)));
        setSelected(new Set());
        setBatchDel(false);
        await reload();
      } catch (e) {
        setLoadErr(e.message || 'Failed to delete selected records');
      }
    }

    // Select-all reflects only the rows on the current page.
    const pageIds = pageRows.map(r => r.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
    const someSelected = !allSelected && pageIds.some(id => selected.has(id));
    const toggleSelectAll = () => setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else pageIds.forEach(id => n.add(id));
      return n;
    });

    return (
      <div className="app">
        <Sidebar active="account-activity" />
        <div className="main">
          <header className="page-head">
            <div className="page-head-top">
              <div className="cfg-detail-head-left">
                <div className="page-title-wrap cfg-detail-title-wrap">
                  <span className="cfg-title-icon" id="page-header-icon" style={{ color: '#4f8ef7' }}><Icon name="landmark" size={21} /></span>
                  <div className="cfg-title-col">
                    <h1 className="page-title">Account Activity</h1>
                    <p className="page-subtitle">Money in and out, per account</p>
                  </div>
                </div>
              </div>
            </div>
            <AcctFilterBar
              month={month} year={year} onMonthStep={monthStep}
              account={account} setAccount={setAccount}
              txType={txType} setTxType={setTxType}
              direction={direction} setDirection={setDirection}
              search={search} setSearch={setSearch}
              onResetCols={rz.resetSizes}
              onResetOrder={rz.resetOrder} orderIsDefault={rz.isDefaultOrder}
              extra={<ExportData entity="account-activity" entityLabel="Records"
                period={year + '-' + String(month + 1).padStart(2, '0')}
                columns={EXPORT_COLS} rows={sorted} allRows={rows} inline />} />
          </header>


          <div className="table-card">
            {selected.size > 0 && (
              <div className="bulk-bar" id="atx-bulk-bar">
                <span className="bulk-count"><Icon name="check-square" size={14} />{selected.size} selected</span>
                <div className="bulk-actions">
                  <button id="atx-bulk-clear-btn" className="list-btn blue" onClick={() => setSelected(new Set())}><Icon name="x" size={12} />Clear</button>
                  <button id="atx-bulk-delete-btn" className="list-btn red" onClick={() => setBatchDel(true)}><Icon name="trash-2" size={12} />Delete Selected</button>
                </div>
              </div>
            )}
            <div className="table-scroll">
              <table ref={rz.tableRef} className={'ledger-table resizable selectable' + (t.zebra ? ' zebra' : '') + (t.colorAmounts ? '' : ' mono-amt') + ' dens-' + t.density + (t.groupByWeek && sort.col === 'date' ? ' week-cards' : '')}
                  style={rz.colSizeVars}>
                <colgroup>
                  <col className="col-select" />
                  {rz.orderedColumns.map(c => <col key={c.key} style={{ width: 'var(--rz-' + c.key + ')' }} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th className="th-select" title="Select all on this page">
                      <input id="atx-select-all" type="checkbox" className="row-select-box" checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleSelectAll} aria-label="Select all rows on this page" />
                    </th>
                    {rz.orderedColumns.map(c => (
                      <th key={c.key} className={(c.num ? 'num ' : '') + (sort.col === c.key ? 'sorted' : '')}
                        title="Drag To Reorder · Click To Sort"
                        {...rz.getReorderProps(c.key)}
                        onClick={() => toggleSort(c.key)}>
                        <span className="th-inner">
                          <span className="th-label">{c.label}</span>
                          <span className="sort-arrow">{sort.col === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                        </span>
                        <ColResizer header={rz.headersById[c.key]} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr className="empty-row"><td colSpan={COLS.length + 1}>
                      <div className="empty-state">
                        <Icon name="loader" size={32} className="spin" />
                        <span className="et">Loading account activity…</span>
                      </div>
                    </td></tr>
                  ) : loadErr ? (
                    <tr className="empty-row"><td colSpan={COLS.length + 1}>
                      <div className="empty-state">
                        <Icon name="alert-triangle" size={32} style={{ color: 'var(--red)' }} />
                        <span className="et">Couldn't load account activity</span>
                        <span className="es">{loadErr}</span>
                      </div>
                    </td></tr>
                  ) : pageRows.length === 0 ? (
                    <tr className="empty-row"><td colSpan={COLS.length + 1}>
                      <div className="empty-state">
                        <Icon name="landmark" size={32} />
                        <span className="et">No account activity matches</span>
                        <span className="es">Import a bank statement, or try a different month or clear the filters above.</span>
                      </div>
                    </td></tr>
                  ) : !t.groupByWeek || sort.col !== 'date' ? (
                    pageRows.map(tx => <AtxRow key={tx.id} tx={tx} order={orderKeys}
                      selectable selected={selected.has(tx.id)} onToggleSelect={toggleSelect} />)
                  ) : (() => {
                    const groups = [];
                    let cur = null;
                    pageRows.forEach((tx) => {
                      const wk = weekOfMonth(tx.date);
                      if (!cur || cur.wk !== wk) { cur = { wk, rows: [] }; groups.push(cur); }
                      cur.rows.push(tx);
                    });
                    const out = [];
                    groups.forEach((g, gi) => {
                      if (gi > 0) out.push(<tr className="week-spacer" key={'wkspc-' + g.wk}><td colSpan={99}></td></tr>);
                      out.push(
                        <tr className="week-group-row" key={'wk-' + g.wk}>
                          <td colSpan={99}>
                            <span className="week-group-label"><Icon name="calendar-range" size={12} />Week {g.wk}</span>
                            <span className="week-group-range">{weekRangeLabel(g.wk, month, year)}</span>
                          </td>
                        </tr>
                      );
                      g.rows.forEach((tx, ri) => {
                        const isLast = ri === g.rows.length - 1;
                        out.push(
                          <AtxRow key={tx.id} tx={tx} order={orderKeys}
                            selectable selected={selected.has(tx.id)} onToggleSelect={toggleSelect}
                            extraClass={(ri % 2 === 1 ? 'row-alt' : '') + (isLast ? ' week-last' : '')} />
                        );
                      });
                    });
                    return out;
                  })()}
                </tbody>
              </table>
            </div>
            <Pagination page={curPage} pages={pages} total={total} start={start} end={end}
              perPage={perPage} setPage={setPage} setPerPage={setPerPage} />
          </div>
        </div>

        {batchDel && <DeleteConfirm count={selected.size} onClose={() => setBatchDel(false)} onConfirm={confirmBatchDelete} />}

        <TweaksPanel title="Tweaks">
          <TweakSection label="Appearance" />
          <TweakColor label="Accent" value={t.accent}
            options={['#4f8ef7', '#8b5cf6', '#22c55e', '#f97316', '#ec4899']}
            onChange={v => setTweak('accent', v)} />
          <TweakRadio label="Density" value={t.density}
            options={['compact', 'regular', 'comfy']}
            onChange={v => setTweak('density', v)} />
          <TweakSection label="Table" />
          <TweakToggle label="Zebra Striping" value={t.zebra}
            onChange={v => setTweak('zebra', v)} />
          <TweakToggle label="Color Amounts" value={t.colorAmounts}
            onChange={v => setTweak('colorAmounts', v)} />
          <TweakToggle label="Group By Week" value={t.groupByWeek}
            onChange={v => setTweak('groupByWeek', v)} />
        </TweaksPanel>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
