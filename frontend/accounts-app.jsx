// accounts-app.jsx — Home Ledger Accounts page.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { ACCOUNT_TYPES, ACCOUNTS: INITIAL_ACCOUNTS, FX } = window.ACCOUNTS_DATA;
  const { AccountCard, AccountGroupHeader, AccountDetail, AccountsSummary,
          AccountFormModal, DeleteAccountConfirm } = window;
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
  function AccountsFilter({ bankFilter, setBankFilter, typeFilter, setTypeFilter, balanceFilter, setBalanceFilter, search, setSearch, bankOptions, extra, popActions }) {
    const [filtersOpen, setFiltersOpen] = React.useState(false);
    const filtersRef = React.useRef(null);

    React.useEffect(() => {
      if (!filtersOpen) return;
      // Don't close on clicks inside a portaled StyledSelect dropdown (rendered to
      // <body>), or picking a filter option would unmount the popover mid-click.
      const onDoc = (e) => { if (filtersRef.current && !filtersRef.current.contains(e.target) && !e.target.closest('.ss-dropdown')) setFiltersOpen(false); };
      const onKey = (e) => { if (e.key === 'Escape') setFiltersOpen(false); };
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
      return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [filtersOpen]);

    const active = [
      bankFilter !== 'all' && { key: 'bank', label: 'Bank', val: bankFilter, clear: () => setBankFilter('all') },
      typeFilter !== 'all' && { key: 'type', label: 'Account Type', val: ACCOUNT_TYPES[typeFilter] ? ACCOUNT_TYPES[typeFilter].label : typeFilter, clear: () => setTypeFilter('all') },
      balanceFilter === 'assets' && { key: 'balance', label: 'Balance', val: 'Assets', clear: () => setBalanceFilter('all') },
      balanceFilter === 'liabilities' && { key: 'balance', label: 'Balance', val: 'Liabilities', clear: () => setBalanceFilter('all') },
    ].filter(Boolean);
    const clearAll = () => { setBankFilter('all'); setTypeFilter('all'); setBalanceFilter('all'); };

    return (
      <div className="filter-wrap">
        <div className="filter-bar acct-filter-bar">
          <div className="filter-field ff-search">
            <span className="filter-label"><Icon name="search" size={11} />Search</span>
            <div className="search-wrap">
              <Icon name="search" size={13} />
              <input id="acct-filter-search-input" className="search-input" placeholder="Account name…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {extra}

          <div className="filter-field ff-filters acct-ff-filters">
            <span className="filter-label"><Icon name="sliders-horizontal" size={11} />Filters</span>
            <div className="filters-anchor" ref={filtersRef}>
              <button id="acct-filter-toggle-btn" className={'filters-btn' + (active.length ? ' has' : '') + (filtersOpen ? ' open' : '')} onClick={() => setFiltersOpen(o => !o)}>
                <Icon name="sliders-horizontal" size={14} /><span className="filters-text">Filters</span>
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
                    <span className="filter-label" style={{display:'flex'}}><Icon name="building-2" size={11} />Bank</span>
                    <div className="select-wrap" style={{width:'100%'}}>
                      <StyledSelect id="acct-filter-bank-select" className="sel" style={{width:'100%'}} value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}>
                        <option value="all">All Banks</option>
                        {bankOptions.map(bank => <option key={bank} value={bank}>{bank}</option>)}
                      </StyledSelect>
                    </div>
                  </div>
                  <div className="filter-field" style={{width:'100%'}}>
                    <span className="filter-label" style={{display:'flex'}}><Icon name="layers" size={11} />Account Type</span>
                    <div className="select-wrap" style={{width:'100%'}}>
                      <StyledSelect id="acct-filter-type-select" className="sel" style={{width:'100%'}} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                        <option value="all">All Account Types</option>
                        {Object.keys(ACCOUNT_TYPES).map(k => (
                          <option key={k} value={k}>{ACCOUNT_TYPES[k].label}</option>
                        ))}
                      </StyledSelect>
                    </div>
                  </div>
                  <div className="filter-field" style={{width:'100%'}}>
                    <span className="filter-label" style={{display:'flex'}}><Icon name="landmark" size={11} />Balance</span>
                    <div className="select-wrap" style={{width:'100%'}}>
                      <StyledSelect id="acct-filter-balance-select" className="sel" style={{width:'100%'}} value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value)}>
                        <option value="all">All Balances</option>
                        <option value="assets">Assets</option>
                        <option value="liabilities">Liabilities</option>
                      </StyledSelect>
                    </div>
                  </div>
                </div>
              )}
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

  function accountTryValue(a) {
    return a.balance * (FX[a.cur] ? FX[a.cur].toTRY : 1);
  }

  function accountBalanceSide(a) {
    const type = ACCOUNT_TYPES[a.type] || {};
    if (type.balanceSide === 'liability' || type.balanceSide === 'asset') return type.balanceSide;
    return accountTryValue(a) < 0 ? 'liability' : 'asset';
  }

  function filterBalanceSide(value) {
    if (value === 'assets') return 'asset';
    if (value === 'liabilities') return 'liability';
    return 'all';
  }

  const TYPE_ORDER = ['bank', 'overdraft', 'debit', 'credit', 'wallet', 'invest', 'pension', 'cash'];

  // Which account groups are collapsed, keyed by account type and persisted so the
  // choice survives a reload. Stored as a plain array of type keys — the set of
  // groups on screen depends on the active filters, and a key for a group that is
  // currently filtered out simply sits idle until that group reappears.
  //
  // Default is ALL groups collapsed, so the page opens as a scannable list of
  // group headers (each with its own count + total) instead of every card at once.
  // Note the missing-vs-empty distinction: a *missing* key means "never chose"
  // → collapse everything, while a stored `[]` means the user deliberately
  // expanded them all and must be honoured. Reading with `|| '[]'` would conflate
  // the two and re-collapse the page on every visit.
  const COLLAPSE_KEY = 'hl-accounts-collapsed-groups';
  function loadCollapsed() {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY);
      if (stored === null) return new Set(TYPE_ORDER);
      const raw = JSON.parse(stored);
      return new Set(Array.isArray(raw) ? raw.filter(k => TYPE_ORDER.includes(k)) : TYPE_ORDER);
    } catch (e) { return new Set(TYPE_ORDER); }
  }

  function App() {
    const URLP = React.useMemo(() => {
      try { return new URLSearchParams(window.location.search); } catch (e) { return new URLSearchParams(); }
    }, []);
    const [accounts, setAccounts] = React.useState(INITIAL_ACCOUNTS);
    const [loadError, setLoadError] = React.useState(null);
    const [saveError, setSaveError] = React.useState(null);   // rejected save, shown inside the form modal
    const [bankFilter, setBankFilter] = React.useState('all');
    const [typeFilter, setTypeFilter] = React.useState('all');
    const [balanceFilter, setBalanceFilter] = React.useState(() => {
      const b = URLP.get('balance');
      return ['assets', 'liabilities'].includes(b) ? b : 'all';
    });
    const [search, setSearch] = React.useState('');
    const [detail, setDetail] = React.useState(null);       // account obj
    const [formModal, setFormModal] = React.useState(null);  // {mode:'add'|'edit', account}
    const [del, setDel] = React.useState(null);              // account to delete
    const [flashId, setFlashId] = React.useState(null);
    const [collapsed, setCollapsed] = React.useState(loadCollapsed);

    function toggleGroup(type) {
      setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(type)) next.delete(type); else next.add(type);
        try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch (e) {}
        return next;
      });
    }

    React.useEffect(() => { window.HL_THEME.accent('var(--theme-accent)'); }, []);

    // Hydrate accounts from the backend on mount, together with the institution
    // map (names + logos) so cards paint their logos on the first render rather
    // than flashing the generic type icon. A failure to load institutions is not
    // fatal — the bootstrap map still names the banks, only logos are missing.
    React.useEffect(() => {
      const insts = window.HL_INSTITUTIONS_API
        ? window.HL_INSTITUTIONS_API.hydrate().catch(err => {
            console.warn('[accounts] institutions unavailable:', err.message);
          })
        : Promise.resolve();
      insts
        .then(() => window.HL_ACCOUNTS_API.list())
        .then(setAccounts)
        .catch(err => setLoadError(err.message));
    }, []);

    const filtered = React.useMemo(() => {
      return accounts.filter(a => {
        if (bankFilter !== 'all' && a.institution !== bankFilter) return false;
        if (typeFilter !== 'all' && a.type !== typeFilter) return false;
        if (balanceFilter !== 'all' && accountBalanceSide(a) !== filterBalanceSide(balanceFilter)) return false;
        if (search.trim() && !a.name.toLowerCase().includes(search.trim().toLowerCase()) &&
            !a.institution.toLowerCase().includes(search.trim().toLowerCase())) return false;
        return true;
      });
    }, [accounts, bankFilter, typeFilter, balanceFilter, search]);

    const bankOptions = React.useMemo(() => {
      return [...new Set(accounts.map(a => a.institution).filter(v => v && v !== '–'))]
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }, [accounts]);

    const grouped = React.useMemo(() => {
      const map = {};
      filtered.forEach(a => {
        if (!map[a.type]) map[a.type] = [];
        map[a.type].push(a);
      });
      return TYPE_ORDER.filter(k => map[k]).map(k => {
        const accts = map[k];
        const total = accts.reduce((s, a) => s + accountTryValue(a), 0);
        return { type: k, accounts: accts, total };
      });
    }, [filtered]);

    function flash(id) { setFlashId(id); setTimeout(() => setFlashId(null), 1500); }

    function handleSave(acc) {
      setSaveError(null);
      const editing = !!acc._dbId;
      const op = window.HL_OP_NOTIFY.promise(
        editing ? window.HL_ACCOUNTS_API.update(acc._dbId, acc) : window.HL_ACCOUNTS_API.create(acc),
        {
          pending: editing ? 'Updating account...' : 'Saving account...',
          success: editing ? 'Account updated.' : 'Account saved.',
          error: false,
        }
      );
      op.then(saved => {
        setAccounts(prev => acc._dbId
          ? prev.map(a => a._dbId === saved._dbId ? saved : a)
          : [saved, ...prev]);
        flash(saved.id);
        setFormModal(null);
        setDetail(null);
        })
        // Keep the form open and show why — a rejected save (most often the
        // per-type unique IBAN / card number) used to land in `loadError`, which
        // nothing renders, so Save simply appeared to do nothing.
        .catch(err => {
          setSaveError(err.message);
          window.HL_OP_NOTIFY.show((editing ? 'Could not update account: ' : 'Could not save account: ') + err.message, { type: 'error', timeout: 4200 });
        });
    }

    function handleDelete() {
      const target = del;
      window.HL_OP_NOTIFY.promise(
        window.HL_ACCOUNTS_API.remove(target._dbId),
        { pending: 'Deleting account...', success: 'Account deleted.', error: false }
      )
        .then(() => {
          setAccounts(prev => prev.filter(a => a._dbId !== target._dbId));
          setDel(null);
          setDetail(null);
        })
        .catch(err => {
          setLoadError(err.message);
          window.HL_OP_NOTIFY.show('Could not delete account: ' + err.message, { type: 'error', timeout: 4200 });
        });
    }

    function openEdit(account) {
      setDetail(null);
      setFormModal({ mode: 'edit', account });
    }

    function openDeleteFromDetail(account) {
      setDetail(null);
      setDel(account);
    }

    return (
      <div className="app">
        <Sidebar active="accounts" />
        <div className="main">
          <header className="page-head">
            <div className="page-head-top">
              <div className="page-title-wrap cfg-detail-title-wrap">
                <div className="cfg-title-col">
                  <h1 className="page-title">Accounts</h1>
                  <p className="page-subtitle">Balances across every account</p>
                </div>
              </div>
              <div className="head-actions acct-head-actions">
                <button id="acct-add-btn" className="action-modal-btn ok ha-overflow" onClick={() => setFormModal({ mode: 'add', account: {} })}><Icon name="plus" size={14} />Add Account</button>
              </div>
            </div>
            <AccountsFilter bankFilter={bankFilter} setBankFilter={setBankFilter}
              typeFilter={typeFilter} setTypeFilter={setTypeFilter}
              balanceFilter={balanceFilter} setBalanceFilter={setBalanceFilter}
              search={search} setSearch={setSearch}
              bankOptions={bankOptions}
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
              <div className={'acct-group' + (collapsed.has(g.type) ? ' is-collapsed' : '')} key={g.type}>
                <AccountGroupHeader typeKey={g.type} count={g.accounts.length} total={g.total} cur="TRY"
                  collapsed={collapsed.has(g.type)} onToggle={() => toggleGroup(g.type)} />
                {!collapsed.has(g.type) && (
                  <div className="card-grid acct-grid card-grid--list acct-list">
                    {g.accounts.map(a => (
                      <AccountCard key={a.id} account={a} onClick={setDetail} flash={a.id === flashId} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {detail && <AccountDetail account={detail} onClose={() => setDetail(null)}
          onEdit={openEdit} onDelete={openDeleteFromDetail} />}
        {formModal && <AccountFormModal initial={formModal.account} accounts={accounts}
          error={saveError} onClearError={() => setSaveError(null)}
          onClose={() => { setSaveError(null); setFormModal(null); }} onSave={handleSave} />}
        {del && <DeleteAccountConfirm account={del}
          onClose={() => setDel(null)} onConfirm={handleDelete} />}

        <TweaksPanel title="Tweaks">
          <TweakSection label="Appearance" />
          <TweakColor label="Accent" value={'var(--theme-accent)'}
            options={['var(--theme-accent)', 'var(--lavender)', 'var(--green)', 'var(--orange)', 'var(--pink)']}
            onChange={(v) => window.HL_THEME.accent(v)} />
        </TweaksPanel>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
