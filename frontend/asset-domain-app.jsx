// asset-domain-app.jsx — Net worth overview and Assets CRUD.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const DateInput = window.DateInput;
  const CurrencyInput = window.CurrencyInput;
  const { Sidebar } = window.HL_NAV;
  const { grp, SYM } = window.LEDGER_FMT;
  const API = window.HL_ASSET_DOMAIN;
  const ExportData = window.ExportData;

  const todayIso = () => new Date().toISOString().slice(0, 10);
  const meta = (map, key) => map[key] || map.other;
  const money = (v, cur = 'TRY', dec = 0) => (SYM[cur] || cur + ' ') + grp(v || 0, dec);
  const EXPORT_COLS = [
    { key: 'name', label: 'Name' },
    { key: 'subtype', label: 'Asset Type', get: r => API.PHYSICAL_SUBTYPES[r.subtype] || 'Other Physical Asset' },
    { key: 'institution', label: 'Location / Custodian' },
    { key: 'ownership', label: 'Ownership %' },
    { key: 'acquisitionCost', label: 'Acquisition Cost' },
    { key: 'cur', label: 'Currency' },
    { key: 'active', label: 'Status', get: r => r.active ? 'Active' : 'Inactive' },
    { key: 'include', label: 'Net Worth', get: r => r.include ? 'Included' : 'Excluded' },
  ];

  function AssetFilterBar({ search, setSearch, subtype, setSubtype, status, setStatus, netWorth, setNetWorth, rows, filtered, onNew }) {
    const [open, setOpen] = React.useState(false);
    const anchorRef = React.useRef(null);
    React.useEffect(() => {
      if (!open) return;
      const onDoc = e => { if (anchorRef.current && !anchorRef.current.contains(e.target) && !e.target.closest('.ss-dropdown')) setOpen(false); };
      const onKey = e => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
      return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);
    const active = [
      subtype !== 'all' && { key: 'type', label: 'Type', val: API.PHYSICAL_SUBTYPES[subtype], clear: () => setSubtype('all') },
      status !== 'all' && { key: 'status', label: 'Status', val: status === 'active' ? 'Active' : 'Inactive', clear: () => setStatus('all') },
      netWorth !== 'all' && { key: 'net-worth', label: 'Net Worth', val: netWorth === 'included' ? 'Included' : 'Excluded', clear: () => setNetWorth('all') },
    ].filter(Boolean);
    const clearAll = () => { setSubtype('all'); setStatus('all'); setNetWorth('all'); };
    return (
      <div className="filter-wrap asset-filter-wrap">
        <div className="filter-bar asset-filter-bar">
          <div className="filter-field ff-search">
            <span className="filter-label"><Icon name="search" size={11} />Search</span>
            <div className="search-wrap">
              <Icon name="search" size={13} />
              <input id="asset-search-input" className="search-input" value={search} placeholder="Name, type, or location..." onChange={e => setSearch(e.target.value)} />
              {search && <button id="asset-search-clear-btn" className="search-clear" onClick={() => setSearch('')} title="Clear search"><Icon name="x" size={12} /></button>}
            </div>
          </div>
          {ExportData && <ExportData entity="physical-assets" entityLabel="Physical Assets" columns={EXPORT_COLS} rows={filtered} allRows={rows} inline />}
          <div className="filter-field ff-filters">
            <span className="filter-label"><Icon name="sliders-horizontal" size={11} />Filters</span>
            <div className="filters-anchor" ref={anchorRef}>
              <button id="asset-filter-toggle-btn" className={'filters-btn' + (active.length ? ' has' : '') + (open ? ' open' : '')} onClick={() => setOpen(v => !v)}>
                <Icon name="sliders-horizontal" size={14} /><span className="filters-text">Filters</span>
                {active.length > 0 && <span className="filters-count">{active.length}</span>}
                <svg className="filters-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {open && <div className="filters-pop">
                <div className="fp-actions"><div className="filters-pop-head"><span>More Actions</span></div><button id="asset-new-fp-btn" className="action-modal-btn ok" onClick={() => { setOpen(false); onNew(); }}><Icon name="plus" size={14} />New Physical Asset</button></div>
                <div className="filters-pop-head"><span>Filter By Column</span>{active.length > 0 && <button id="asset-filter-clear-all-btn" className="fp-clear" onClick={clearAll}><Icon name="x" size={12} />Clear All</button>}</div>
                <div className="filter-field"><span className="field-label">Asset Type</span><StyledSelect id="asset-filter-type-select" className="field-input" value={subtype} onChange={e => setSubtype(e.target.value)}><option value="all">All Types</option>{Object.keys(API.PHYSICAL_SUBTYPES).map(key => <option key={key} value={key}>{API.PHYSICAL_SUBTYPES[key]}</option>)}</StyledSelect></div>
                <div className="filter-field"><span className="field-label">Status</span><StyledSelect id="asset-filter-status-select" className="field-input" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All Statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></StyledSelect></div>
                <div className="filter-field"><span className="field-label">Net Worth</span><StyledSelect id="asset-filter-net-worth-select" className="field-input" value={netWorth} onChange={e => setNetWorth(e.target.value)}><option value="all">All Records</option><option value="included">Included</option><option value="excluded">Excluded</option></StyledSelect></div>
              </div>}
            </div>
          </div>
        </div>
        {active.length > 0 && <div className="active-chips"><span className="chips-lead"><Icon name="filter" size={12} />Active</span>{active.map(a => <button key={a.key} id={'asset-filter-chip-' + a.key} className="chip" onClick={a.clear}><span className="chip-k">{a.label}:</span><span className="chip-v">{a.val}</span><Icon name="x" size={11} /></button>)}<button id="asset-filter-chips-clear-btn" className="chip chip-clear" onClick={clearAll}>Clear all</button></div>}
      </div>
    );
  }

  function Toolbar({ mode, search, setSearch, subtype, setSubtype, status, setStatus, netWorth, setNetWorth, rows, filtered, onNew }) {
    const title = mode === 'overview' ? 'Assets Overview' : 'Pyhsical Assets';
    const subtitle = mode === 'overview' ? 'Net worth, valuation freshness, and linked records' : 'Homes, vehicles, land, and other owned physical property';
    const canCreate = mode !== 'overview';
    const createLabel = 'New Physical Asset';
    return (
      <React.Fragment>
        <header className="page-head">
          <div className="page-head-top">
            <div className="cfg-detail-head-left">
              <div className="page-title-wrap cfg-detail-title-wrap">
                <div className="cfg-title-col">
                  <h1 className="page-title">{title}</h1>
                  <p className="page-subtitle">{subtitle}</p>
                </div>
              </div>
            </div>
            <div className="head-actions asset-head-actions">
              {canCreate && <button id="asset-new-btn" className="action-modal-btn ok ha-overflow" onClick={onNew}><Icon name="plus" size={14} />{createLabel}</button>}
            </div>
          </div>
          {canCreate && <AssetFilterBar search={search} setSearch={setSearch} subtype={subtype} setSubtype={setSubtype} status={status} setStatus={setStatus} netWorth={netWorth} setNetWorth={setNetWorth} rows={rows} filtered={filtered} onNew={onNew} />}
        </header>
      </React.Fragment>
    );
  }

  function Overview({ summary, assets }) {
    const assetValue = assets.reduce((s, a) => s + (a.latest ? a.latest.tryValue * (a.ownership || 100) / 100 : 0), 0);
    const cards = [
      { label: 'Assets', icon: 'trending-up', cls: 'income', val: money(summary?.assets_try ?? assetValue), sub: (summary?.assets_count ?? assets.length) + ' records' },
      { label: 'Net Worth', icon: 'scale', cls: 'net', val: money(summary?.net_worth_try ?? assetValue), sub: 'Included values' },
      { label: 'Needs Update', icon: 'alert-triangle', cls: (summary?.missing_asset_valuations || 0) ? 'expense' : 'count', val: String(summary?.missing_asset_valuations || 0), sub: 'missing values' },
    ];
    const staleAssets = assets.filter(a => !a.latest).slice(0, 6);
    return (
      <main className="asset-body">
        <div className="summary-row">
          {cards.map(c => <div className="summary-card" key={c.label}><span className="summary-label"><Icon name={c.icon} size={13} />{c.label}</span><span className={'summary-value ' + c.cls}>{c.val}</span><span className="summary-sub">{c.sub}</span></div>)}
        </div>
        <div className="asset-overview-grid">
          <section className="asset-panel">
            <div className="asset-panel-head"><span><Icon name="wallet" size={14} />Largest Assets</span><a href="Assets.html">Open Assets</a></div>
            {assets.filter(a => a.latest).sort((a, b) => b.latest.tryValue - a.latest.tryValue).slice(0, 8).map(a => <MiniRow key={a.id} item={a} kind="asset" />)}
            {!assets.length && <Empty icon="wallet" text="No assets yet." />}
          </section>
          <section className="asset-panel asset-panel-wide">
            <div className="asset-panel-head"><span><Icon name="alert-triangle" size={14} />Needs Valuation</span></div>
            {staleAssets.map(a => <MiniRow key={a.id} item={a} kind="asset" />)}
            {!staleAssets.length && <Empty icon="check-circle" text="Every included asset has a valuation." />}
          </section>
        </div>
      </main>
    );
  }

  function Empty({ icon, text }) {
    return <div className="detail-empty asset-empty"><Icon name={icon} size={24} /><span>{text}</span></div>;
  }

  function MiniRow({ item }) {
    const m = meta(API.ASSET_TYPES, item.type);
    const latest = item.latest;
    return (
      <div className="asset-mini-row">
        <span className="asset-card-icon" style={{ '--asset-color': m.color }}><Icon name={m.icon} size={14} /></span>
        <span className="asset-mini-main"><b>{item.name}</b><small>{m.label}{item.institution ? ' - ' + item.institution : ''}</small></span>
        <span className="asset-mini-val income">{latest ? money(latest.tryValue, 'TRY') : 'No value'}</span>
      </div>
    );
  }

  function AssetCard({ item, onEdit, onValuation, onDelete, flash }) {
    const m = meta(API.ASSET_TYPES, item.type);
    const icon = API.PHYSICAL_SUBTYPE_ICONS[item.subtype] || API.PHYSICAL_SUBTYPE_ICONS.other;
    const latest = item.latest;
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onEdit(item);
      }
    };
    return (
      <div id={'asset-card-' + item.id} className={'asset-card' + (flash ? ' row-flash' : '')} role="button" tabIndex="0" onClick={() => onEdit(item)} onKeyDown={onKey}>
        <div className="asset-card-top">
          <span className="asset-card-icon" style={{ '--asset-color': m.color }}><Icon name={icon} size={16} /></span>
          <span className="asset-card-main"><b>{item.name}</b><small>{API.PHYSICAL_SUBTYPES[item.subtype] || 'Physical Asset'}{item.institution ? ' - ' + item.institution : ''}</small></span>
          <span className={'asset-status ' + (item.active ? 'active' : 'off')}>{item.active ? 'Active' : 'Inactive'}</span>
        </div>
        <div className="asset-card-value">
          <span className="income">{latest ? money(latest.value, latest.cur) : 'No value'}</span>
          {latest && latest.cur !== 'TRY' && <small>₺{grp(latest.tryValue, 0)}</small>}
          <div className="asset-card-actions" onClick={e => e.stopPropagation()}>
            <button className="ah-btn action-modal-btn ok" title="Add value" onClick={() => onValuation(item)}><Icon name="plus" size={13} /></button>
            <button className="ah-btn action-modal-btn danger" title="Delete" onClick={() => onDelete(item)}><Icon name="trash-2" size={13} /></button>
          </div>
        </div>
        <div className="asset-card-foot">
          <span><Icon name="calendar" size={12} />{latest ? latest.date : 'Needs value'}</span>
          <span>{item.include ? 'In net worth' : 'Excluded'}</span>
        </div>
      </div>
    );
  }

  function AssetModal({ initial, mode, onClose, onSave }) {
    const [f, setF] = React.useState({
      name: initial.name || '', subtype: initial.subtype || 'other', cur: initial.cur || 'TRY',
      institution: initial.institution || '', liquidity: initial.liquidity || 'short_term',
      valuationMode: initial.valuationMode || 'manual', ownership: initial.ownership != null ? String(initial.ownership) : '100',
      acquiredAt: initial.acquiredAt || '', acquisitionCost: initial.acquisitionCost != null ? String(initial.acquisitionCost) : '',
      include: initial.include !== false, active: initial.active !== false, desc: initial.desc || '',
    });
    const set = (k, v) => setF(p => ({ ...p, [k]: v }));
    function submit() {
      if (!f.name.trim()) return;
      onSave({
        ...initial, name: f.name.trim(), type: 'physical', subtype: f.subtype, cur: f.cur, institution: f.institution.trim(),
        liquidity: f.liquidity, valuationMode: 'manual', ownership: parseFloat(f.ownership) || 100,
        acquiredAt: f.acquiredAt, acquisitionCost: f.acquisitionCost, include: f.include, active: f.active, desc: f.desc.trim(),
      });
    }
    return (
      <div className="backdrop" onMouseDown={e => { if (e.target.classList.contains('backdrop')) onClose(); }}>
        <div className="modal asset-modal">
          <div className="modal-head">
            <div className="modal-head-l"><span className="modal-title"><Icon name={initial.id ? 'pencil' : 'plus-circle'} size={16} />{initial.id ? 'Edit ' : 'New '}Physical Asset</span><span className="modal-sub">{initial.id ? initial.name : 'Manual record'}</span></div>
            <button className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-field"><span className="field-label">Name<span className="field-required-mark">*</span></span><input className="field-input" value={f.name} onChange={e => set('name', e.target.value)} /></div>
              <div className="form-field"><span className="field-label">Asset Type</span><StyledSelect className="field-input" value={f.subtype} onChange={e => set('subtype', e.target.value)}>{Object.keys(API.PHYSICAL_SUBTYPES).map(k => <option key={k} value={k}>{API.PHYSICAL_SUBTYPES[k]}</option>)}</StyledSelect></div>
            </div>
            <div className="form-grid">
              <div className="form-field"><span className="field-label">Currency</span><StyledSelect className="field-input" value={f.cur} onChange={e => set('cur', e.target.value)}><option>TRY</option><option>USD</option><option>EUR</option></StyledSelect></div>
              <div className="form-field"><span className="field-label">Ownership %</span><input className="field-input" type="number" step="any" value={f.ownership} onChange={e => set('ownership', e.target.value)} /></div>
            </div>
            <div className="form-grid">
              <div className="form-field"><span className="field-label">Location / Custodian</span><input className="field-input" value={f.institution} onChange={e => set('institution', e.target.value)} /></div>
              <div className="form-field"><span className="field-label">Liquidity</span><StyledSelect className="field-input" value={f.liquidity} onChange={e => set('liquidity', e.target.value)}>{Object.keys(API.LIQUIDITY).map(k => <option key={k} value={k}>{API.LIQUIDITY[k]}</option>)}</StyledSelect></div>
            </div>
            <div className="form-grid">
              <div className="form-field"><span className="field-label">Acquired At</span><DateInput className="field-input" value={f.acquiredAt} onChange={e => set('acquiredAt', e.target.value)} /></div>
              <div className="form-field"><span className="field-label">Acquisition Cost</span><CurrencyInput value={f.acquisitionCost} currency={f.cur} onChange={v => set('acquisitionCost', v)} /></div>
            </div>
            <div className="form-field full"><span className="field-label">Note</span><input className="field-input" value={f.desc} onChange={e => set('desc', e.target.value)} /></div>
            <div className="form-grid">
              <label className="acct-check-label"><input type="checkbox" checked={f.include} onChange={e => set('include', e.target.checked)} /><Icon name="scale" size={12} />Include In Net Worth</label>
              <label className="acct-check-label"><input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} /><Icon name="check-circle" size={12} />Active</label>
            </div>
          </div>
          <div className="modal-foot"><button className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button><button className="amb ok" disabled={!f.name.trim()} onClick={submit}><Icon name="save" size={14} />Save</button></div>
        </div>
      </div>
    );
  }

  function ValuationModal({ item, mode, onClose, onSave }) {
    const [value, setValue] = React.useState(item.latest ? String(item.latest.value) : '');
    const [cur, setCur] = React.useState(item.latest ? item.latest.cur : item.cur || 'TRY');
    const [date, setDate] = React.useState(todayIso());
    const [source, setSource] = React.useState('manual');
    const [note, setNote] = React.useState('');
    return (
      <div className="backdrop" onMouseDown={e => { if (e.target.classList.contains('backdrop')) onClose(); }}>
        <div className="modal asset-valuation-modal">
          <div className="modal-head"><div className="modal-head-l"><span className="modal-title"><Icon name="plus-circle" size={16} />Add Valuation</span><span className="modal-sub">{item.name}</span></div><button className="m-close" onClick={onClose}><Icon name="x" size={17} /></button></div>
          <div className="modal-body">
            <div className="form-grid"><div className="form-field"><span className="field-label">Value</span><CurrencyInput value={value} currency={cur} onChange={setValue} /></div><div className="form-field"><span className="field-label">Currency</span><StyledSelect className="field-input" value={cur} onChange={e => setCur(e.target.value)}><option>TRY</option><option>USD</option><option>EUR</option></StyledSelect></div></div>
            <div className="form-grid"><div className="form-field"><span className="field-label">Date</span><DateInput className="field-input" value={date} onChange={e => setDate(e.target.value)} /></div><div className="form-field"><span className="field-label">Source</span><StyledSelect className="field-input" value={source} onChange={e => setSource(e.target.value)}><option value="manual">Manual</option><option value="market_price">Market Price</option><option value="appraisal">Appraisal</option></StyledSelect></div></div>
            <div className="form-field full"><span className="field-label">Note</span><input className="field-input" value={note} onChange={e => setNote(e.target.value)} /></div>
          </div>
          <div className="modal-foot"><button className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button><button className="amb ok" disabled={!parseFloat(value) || !date} onClick={() => onSave({ value, cur, date, source, note })}><Icon name="save" size={14} />Save</button></div>
        </div>
      </div>
    );
  }

  function App() {
    const mode = window.HL_ASSET_PAGE || 'overview';
    const [assets, setAssets] = React.useState([]);
    const [summary, setSummary] = React.useState(null);
    const [search, setSearch] = React.useState('');
    const [subtype, setSubtype] = React.useState('all');
    const [status, setStatus] = React.useState('all');
    const [netWorth, setNetWorth] = React.useState('all');
    const [modal, setModal] = React.useState(null);
    const [valuation, setValuation] = React.useState(null);
    const [flash, setFlash] = React.useState(null);
    const [error, setError] = React.useState('');

    const reload = React.useCallback(() => {
      setError('');
      const load = mode === 'overview' ? Promise.all([API.listAssets(), API.summary()]) : Promise.all([API.listPhysicalAssets(), Promise.resolve(null)]);
      load.then(([a, s]) => { setAssets(a); setSummary(s); })
        .catch(e => setError(e.message || 'Could not load asset data.'));
    }, []);
    React.useEffect(() => { reload(); }, [reload]);
    const rows = assets;
    const filtered = rows.filter(r => {
      const q = search.trim().toLowerCase();
      const matchesSearch = !q || [r.name, r.institution, r.subtype, API.PHYSICAL_SUBTYPES[r.subtype]].filter(Boolean).join(' ').toLowerCase().includes(q);
      return matchesSearch && (subtype === 'all' || r.subtype === subtype) && (status === 'all' || (status === 'active') === r.active) && (netWorth === 'all' || (netWorth === 'included') === r.include);
    });
    async function save(item) {
      const editing = !!item.id;
      const fn = editing ? API.updatePhysicalAsset : API.createPhysicalAsset;
      try {
        const saved = await window.HL_OP_NOTIFY.promise(editing ? fn(item.id, item) : fn(item), { pending: 'Saving...', success: 'Saved.', error: false });
        setModal(null); setFlash(saved.id); setTimeout(() => setFlash(null), 1500); reload();
      } catch (e) { window.HL_OP_NOTIFY.show('Could not save: ' + (e.message || e), { type: 'error', timeout: 4200 }); }
    }
    async function remove(item) {
      if (!confirm('Delete ' + item.name + '?')) return;
      try { await window.HL_OP_NOTIFY.promise(API.removePhysicalAsset(item.id), { pending: 'Deleting...', success: 'Deleted.', error: false }); reload(); }
      catch (e) { window.HL_OP_NOTIFY.show('Could not delete: ' + (e.message || e), { type: 'error', timeout: 4200 }); }
    }
    async function saveValuation(item) {
      try { await window.HL_OP_NOTIFY.promise(API.addPhysicalValuation(valuation.id, item), { pending: 'Saving value...', success: 'Value saved.', error: false }); setValuation(null); reload(); }
      catch (e) { window.HL_OP_NOTIFY.show('Could not save value: ' + (e.message || e), { type: 'error', timeout: 4200 }); }
    }
    return (
      <div className="app">
        <Sidebar active={mode === 'overview' ? 'assets-overview' : 'assets'} />
        <div className="main">
          <Toolbar mode={mode} search={search} setSearch={setSearch} subtype={subtype} setSubtype={setSubtype} status={status} setStatus={setStatus} netWorth={netWorth} setNetWorth={setNetWorth} rows={rows} filtered={filtered} onNew={() => setModal({})} />
          {error && <div className="acct-form-error asset-load-error"><Icon name="alert-triangle" size={14} />{error}</div>}
          {mode === 'overview' ? <Overview summary={summary} assets={assets} /> : (
            <main className="asset-body">
              <div className="card-grid asset-grid card-grid--list asset-list">
                {filtered.map(r => <AssetCard key={r.id} item={r} onEdit={setModal} onValuation={setValuation} onDelete={remove} flash={flash === r.id} />)}
              </div>
              {!filtered.length && <Empty icon="home" text="No physical assets found." />}
            </main>
          )}
        </div>
        {modal && <AssetModal initial={modal} mode={mode} onClose={() => setModal(null)} onSave={save} />}
        {valuation && <ValuationModal item={valuation} mode={mode} onClose={() => setValuation(null)} onSave={saveValuation} />}
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
