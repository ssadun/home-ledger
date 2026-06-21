// accounts-app.jsx — Home Ledger Accounts page.
(function () {
  const Icon = window.Icon;
  const { ACCOUNT_TYPES, ACCOUNTS: INITIAL_ACCOUNTS, FX } = window.ACCOUNTS_DATA;
  const { AccountCard, AccountGroupHeader, AccountDetail, AccountsSummary,
          AccountFormModal, DeleteAccountConfirm } = window;
  const ImportWizard = window.ImportWizard;
  const ExportData = window.ExportData;
  const { TweaksPanel, TweakSection, TweakColor } = window;

  const { Sidebar } = window.HL_NAV;

  // ── CSV export schema ──
  const EXPORT_COLS = [
    { key: 'name', label: 'Account Name' },
    { key: 'owner', label: 'Owner' },
    { key: 'type', label: 'Type', get: a => (ACCOUNT_TYPES[a.type] || {}).label || a.type },
    { key: 'institution', label: 'Institution' },
    { key: 'number', label: 'Account Number' },
    { key: 'cur', label: 'Currency' },
    { key: 'balance', label: 'Balance' },
    { key: 'limit', label: 'Credit/Overdraft Limit', get: a => a.limit != null ? a.limit : '' },
    { key: 'iban', label: 'IBAN', get: a => a.iban || '' },
  ];

  // ── Filter bar ──
  function AccountsFilter({ owner, setOwner, typeFilter, setTypeFilter, search, setSearch, layout, setLayout, extra, popActions }) {
    const [filtersOpen, setFiltersOpen] = React.useState(false);
    const filtersRef = React.useRef(null);

    React.useEffect(() => {
      if (!filtersOpen) return;
      const onDoc = (e) => { if (filtersRef.current && !filtersRef.current.contains(e.target)) setFiltersOpen(false); };
      const onKey = (e) => { if (e.key === 'Escape') setFiltersOpen(false); };
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
      return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [filtersOpen]);

    const active = [
      owner !== 'all' && { key: 'owner', label: 'Owner', val: owner, clear: () => setOwner('all') },
      typeFilter !== 'all' && { key: 'type', label: 'Type', val: ACCOUNT_TYPES[typeFilter] ? ACCOUNT_TYPES[typeFilter].label : typeFilter, clear: () => setTypeFilter('all') },
    ].filter(Boolean);
    const clearAll = () => { setOwner('all'); setTypeFilter('all'); };

    return (
      <div className="filter-wrap">
        <div className="filter-bar acct-filter-bar">
          {/* Desktop: inline Owner select */}
          <div className="filter-field acct-ff-inline">
            <span className="filter-label"><Icon name="user" size={11} />Owner</span>
            <div className="select-wrap">
              <select id="acct-filter-owner-select" className="sel" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="all">All Owners</option>
                <option value="Sadun">Sadun</option>
                <option value="Handan">Handan</option>
                <option value="Shared">Shared</option>
              </select>
              <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </div>
          </div>
          {/* Desktop: inline Type select */}
          <div className="filter-field acct-ff-inline">
            <span className="filter-label"><Icon name="layers" size={11} />Type</span>
            <div className="select-wrap">
              <select id="acct-filter-type-select" className="sel" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="all">All Types</option>
                {Object.keys(ACCOUNT_TYPES).map(k => (
                  <option key={k} value={k}>{ACCOUNT_TYPES[k].label}</option>
                ))}
              </select>
              <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </div>
          </div>

          <div className="filter-field ff-search">
            <span className="filter-label"><Icon name="search" size={11} />Search</span>
            <div className="search-wrap">
              <Icon name="search" size={13} />
              <input id="acct-filter-search-input" className="search-input" placeholder="Account name…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {extra}

          {/* Mobile: Filters popover button */}
          <div className="filter-field acct-ff-filters">
            <span className="filter-label"><Icon name="sliders-horizontal" size={11} />Filters</span>
            <div className="filters-anchor" ref={filtersRef}>
              <button id="acct-filter-toggle-btn" className={'filters-btn' + (active.length ? ' has' : '') + (filtersOpen ? ' open' : '')} onClick={() => setFiltersOpen(o => !o)}>
                <Icon name="sliders-horizontal" size={14} />
                {active.length > 0 && <span className="filters-count">{active.length}</span>}
                <svg className="filters-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {filtersOpen && (
                <div className="filters-pop">
                  {popActions && <div className="fp-actions"><div className="filters-pop-head"><span>More Actions</span></div>{popActions}</div>}
                  <div className="filters-pop-head">
                    <span>Filter By</span>
                    {active.length > 0 && <button id="acct-filter-clear-all-btn" className="fp-clear" onClick={clearAll}><Icon name="x" size={12} />Clear All</button>}
                  </div>
                  <div className="filter-field" style={{width:'100%'}}>
                    <span className="filter-label" style={{display:'flex'}}><Icon name="user" size={11} />Owner</span>
                    <div className="select-wrap" style={{width:'100%'}}>
                      <select id="acct-filter-owner-mobile-select" className="sel" style={{width:'100%'}} value={owner} onChange={(e) => setOwner(e.target.value)}>
                        <option value="all">All Owners</option>
                        <option value="Sadun">Sadun</option>
                        <option value="Handan">Handan</option>
                        <option value="Shared">Shared</option>
                      </select>
                      <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                    </div>
                  </div>
                  <div className="filter-field" style={{width:'100%'}}>
                    <span className="filter-label" style={{display:'flex'}}><Icon name="layers" size={11} />Type</span>
                    <div className="select-wrap" style={{width:'100%'}}>
                      <select id="acct-filter-type-mobile-select" className="sel" style={{width:'100%'}} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                        <option value="all">All Types</option>
                        {Object.keys(ACCOUNT_TYPES).map(k => (
                          <option key={k} value={k}>{ACCOUNT_TYPES[k].label}</option>
                        ))}
                      </select>
                      <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="filter-field ff-tabs">
            <span className="filter-label"><Icon name="layout-grid" size={11} />View</span>
            <div className="view-toggle">
              <button id="acct-view-grid-btn" className={'vt-btn' + (layout === 'grid' ? ' active' : '')} onClick={() => setLayout('grid')} title="Grid view"><Icon name="layout-grid" size={14} /></button>
              <button id="acct-view-list-btn" className={'vt-btn' + (layout === 'list' ? ' active' : '')} onClick={() => setLayout('list')} title="List view"><Icon name="list" size={14} /></button>
            </div>
          </div>
        </div>

        {active.length > 0 && (
          <div className="active-chips">
            <span className="chips-lead"><Icon name="filter" size={12} />Active</span>
            {active.map(a => (
              <button key={a.key} id={'acct-filter-chip-' + a.key} className="chip" onClick={a.clear} title={'Clear ' + a.label + ' filter'}>
                <span className="chip-k">{a.label}:</span><span className="chip-v">{a.val}</span><Icon name="x" size={11} />
              </button>
            ))}
            <button id="acct-filter-chips-clear-btn" className="chip chip-clear" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>
    );
  }

  const TYPE_ORDER = ['bank', 'overdraft', 'debit', 'credit', 'wallet', 'invest', 'cash'];

  function App() {
    const [layout, setLayout] = window.HL_NAV.usePersistentView('list');
    const [accounts, setAccounts] = React.useState(INITIAL_ACCOUNTS);
    const [loadError, setLoadError] = React.useState(null);
    const [owner, setOwner] = React.useState('all');
    const [typeFilter, setTypeFilter] = React.useState('all');
    const [search, setSearch] = React.useState('');
    const [detail, setDetail] = React.useState(null);       // account obj
    const [formModal, setFormModal] = React.useState(null);  // {mode:'add'|'edit', account}
    const [del, setDel] = React.useState(null);              // account to delete
    const [importWiz, setImportWiz] = React.useState(null);  // {preAccId} or {} when open
    const [flashId, setFlashId] = React.useState(null);

    React.useEffect(() => { document.documentElement.style.setProperty('--accent', '#4f8ef7'); }, []);

    // Hydrate accounts from the backend on mount.
    React.useEffect(() => {
      window.HL_ACCOUNTS_API.list()
        .then(setAccounts)
        .catch(err => setLoadError(err.message));
    }, []);

    const filtered = React.useMemo(() => {
      return accounts.filter(a => {
        if (owner !== 'all' && a.owner !== owner) return false;
        if (typeFilter !== 'all' && a.type !== typeFilter) return false;
        if (search.trim() && !a.name.toLowerCase().includes(search.trim().toLowerCase()) &&
            !a.institution.toLowerCase().includes(search.trim().toLowerCase())) return false;
        return true;
      });
    }, [accounts, owner, typeFilter, search]);

    const grouped = React.useMemo(() => {
      const map = {};
      filtered.forEach(a => {
        if (!map[a.type]) map[a.type] = [];
        map[a.type].push(a);
      });
      return TYPE_ORDER.filter(k => map[k]).map(k => {
        const accts = map[k];
        const total = accts.reduce((s, a) => s + a.balance * (FX[a.cur] ? FX[a.cur].toTRY : 1), 0);
        return { type: k, accounts: accts, total };
      });
    }, [filtered]);

    function flash(id) { setFlashId(id); setTimeout(() => setFlashId(null), 1500); }

    function handleSave(acc) {
      const op = acc._dbId
        ? window.HL_ACCOUNTS_API.update(acc._dbId, acc)
        : window.HL_ACCOUNTS_API.create(acc);
      op.then(saved => {
        setAccounts(prev => acc._dbId
          ? prev.map(a => a._dbId === saved._dbId ? saved : a)
          : [saved, ...prev]);
        flash(saved.id);
        setFormModal(null);
        setDetail(null);
      }).catch(err => setLoadError(err.message));
    }

    function handleDelete() {
      const target = del;
      window.HL_ACCOUNTS_API.remove(target._dbId)
        .then(() => {
          setAccounts(prev => prev.filter(a => a._dbId !== target._dbId));
          setDel(null);
          setDetail(null);
        })
        .catch(err => setLoadError(err.message));
    }

    function openEdit(account) {
      setDetail(null);
      setFormModal({ mode: 'edit', account });
    }

    function openDeleteFromDetail(account) {
      setDetail(null);
      setDel(account);
    }

    function openImport(preAccId) {
      setDetail(null);
      setImportWiz({ preAccId: preAccId || null });
    }

    // Apply approved import rows: adjust each related account's balance by net delta
    // and persist the new balance to the backend.
    function handleImport(rows, byAcc) {
      const affected = accounts.filter(a => byAcc[a.id]);
      Promise.all(affected.map(a => {
        const updated = { ...a, balance: +(a.balance + byAcc[a.id].delta).toFixed(2) };
        return window.HL_ACCOUNTS_API.update(a._dbId, updated);
      })).then(saved => {
        const byDb = {};
        saved.forEach(s => { byDb[s._dbId] = s; });
        setAccounts(prev => prev.map(a => byDb[a._dbId] || a));
        if (saved.length) flash(saved[0].id);
      }).catch(err => setLoadError(err.message));
    }

    return (
      <div className="app">
        <Sidebar active="accounts" />
        <div className="main">
          <header className="page-head">
            <div className="page-head-top">
              <div className="page-title-wrap cfg-detail-title-wrap">
                <span className="cfg-title-icon" id="page-header-icon" style={{ color: '#8b5cf6' }}><Icon name="wallet" size={21} /></span>
                <div className="cfg-title-col">
                  <h1 className="page-title">Accounts</h1>
                  <p className="page-subtitle">Balances across every account</p>
                </div>
              </div>
              <div className="head-actions acct-head-actions">
                <button id="acct-import-btn" className="action-modal-btn scan" onClick={() => openImport(null)}><Icon name="file-down" size={14} />Import Statement</button>
                <button id="acct-add-btn" className="action-modal-btn ok ha-overflow" onClick={() => setFormModal({ mode: 'add', account: {} })}><Icon name="plus" size={14} />Add Account</button>
              </div>
            </div>
            <AccountsFilter owner={owner} setOwner={setOwner} typeFilter={typeFilter}
              setTypeFilter={setTypeFilter} search={search} setSearch={setSearch}
              layout={layout} setLayout={setLayout}
              popActions={<button id="acct-add-fp-btn" className="action-modal-btn ok" onClick={() => setFormModal({ mode: 'add', account: {} })}><Icon name="plus" size={14} />Add Account</button>}
              extra={<ExportData entity="accounts" entityLabel="Accounts"
                columns={EXPORT_COLS} rows={filtered} allRows={accounts} inline />} />
          </header>

          <div className="acct-body">
            {grouped.length === 0 && (
              <div className="acct-empty-state">
                <Icon name="wallet" size={36} />
                <span className="et">No accounts match</span>
                <span className="es">Try a different filter combination.</span>
              </div>
            )}

            {grouped.map(g => (
              <div className="acct-group" key={g.type}>
                <AccountGroupHeader typeKey={g.type} count={g.accounts.length} total={g.total} cur="TRY" />
                <div className={'card-grid acct-grid' + (layout === 'list' ? ' card-grid--list acct-list' : '')}>
                  {g.accounts.map(a => (
                    <AccountCard key={a.id} account={a} onClick={setDetail} flash={a.id === flashId} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {detail && <AccountDetail account={detail} onClose={() => setDetail(null)}
          onEdit={openEdit} onDelete={openDeleteFromDetail} onImport={openImport} />}
        {formModal && <AccountFormModal initial={formModal.account}
          onClose={() => setFormModal(null)} onSave={handleSave} />}
        {del && <DeleteAccountConfirm account={del}
          onClose={() => setDel(null)} onConfirm={handleDelete} />}
        {importWiz && <ImportWizard preAccId={importWiz.preAccId}
          onClose={() => setImportWiz(null)} onCommit={handleImport} />}

        <TweaksPanel title="Tweaks">
          <TweakSection label="Appearance" />
          <TweakColor label="Accent" value={'#4f8ef7'}
            options={['#4f8ef7', '#8b5cf6', '#22c55e', '#f97316', '#ec4899']}
            onChange={(v) => document.documentElement.style.setProperty('--accent', v)} />
        </TweaksPanel>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
