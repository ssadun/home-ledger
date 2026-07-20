// budgets-app.jsx — Home Ledger Budgets page.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { CATS, TX, FX, CURRENT_MONTH, CURRENT_YEAR } = window.LEDGER;
  const { MONTHS } = window.LEDGER_FMT;
  const { BUDGETS } = window.BUDGETS_DATA;
  const { statusOf } = window.BUDGET_STATUS;
  const { BudgetCard, BudgetModal } = window;
  const ExportData = window.ExportData;
  const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakColor } = window;

  const TWEAK_DEFAULTS = { accent: '#4f8ef7', sort: 'usage' };

  const { Sidebar } = window.HL_NAV;

  // ── CSV export schema ──
  const EXPORT_COLS = [
    { key: 'cat', label: 'Category', get: r => (CATS[r.cat] || {}).label || r.cat },
    { key: 'limit', label: 'Monthly Limit (TRY)' },
    { key: 'spent', label: 'Spent (TRY)' },
    { key: 'remaining', label: 'Remaining (TRY)', get: r => +(r.limit - r.spent).toFixed(2) },
    { key: 'util', label: 'Utilization %', get: r => r.limit ? Math.round((r.spent / r.limit) * 100) : '' },
    { key: 'status', label: 'Status' },
    { key: 'start', label: 'Period Start' },
    { key: 'end', label: 'Period End' },
    { key: 'periodState', label: 'Period State' },
  ];

  // ── Budgets filter bar with mobile Filters popover ──
  function BgtFilterBar({ search, setSearch, sort, setSort, month, year, monthStep, layout, setLayout, exportEl }) {
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
      sort !== 'usage' && { key: 'sort', label: 'Sort', val: { usage: 'Utilization', name: 'Name', limit: 'Limit', spent: 'Spent' }[sort], clear: () => setSort('usage') },
    ].filter(Boolean);
    const clearAll = () => { setSort('usage'); };

    return (
      <div className="filter-wrap">
        <div className="filter-bar bgt-filter-bar">
          <div className="filter-field ff-period">
            <span className="filter-label"><Icon name="calendar" size={11} />Period</span>
            <div className="month-step">
              <button id="bgt-period-prev-btn" className="ms-btn" onClick={() => monthStep(-1)} title="Previous month"><Icon name="chevron-left" size={14} /></button>
              <span className="ms-label"><Icon name="calendar-days" size={13} />{MONTHS[month]} {year}</span>
              <button id="bgt-period-next-btn" className="ms-btn" onClick={() => monthStep(1)} title="Next month"><Icon name="chevron-right" size={14} /></button>
            </div>
          </div>
          <div className="filter-field ff-search">
            <span className="filter-label"><Icon name="search" size={11} />Search</span>
            <div className="search-wrap">
              <Icon name="search" size={13} />
              <input id="bgt-search-input" className="search-input" type="text" placeholder="Category…"
                value={search} onChange={e => setSearch(e.target.value)} />
              {search && <button id="bgt-search-clear-btn" className="search-clear" onClick={() => setSearch('')} title="Clear"><Icon name="x" size={12} /></button>}
            </div>
          </div>
          {exportEl}
          {/* Desktop: inline Sort select */}
          <div className="filter-field ff-sort bgt-ff-inline">
            <span className="filter-label"><Icon name="arrow-up-down" size={11} />Sort By</span>
            <div className="select-wrap">
              <StyledSelect id="bgt-sort-select" className="sel" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="usage">Utilization</option>
                <option value="name">Name</option>
                <option value="limit">Limit</option>
                <option value="spent">Spent</option>
              </StyledSelect>
            </div>
          </div>

          {/* Mobile: Filters popover button */}
          <div className="filter-field bgt-ff-filters">
            <span className="filter-label"><Icon name="sliders-horizontal" size={11} />Filters</span>
            <div className="filters-anchor" ref={filtersRef}>
              <button id="bgt-filters-toggle-btn" className={'filters-btn' + (active.length ? ' has' : '') + (filtersOpen ? ' open' : '')} onClick={() => setFiltersOpen(o => !o)}>
                <Icon name="sliders-horizontal" size={14} />
                {active.length > 0 && <span className="filters-count">{active.length}</span>}
                <svg className="filters-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {filtersOpen && (
                <div className="filters-pop">
                  <div className="filters-pop-head">
                    <span>Filter & Sort</span>
                    {active.length > 0 && <button id="bgt-filters-clear-all-btn" className="fp-clear" onClick={clearAll}><Icon name="x" size={12} />Clear All</button>}
                  </div>
                  <div className="filter-field" style={{width:'100%'}}>
                    <span className="filter-label" style={{display:'flex'}}><Icon name="arrow-up-down" size={11} />Sort By</span>
                    <div className="select-wrap" style={{width:'100%'}}>
                      <StyledSelect id="bgt-sort-mobile-select" className="sel" style={{width:'100%'}} value={sort} onChange={(e) => setSort(e.target.value)}>
                        <option value="usage">Utilization</option>
                        <option value="name">Name</option>
                        <option value="limit">Limit</option>
                        <option value="spent">Spent</option>
                      </StyledSelect>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="filter-field ff-tabs">
            <span className="filter-label"><Icon name="layout-grid" size={11} />View</span>
            <div className="view-toggle">
              <button id="bgt-view-grid-btn" className={'vt-btn' + (layout === 'grid' ? ' active' : '')} onClick={() => setLayout('grid')} title="Grid view"><Icon name="layout-grid" size={14} /></button>
              <button id="bgt-view-list-btn" className={'vt-btn' + (layout === 'list' ? ' active' : '')} onClick={() => setLayout('list')} title="List view"><Icon name="list" size={14} /></button>
            </div>
          </div>
        </div>

        {active.length > 0 && (
          <div className="active-chips">
            <span className="chips-lead"><Icon name="filter" size={12} />Active</span>
            {active.map(a => (
              <button key={a.key} id={'bgt-chip-' + a.key} className="chip" onClick={a.clear} title={'Clear ' + a.label}>
                <span className="chip-k">{a.label}:</span><span className="chip-v">{a.val}</span><Icon name="x" size={11} />
              </button>
            ))}
            <button id="bgt-chips-clear-btn" className="chip chip-clear" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>
    );
  }

  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const [budgets, setBudgets] = React.useState({});

    // Load budgets from the backend on mount (replaces the static BUDGETS seed).
    React.useEffect(() => {
      if (!window.HL_BUDGETS_API) return;
      let alive = true;
      window.HL_BUDGETS_API.list()
        .then(dict => { if (alive) setBudgets(dict); })
        .catch(() => {});
      return () => { alive = false; };
    }, []);
    const [month, setMonth] = React.useState(CURRENT_MONTH);   // current month (0-indexed)
    const [year, setYear] = React.useState(CURRENT_YEAR);
    const [modal, setModal] = React.useState(null);  // {cat, limit, spent} or {} for new
    const [flashCat, setFlashCat] = React.useState(null);
    const [search, setSearch] = React.useState('');
    const [layout, setLayout] = window.HL_NAV.usePersistentView('list');

    React.useEffect(() => { document.documentElement.style.setProperty('--accent', t.accent); }, [t.accent]);

    function monthStep(d) {
      let m = month + d, y = year;
      if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
      setMonth(m); setYear(y);
    }

    // spend per category for the selected month (TRY, expenses only)
    const spendByCat = React.useMemo(() => {
      const mm = String(month + 1).padStart(2, '0');
      const prefix = `${year}-${mm}`;
      const map = {};
      TX.forEach(r => {
        if (r.type !== 'expense') return;
        if (!r.date.startsWith(prefix)) return;
        map[r.cat] = (map[r.cat] || 0) + r.tryV;
      });
      return map;
    }, [month, year]);

    const rows = React.useMemo(() => {
      const viewIdx = year * 12 + month;
      const arr = Object.keys(budgets).map(cat => {
        const b = budgets[cat];
        // Spending is tracked in TRY, so convert the limit to TRY for status/math.
        const rate = (FX[b.currency] || FX.TRY).toTRY;
        const limit = +((b.limit || 0) * rate).toFixed(2);
        const spent = +(spendByCat[cat] || 0).toFixed(2);
        // month index helpers from ISO date (YYYY-MM-DD)
        const idxOf = (iso) => { const [y, m] = iso.split('-'); return (+y) * 12 + (+m - 1); };
        const startIdx = b.start ? idxOf(b.start) : null, endIdx = b.end ? idxOf(b.end) : null;
        let periodState, monthsLeft;
        if (!b.start || !b.end) { periodState = 'open'; monthsLeft = null; }
        else if (viewIdx < startIdx) { periodState = 'upcoming'; monthsLeft = startIdx - viewIdx; }
        else if (viewIdx > endIdx) { periodState = 'ended'; monthsLeft = 0; }
        else { periodState = 'active'; monthsLeft = endIdx - viewIdx; }
        return { cat, limit, limitOrig: b.limit, currency: b.currency || 'TRY', spent, start: b.start, end: b.end, periodState, monthsLeft, status: statusOf(spent, limit) };
      });
      const order = { over: 0, warn: 1, under: 2, none: 3 };
      arr.sort((a, b) => {
        if (t.sort === 'name') return CATS[a.cat].label.localeCompare(CATS[b.cat].label);
        if (t.sort === 'limit') return b.limit - a.limit;
        if (t.sort === 'spent') return b.spent - a.spent;
        // usage: status first, then by % used desc
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return (b.spent / b.limit) - (a.spent / a.limit);
      });
      return arr;
    }, [budgets, spendByCat, t.sort, month, year]);

    const filtered = React.useMemo(() => {
      if (!search.trim()) return rows;
      const q = search.trim().toLowerCase();
      return rows.filter(r => (CATS[r.cat]?.label || r.cat).toLowerCase().includes(q));
    }, [rows, search]);

    function flash(cat) { setFlashCat(cat); setTimeout(() => setFlashCat(null), 1500); }

    async function handleSave({ cat, limit, currency, start, end }) {
      try {
        const entry = await window.HL_BUDGETS_API.save(cat, { limit, currency, start, end });
        setBudgets(prev => ({ ...prev, [cat]: entry }));
        setModal(null);
        flash(cat);
      } catch (err) {
        alert('Could not save budget: ' + (err.message || err));
      }
    }
    async function handleRemove(cat) {
      try {
        await window.HL_BUDGETS_API.remove(cat);
        setBudgets(prev => { const n = { ...prev }; delete n[cat]; return n; });
        setModal(null);
      } catch (err) {
        alert('Could not delete budget: ' + (err.message || err));
      }
    }

    const existingCats = Object.keys(budgets);

    return (
      <div className="app">
        <Sidebar active="budgets" />
        <div className="main">
          <header className="page-head">
            <div className="page-head-top">
              <div className="page-title-wrap cfg-detail-title-wrap">
                <span className="cfg-title-icon" id="page-header-icon" style={{ color: 'var(--yellow)' }}><Icon name="target" size={21} /></span>
                <div className="cfg-title-col">
                  <h1 className="page-title">Budgets</h1>
                  <p className="page-subtitle">Monthly limits and spending progress</p>
                </div>
              </div>
              <button id="bgt-new-btn" className="action-modal-btn ok" onClick={() => setModal({})}><Icon name="plus" size={14} />New Budget</button>
            </div>
            <BgtFilterBar search={search} setSearch={setSearch} sort={t.sort} setSort={v => setTweak('sort', v)}
              month={month} year={year} monthStep={monthStep} layout={layout} setLayout={setLayout}
              exportEl={<ExportData entity="budgets" entityLabel="Budgets"
                period={year + '-' + String(month + 1).padStart(2, '0')}
                columns={EXPORT_COLS} rows={filtered} allRows={rows} inline />} />
          </header>

          <div className="bgt-body">
            {rows.length === 0 ? (
              <div className="acct-empty-state">
                <Icon name="target" size={36} />
                <span className="et">No budgets set</span>
                <span className="es">Add a monthly limit to start tracking a category.</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="acct-empty-state">
                <Icon name="search" size={36} />
                <span className="et">No results</span>
                <span className="es">No budgets match "{search}"</span>
              </div>
            ) : (
              <div className={'card-grid bgt-grid' + (layout === 'list' ? ' card-grid--list bgt-list' : '')}>
                {filtered.map(r => (
                  <BudgetCard key={r.cat} row={r} flash={r.cat === flashCat}
                    onClick={(row) => setModal({ cat: row.cat, limit: row.limitOrig, currency: row.currency, spent: row.spent, start: row.start, end: row.end })} />
                ))}
              </div>
            )}
          </div>
        </div>

        {modal && <BudgetModal initial={modal} existingCats={existingCats}
          onClose={() => setModal(null)} onSave={handleSave} onRemove={handleRemove} />}

        <TweaksPanel title="Tweaks">
          <TweakSection label="Appearance" />
          <TweakColor label="Accent" value={t.accent}
            options={['#4f8ef7', '#8b5cf6', '#22c55e', '#f97316', '#ec4899']}
            onChange={(v) => setTweak('accent', v)} />
        </TweaksPanel>
      </div>
    );
  }

  // Pre-mount hydration so the per-category "spent" (derived from LEDGER.TX) and
  // category labels reflect real DB data on first render. Budget limits are
  // loaded separately by the App's own effect.
  window.HL_HYDRATE.all().finally(() => {
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  });
})();
