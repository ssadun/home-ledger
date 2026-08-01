// holdings-app.jsx - Standalone Holdings page under Assets.
(function () {
  const Icon = window.Icon;
  const { Sidebar } = window.HL_NAV;
  const { Pagination } = window;
  const { ExportData } = window;
  const { grp, SYM } = window.LEDGER_FMT;
  const { ASSET_TYPES, EXCHANGES } = window.INVESTMENTS_DATA;
  const ACCOUNT_TYPES = (window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.ACCOUNT_TYPES) || {};
  const HOLDING_COLS = [
    { key: 'name', label: 'Holding', size: 360, minSize: 220 },
    { key: 'type', label: 'Type', size: 150, minSize: 110 },
    { key: 'currency', label: 'Currency', size: 120, minSize: 90 },
    { key: 'quantity', label: 'Quantity', size: 160, minSize: 120, num: true },
    { key: 'avgCost', label: 'Avg Cost', size: 160, minSize: 120, num: true },
    { key: 'costBasis', label: 'Cost Basis', size: 170, minSize: 130, num: true },
    { key: 'tryValue', label: 'TRY Value', size: 170, minSize: 130, num: true },
  ];
  const EXPORT_COLS = [
    { key: 'name', label: 'Holding' },
    { key: 'accountName', label: 'Account' },
    { key: 'exchange', label: 'Exchange' },
    { key: 'assetType', label: 'Type', get: r => typeMeta(r.assetType).label },
    { key: 'cur', label: 'Currency' },
    { key: 'qty', label: 'Quantity' },
    { key: 'price', label: 'Avg Cost' },
    { key: 'costBasis', label: 'Cost Basis' },
    { key: 'tryValue', label: 'TRY Value' },
  ];

  const money = (v, cur = 'TRY', dec = 0) => (SYM[cur] || cur + ' ') + grp(v || 0, dec);
  const typeMeta = (k) => ASSET_TYPES[k] || ASSET_TYPES.stock;
  const exchangeMeta = (k) => EXCHANGES[k] || EXCHANGES.OTHER || { label: k || 'Other', icon: 'layers' };
  const typeClass = (k) => 'asset-type-' + (ASSET_TYPES[k] ? k : 'stock');
  const fmtQty = (q) => {
    const n = Number(q) || 0;
    return Number.isInteger(n) ? n.toLocaleString('en-US') : grp(n, 4);
  };

  function Empty({ icon, text }) {
    return <div className="detail-empty holdings-empty"><Icon name={icon} size={24} /><span>{text}</span></div>;
  }

  function FilterSelect({ id, label, icon, value, onChange, children }) {
    return (
      <div className="filter-field">
        <span className="filter-label">{icon && <Icon name={icon} size={11} />}{label}</span>
        <div className="select-wrap">
          <select id={id} className="sel" value={value} onChange={e => onChange(e.target.value)}>{children}</select>
        </div>
      </div>
    );
  }

  function HoldingsFilterBar({ search, setSearch, accountFilter, setAccountFilter, typeFilter, setTypeFilter, currencyFilter, setCurrencyFilter, accounts, extra }) {
    const [open, setOpen] = React.useState(false);
    const [draft, setDraft] = React.useState({ accountFilter, typeFilter, currencyFilter });
    const anchorRef = React.useRef(null);
    React.useEffect(() => {
      if (open) setDraft({ accountFilter, typeFilter, currencyFilter });
    }, [open, accountFilter, typeFilter, currencyFilter]);
    React.useEffect(() => {
      if (!open) return;
      const onDoc = (e) => { if (anchorRef.current && !anchorRef.current.contains(e.target)) setOpen(false); };
      const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
      return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const accountName = (id) => (accounts.find(a => a.id === id) || {}).name || id;
    const active = [
      accountFilter !== 'all' && { key: 'account', label: 'Account', val: accountName(accountFilter), clear: () => setAccountFilter('all') },
      typeFilter !== 'all' && { key: 'type', label: 'Type', val: typeMeta(typeFilter).label, clear: () => setTypeFilter('all') },
      currencyFilter !== 'all' && { key: 'currency', label: 'Currency', val: currencyFilter, clear: () => setCurrencyFilter('all') },
    ].filter(Boolean);
    const clearAll = () => { setAccountFilter('all'); setTypeFilter('all'); setCurrencyFilter('all'); };
    const clearDraft = () => setDraft({ accountFilter: 'all', typeFilter: 'all', currencyFilter: 'all' });
    const applyFilters = () => {
      setAccountFilter(draft.accountFilter);
      setTypeFilter(draft.typeFilter);
      setCurrencyFilter(draft.currencyFilter);
      setOpen(false);
    };

    return (
      <div className="filter-wrap">
        <div className="filter-bar holdings-filter-bar">
          <div className="filter-field ff-search">
            <span className="filter-label"><Icon name="search" size={11} />Search</span>
            <div className="search-wrap">
              <Icon name="search" size={13} />
              <input id="holdings-search-input" className="search-input" value={search} placeholder="Name, account, type..." onChange={e => setSearch(e.target.value)} />
              {search && <button id="holdings-search-clear-btn" className="search-clear" onClick={() => setSearch('')} title="Clear"><Icon name="x" size={12} /></button>}
            </div>
          </div>
          {extra}
          <div className="filter-field ff-filters">
            <span className="filter-label"><Icon name="sliders-horizontal" size={11} />Filters</span>
            <div className="filters-anchor" ref={anchorRef}>
              <button id="holdings-filter-toggle-btn" className={'filters-btn' + (active.length ? ' has' : '') + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
                <Icon name="sliders-horizontal" size={14} /><span className="filters-text">Filters</span>
                {active.length > 0 && <span className="filters-count">{active.length}</span>}
                <svg className="filters-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {open && (
                <div className="filters-pop holdings-filters-pop">
                  <div className="filters-pop-head">
                    <span>Filter By Column</span>
                    {active.length > 0 && <button id="holdings-filter-clear-all-btn" className="fp-clear" onClick={clearDraft}><Icon name="x" size={12} />Clear All</button>}
                  </div>
                  <FilterSelect id="holdings-account-filter" label="Account" icon="wallet" value={draft.accountFilter} onChange={v => setDraft(d => ({ ...d, accountFilter: v }))}>
                    <option value="all">All Accounts</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </FilterSelect>
                  <FilterSelect id="holdings-type-filter" label="Type" icon="layers" value={draft.typeFilter} onChange={v => setDraft(d => ({ ...d, typeFilter: v }))}>
                    <option value="all">All Types</option>
                    {Object.keys(ASSET_TYPES).map(k => <option key={k} value={k}>{ASSET_TYPES[k].label}</option>)}
                  </FilterSelect>
                  <FilterSelect id="holdings-currency-filter" label="Currency" icon="circle-dollar-sign" value={draft.currencyFilter} onChange={v => setDraft(d => ({ ...d, currencyFilter: v }))}>
                    <option value="all">All Currencies</option>
                    <option value="TRY">TRY</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </FilterSelect>
                  <button id="holdings-filter-apply-btn" className="fp-apply" onClick={applyFilters}>Apply</button>
                </div>
              )}
            </div>
          </div>
        </div>
        {active.length > 0 && (
          <div className="active-chips">
            <span className="chips-lead"><Icon name="filter" size={12} />Active</span>
            {active.map(a => (
              <button key={a.key} id={'holdings-filter-chip-' + a.key} className="chip" onClick={a.clear} title={'Clear ' + a.label + ' filter'}>
                <span className="chip-k">{a.label}:</span><span className="chip-v">{a.val}</span><Icon name="x" size={11} />
              </button>
            ))}
            <button id="holdings-filter-chips-clear-btn" className="chip chip-clear" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>
    );
  }

  function Toolbar({ search, setSearch, accountFilter, setAccountFilter, typeFilter, setTypeFilter, currencyFilter, setCurrencyFilter, accounts, moreControl }) {
    return (
      <React.Fragment>
        <header className="page-head">
          <div className="page-head-top">
            <div className="cfg-detail-head-left">
              <div className="page-title-wrap cfg-detail-title-wrap">
                <div className="cfg-title-col">
                  <h1 className="page-title">Holdings</h1>
                  <p className="page-subtitle">Holdings by investment account</p>
                </div>
              </div>
            </div>
          </div>
          <HoldingsFilterBar search={search} setSearch={setSearch}
            accountFilter={accountFilter} setAccountFilter={setAccountFilter}
            typeFilter={typeFilter} setTypeFilter={setTypeFilter}
            currencyFilter={currencyFilter} setCurrencyFilter={setCurrencyFilter}
            accounts={accounts}
            extra={moreControl} />
        </header>
      </React.Fragment>
    );
  }

  function HoldingMetric({ row, field }) {
    const unit = row.price != null ? (SYM[row.cur] || row.cur + ' ') + grp(row.price) : '-';
    const values = {
      currency: row.cur,
      quantity: fmtQty(row.qty),
      avgCost: unit,
      costBasis: money(row.costBasis, row.cur, 2),
    };
    const labels = {
      currency: 'Currency',
      quantity: 'Quantity',
      avgCost: 'Avg Cost',
      costBasis: 'Cost Basis',
    };
    if (!labels[field]) return null;
    return (
      <span className={'hold-card-field hold-card-field-' + field}>
        <span className="hold-card-field-label">{labels[field]}:</span>
        <span className="hold-card-field-value">{values[field]}</span>
      </span>
    );
  }

  function HoldingCard({ row, fields }) {
    const m = typeMeta(row.assetType);
    const visible = new Set(fields);
    const detailFields = fields.filter(k => ['quantity', 'avgCost', 'costBasis'].includes(k));
    return (
      <div id={'holding-card-' + row.id} className={'acct-card holdings-card ' + typeClass(row.assetType)}>
        <div className="acct-card-row holdings-card-row">
          {visible.has('name') && (
            <React.Fragment>
              <span className={'cat-chip hold-asset-chip ' + typeClass(row.assetType)}><Icon name={m.icon} size={14} /></span>
              <span className="acct-card-meta holdings-card-meta">
                <span className="acct-card-name">{row.name}</span>
                {detailFields.length > 0 && (
                  <span className="hold-card-fields">
                    {detailFields.map((field, idx) => (
                      <React.Fragment key={field}>
                        {idx > 0 && <span className="hold-card-field-sep">·</span>}
                        <HoldingMetric row={row} field={field} />
                      </React.Fragment>
                    ))}
                  </span>
                )}
              </span>
            </React.Fragment>
          )}
          <span className="acct-card-end holdings-card-end">
            {visible.has('tryValue') && <span className="hold-card-value income">₺{grp(row.tryValue || 0, 0)}</span>}
          </span>
        </div>
      </div>
    );
  }

  function HoldingGroupHeader({ group, collapsed, onToggle }) {
    const meta = ACCOUNT_TYPES[group.accountType] || ACCOUNT_TYPES.invest || { icon: 'wallet', label: 'Investment' };
    return (
      <button type="button" id={'holdings-group-head-' + group.accountId}
        className={'acct-group-head holdings-group-head' + (collapsed ? ' is-collapsed' : '')}
        aria-expanded={!collapsed} onClick={onToggle}
        title={collapsed ? 'Expand group' : 'Collapse group'}>
        <Icon name="chevron-down" size={13} className="acct-group-chevron" />
        <span className="acct-group-icon">
          <Icon name={meta.icon || 'wallet'} size={15} />
        </span>
        <span className="acct-group-label">{group.accountName}</span>
        <span className="acct-group-count">{group.count || group.rows.length}</span>
        <span className="acct-group-total">₺{grp(group.totalTry, 0)}</span>
      </button>
    );
  }

  function HoldingGroup({ group, collapsed, onToggle, fields }) {
    const exchangeGroups = React.useMemo(() => {
      const order = ['BIST', 'TEFAS', 'NASDAQ', 'EUR', 'OTHER'];
      const map = new Map();
      group.rows.forEach(row => {
        const key = row.exchange || 'OTHER';
        if (!map.has(key)) map.set(key, { key, rows: [], totalTry: 0 });
        const g = map.get(key);
        g.rows.push(row);
        g.totalTry += row.tryValue || 0;
      });
      return Array.from(map.values()).sort((a, b) => {
        const ai = order.indexOf(a.key), bi = order.indexOf(b.key);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
    }, [group.rows]);
    return (
      <div className={'acct-group holdings-group' + (collapsed ? ' is-collapsed' : '')}>
        <HoldingGroupHeader group={group} collapsed={collapsed} onToggle={onToggle} />
        {!collapsed && (
          <div className="card-grid acct-grid card-grid--list acct-list holdings-card-grid">
            {exchangeGroups.map(exchangeGroup => {
              const xm = exchangeMeta(exchangeGroup.key);
              return (
                <React.Fragment key={exchangeGroup.key}>
                  <div className="holdings-exchange-head">
                    <span><Icon name={xm.icon} size={12} />{xm.label}</span>
                    <span>{exchangeGroup.rows.length} · ₺{grp(exchangeGroup.totalTry, 0)}</span>
                  </div>
                  {exchangeGroup.rows.map(row => <HoldingCard key={row.accountId + '-' + row.id} row={row} fields={fields} />)}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function App() {
    const [accounts, setAccounts] = React.useState([]);
    const [rows, setRows] = React.useState(null);
    const [search, setSearch] = React.useState('');
    const [accountFilter, setAccountFilter] = React.useState('all');
    const [typeFilter, setTypeFilter] = React.useState('all');
    const [currencyFilter, setCurrencyFilter] = React.useState('all');
    const [sort, setSort] = React.useState({ col: 'tryValue', dir: 'desc' });
    const [curPage, setCurPage] = React.useState(1);
    const [perPage, setPerPage] = React.useState(20);
    const [collapsedGroups, setCollapsedGroups] = React.useState(new Set());
    const [error, setError] = React.useState('');

    const reload = React.useCallback(async () => {
      setError('');
      setRows(null);
      try {
        const allAccounts = await window.HL_ACCOUNTS_API.list();
        const investAccounts = allAccounts.filter(a => a.type === 'invest' || a.type === 'pension');
        const groups = await Promise.all(investAccounts.map(async (account) => {
          const holdings = await window.HL_INVESTMENTS_API.listForAccount(account);
          return holdings.map(h => ({ ...h, accountId: account.id, accountName: account.name, accountType: account.type }));
        }));
        setAccounts(investAccounts);
        setRows(groups.flat().sort((a, b) => (b.tryValue || 0) - (a.tryValue || 0)));
      } catch (e) {
        setError(e.message || 'Could not load holdings.');
        setRows([]);
      }
    }, []);
    React.useEffect(() => { reload(); }, [reload]);

    const filtered = (rows || []).filter(r => {
      if (accountFilter !== 'all' && r.accountId !== accountFilter) return false;
      if (typeFilter !== 'all' && r.assetType !== typeFilter) return false;
      if (currencyFilter !== 'all' && r.cur !== currencyFilter) return false;
      const q = search.trim().toLowerCase();
      return !q || [r.name, r.accountName, r.exchange, exchangeMeta(r.exchange).label, r.assetType, typeMeta(r.assetType).label, r.cur].join(' ').toLowerCase().includes(q);
    });
    const val = (r, col) => {
      if (col === 'type') return typeMeta(r.assetType).label;
      if (col === 'currency') return r.cur;
      if (col === 'quantity') return r.qty || 0;
      if (col === 'avgCost') return r.price == null ? -1 : r.price;
      if (col === 'costBasis') return r.costBasis || 0;
      if (col === 'tryValue') return r.tryValue || 0;
      if (col === 'account') return r.accountName || '';
      return r.name || '';
    };
    const rowCompare = (a, b) => {
      const av = val(a, sort.col), bv = val(b, sort.col);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
      return sort.dir === 'asc' ? cmp : -cmp;
    };
    const groupedRows = React.useMemo(() => {
      const order = new Map(accounts.map((a, i) => [a.id, i]));
      const map = new Map();
      filtered.forEach(row => {
        if (!map.has(row.accountId)) {
          map.set(row.accountId, {
            accountId: row.accountId,
            accountName: row.accountName,
            accountType: row.accountType,
            rows: [],
            totalTry: 0,
          });
        }
        const group = map.get(row.accountId);
        group.rows.push(row);
        group.totalTry += row.tryValue || 0;
      });
      return Array.from(map.values())
        .sort((a, b) => (order.get(a.accountId) ?? 9999) - (order.get(b.accountId) ?? 9999)
          || a.accountName.localeCompare(b.accountName, undefined, { sensitivity: 'base' }))
        .map(group => ({ ...group, rows: group.rows.slice().sort(rowCompare) }));
    }, [filtered, accounts, sort]);
    const sorted = groupedRows.flatMap(group => group.rows);
    React.useEffect(() => { setCurPage(1); }, [search, accountFilter, typeFilter, currencyFilter, perPage]);
    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(curPage, pages);
    const start = (page - 1) * perPage;
    const end = Math.min(start + perPage, total);
    const pageRows = sorted.slice(start, end);
    const totalTry = sorted.reduce((s, r) => s + (r.tryValue || 0), 0);
    const rz = window.useResizableColumns({ columns: HOLDING_COLS, storageKey: 'hl-holdings-colwidths' });
    const orderKeys = React.useMemo(() => rz.orderedColumns.map(c => c.key), [rz.orderedColumns]);
    const pageGroups = React.useMemo(() => {
      const byAccount = new Map(groupedRows.map(group => [group.accountId, group]));
      const map = new Map();
      pageRows.forEach(row => {
        if (!map.has(row.accountId)) {
          const full = byAccount.get(row.accountId);
          map.set(row.accountId, {
            accountId: row.accountId,
            accountName: row.accountName,
            accountType: row.accountType,
            rows: [],
            totalTry: full ? full.totalTry : 0,
            count: full ? full.rows.length : 0,
          });
        }
        const group = map.get(row.accountId);
        group.rows.push(row);
      });
      return Array.from(map.values());
    }, [pageRows, groupedRows]);
    const toggleGroup = React.useCallback((accountId) => {
      setCollapsedGroups(prev => {
        const next = new Set(prev);
        if (next.has(accountId)) next.delete(accountId);
        else next.add(accountId);
        return next;
      });
    }, []);
    const moreControl = (
      <ExportData entity="holdings" entityLabel="Holdings" columns={EXPORT_COLS} rows={sorted} allRows={rows || []} inline
        tableTools={<React.Fragment>
          <window.ColumnVisibilityButton columns={rz.allColumns} hiddenColumns={rz.hiddenColumns} onChange={rz.setColumnVisible} />
          <window.ResetOrderButton onClick={rz.resetOrder} disabled={rz.isDefaultOrder} />
        </React.Fragment>} />
    );

    return (
      <div className="app">
        <Sidebar active="holdings" />
        <div className="main">
          <Toolbar search={search} setSearch={setSearch} accountFilter={accountFilter} setAccountFilter={setAccountFilter}
            typeFilter={typeFilter} setTypeFilter={setTypeFilter} currencyFilter={currencyFilter} setCurrencyFilter={setCurrencyFilter}
            accounts={accounts}
            moreControl={moreControl} />
          {error && <div className="acct-form-error holdings-load-error"><Icon name="alert-triangle" size={14} />{error}</div>}
          <div className="acct-body holdings-body">
            {rows === null ? (
              <Empty icon="loader" text="Loading holdings..." />
            ) : filtered.length ? (
              <React.Fragment>
              {pageGroups.map(group => (
                <HoldingGroup key={group.accountId} group={group}
                  collapsed={collapsedGroups.has(group.accountId)}
                  onToggle={() => toggleGroup(group.accountId)}
                  fields={orderKeys} />
              ))}
              <Pagination page={page} pages={pages} total={total} start={start} end={end}
                perPage={perPage} setPage={setCurPage} setPerPage={setPerPage}
                totalNode={<React.Fragment><span className="ttb-label">Total TRY</span><span className="ttb-value income">₺{grp(totalTry, 0)}</span></React.Fragment>} />
              </React.Fragment>
            ) : (
              <Empty icon="chart-no-axes-combined" text="No holdings found." />
            )}
          </div>
        </div>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
