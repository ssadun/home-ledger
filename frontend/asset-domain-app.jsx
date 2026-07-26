// asset-domain-app.jsx — Net worth overview and Assets CRUD.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const DateInput = window.DateInput;
  const CurrencyInput = window.CurrencyInput;
  const { Sidebar } = window.HL_NAV;
  const { grp, SYM } = window.LEDGER_FMT;
  const API = window.HL_ASSET_DOMAIN;

  const todayIso = () => new Date().toISOString().slice(0, 10);
  const meta = (map, key) => map[key] || map.other;
  const money = (v, cur = 'TRY', dec = 0) => (SYM[cur] || cur + ' ') + grp(v || 0, dec);

  function Toolbar({ mode, search, setSearch, layout, setLayout, onNew }) {
    const title = mode === 'overview' ? 'Assets Overview' : 'Asset List';
    const subtitle = mode === 'overview' ? 'Net worth, valuation freshness, and linked records' : 'Owned assets and valuation snapshots';
    const canCreate = mode !== 'overview';
    const createLabel = 'New Asset';
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
        </header>
        {canCreate && (
          <div className="filter-wrap">
            <div className="filter-bar asset-filter-bar">
              <div className="filter-field ff-search">
                <span className="filter-label"><Icon name="search" size={11} />Search</span>
                <div className="search-wrap">
                  <Icon name="search" size={13} />
                  <input id="asset-search-input" className="search-input" value={search} placeholder="Name or institution..." onChange={e => setSearch(e.target.value)} />
                  {search && <button id="asset-search-clear-btn" className="search-clear" onClick={() => setSearch('')} title="Clear"><Icon name="x" size={12} /></button>}
                </div>
              </div>
              <div className="filter-field ff-tabs">
                <span className="filter-label"><Icon name="layout-grid" size={11} />View</span>
                <div className="view-toggle">
                  <button id="asset-view-grid-btn" className={'vt-btn' + (layout === 'grid' ? ' active' : '')} onClick={() => setLayout('grid')} title="Grid view"><Icon name="layout-grid" size={14} /></button>
                  <button id="asset-view-list-btn" className={'vt-btn' + (layout === 'list' ? ' active' : '')} onClick={() => setLayout('list')} title="List view"><Icon name="list" size={14} /></button>
                </div>
              </div>
              <div className="filter-field ff-add asset-mobile-add">
                <span className="filter-label"><Icon name="plus" size={11} />Add</span>
                <button id="asset-new-mobile-btn" className="action-modal-btn ok" onClick={onNew}><Icon name="plus" size={14} /><span className="btn-label">{createLabel}</span></button>
              </div>
            </div>
          </div>
        )}
      </React.Fragment>
    );
  }

  function Overview({ summary, assets }) {
    const assetValue = assets.reduce((s, a) => s + (a.latest ? a.latest.tryValue * (a.ownership || 100) / 100 : 0), 0);
    const cards = [
      { label: 'Assets', icon: 'trending-up', cls: 'income', val: money(summary?.assets_try ?? assetValue), sub: (summary?.assets_count ?? assets.length) + ' records' },
      { label: 'Net Worth', icon: 'scale', cls: 'net', val: money(summary?.net_worth_try ?? assetValue), sub: 'Included snapshots' },
      { label: 'Needs Update', icon: 'alert-triangle', cls: (summary?.missing_asset_valuations || 0) ? 'expense' : 'count', val: String(summary?.missing_asset_valuations || 0), sub: 'missing snapshots' },
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
    const snap = item.latest;
    return (
      <div className="asset-mini-row">
        <span className="asset-card-icon" style={{ '--asset-color': m.color }}><Icon name={m.icon} size={14} /></span>
        <span className="asset-mini-main"><b>{item.name}</b><small>{m.label}{item.institution ? ' - ' + item.institution : ''}</small></span>
        <span className="asset-mini-val income">{snap ? money(snap.tryValue, 'TRY') : 'No snapshot'}</span>
      </div>
    );
  }

  function AssetCard({ item, onEdit, onSnapshot, onDelete, flash }) {
    const m = meta(API.ASSET_TYPES, item.type);
    const snap = item.latest;
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onEdit(item);
      }
    };
    return (
      <div id={'asset-card-' + item.id} className={'asset-card' + (flash ? ' row-flash' : '')} role="button" tabIndex="0" onClick={() => onEdit(item)} onKeyDown={onKey}>
        <div className="asset-card-top">
          <span className="asset-card-icon" style={{ '--asset-color': m.color }}><Icon name={m.icon} size={16} /></span>
          <span className="asset-card-main"><b>{item.name}</b><small>{m.label}{item.institution ? ' - ' + item.institution : ''}</small></span>
          <span className={'asset-status ' + (item.active ? 'active' : 'off')}>{item.active ? 'Active' : 'Inactive'}</span>
        </div>
        <div className="asset-card-value">
          <span className="income">{snap ? money(snap.value, snap.cur) : 'No snapshot'}</span>
          {snap && snap.cur !== 'TRY' && <small>₺{grp(snap.tryValue, 0)}</small>}
        </div>
        <div className="asset-card-foot">
          <span><Icon name="calendar" size={12} />{snap ? snap.date : 'Needs value'}</span>
          <span>{item.include ? 'In net worth' : 'Excluded'}</span>
        </div>
        <div className="asset-card-actions" onClick={e => e.stopPropagation()}>
          <button className="ah-btn" title="Add snapshot" onClick={() => onSnapshot(item)}><Icon name="plus" size={13} /></button>
          <button className="ah-btn danger" title="Delete" onClick={() => onDelete(item)}><Icon name="trash-2" size={13} /></button>
        </div>
      </div>
    );
  }

  function AssetModal({ initial, mode, onClose, onSave }) {
    const [f, setF] = React.useState({
      name: initial.name || '', type: initial.type || 'other', cur: initial.cur || 'TRY',
      institution: initial.institution || '', subtype: initial.subtype || '', liquidity: initial.liquidity || 'short_term',
      valuationMode: initial.valuationMode || 'manual', ownership: initial.ownership != null ? String(initial.ownership) : '100',
      acquiredAt: initial.acquiredAt || '', acquisitionCost: initial.acquisitionCost != null ? String(initial.acquisitionCost) : '',
      include: initial.include !== false, active: initial.active !== false, desc: initial.desc || '',
    });
    const set = (k, v) => setF(p => ({ ...p, [k]: v }));
    const types = API.ASSET_TYPES;
    function submit() {
      if (!f.name.trim()) return;
      onSave({
        ...initial, name: f.name.trim(), type: f.type, subtype: f.subtype.trim(), cur: f.cur, institution: f.institution.trim(),
        liquidity: f.liquidity, valuationMode: f.valuationMode, ownership: parseFloat(f.ownership) || 100,
        acquiredAt: f.acquiredAt, acquisitionCost: f.acquisitionCost, include: f.include, active: f.active, desc: f.desc.trim(),
      });
    }
    return (
      <div className="backdrop" onMouseDown={e => { if (e.target.classList.contains('backdrop')) onClose(); }}>
        <div className="modal asset-modal">
          <div className="modal-head">
            <div className="modal-head-l"><span className="modal-title"><Icon name={initial.id ? 'pencil' : 'plus-circle'} size={16} />{initial.id ? 'Edit ' : 'New '}Asset</span><span className="modal-sub">{initial.id ? initial.name : 'Manual record'}</span></div>
            <button className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-field"><span className="field-label">Name<span className="field-required-mark">*</span></span><input className="field-input" value={f.name} onChange={e => set('name', e.target.value)} /></div>
              <div className="form-field"><span className="field-label">Type</span><StyledSelect className="field-input" value={f.type} onChange={e => set('type', e.target.value)}>{Object.keys(types).map(k => <option key={k} value={k}>{types[k].label}</option>)}</StyledSelect></div>
            </div>
            <div className="form-grid">
              <div className="form-field"><span className="field-label">Currency</span><StyledSelect className="field-input" value={f.cur} onChange={e => set('cur', e.target.value)}><option>TRY</option><option>USD</option><option>EUR</option></StyledSelect></div>
              <div className="form-field"><span className="field-label">Ownership %</span><input className="field-input" type="number" step="any" value={f.ownership} onChange={e => set('ownership', e.target.value)} /></div>
            </div>
            <div className="form-grid">
              <div className="form-field"><span className="field-label">Liquidity</span><StyledSelect className="field-input" value={f.liquidity} onChange={e => set('liquidity', e.target.value)}>{Object.keys(API.LIQUIDITY).map(k => <option key={k} value={k}>{API.LIQUIDITY[k]}</option>)}</StyledSelect></div>
              <div className="form-field"><span className="field-label">Valuation Mode</span><StyledSelect className="field-input" value={f.valuationMode} onChange={e => set('valuationMode', e.target.value)}>{Object.keys(API.VALUATION_MODE).map(k => <option key={k} value={k}>{API.VALUATION_MODE[k]}</option>)}</StyledSelect></div>
            </div>
            <div className="form-grid">
              <div className="form-field"><span className="field-label">Institution</span><input className="field-input" value={f.institution} onChange={e => set('institution', e.target.value)} /></div>
              <div className="form-field"><span className="field-label">Subtype</span><input className="field-input" value={f.subtype} onChange={e => set('subtype', e.target.value)} /></div>
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

  function SnapshotModal({ item, mode, onClose, onSave }) {
    const [value, setValue] = React.useState(item.latest ? String(item.latest.value) : '');
    const [cur, setCur] = React.useState(item.latest ? item.latest.cur : item.cur || 'TRY');
    const [date, setDate] = React.useState(todayIso());
    const [source, setSource] = React.useState(item.valuationMode === 'account_balance' ? 'account_balance' : 'manual');
    const [note, setNote] = React.useState('');
    return (
      <div className="backdrop" onMouseDown={e => { if (e.target.classList.contains('backdrop')) onClose(); }}>
        <div className="modal asset-snapshot-modal">
          <div className="modal-head"><div className="modal-head-l"><span className="modal-title"><Icon name="plus-circle" size={16} />Add Valuation</span><span className="modal-sub">{item.name}</span></div><button className="m-close" onClick={onClose}><Icon name="x" size={17} /></button></div>
          <div className="modal-body">
            <div className="form-grid"><div className="form-field"><span className="field-label">Value</span><CurrencyInput value={value} currency={cur} onChange={setValue} /></div><div className="form-field"><span className="field-label">Currency</span><StyledSelect className="field-input" value={cur} onChange={e => setCur(e.target.value)}><option>TRY</option><option>USD</option><option>EUR</option></StyledSelect></div></div>
            <div className="form-grid"><div className="form-field"><span className="field-label">Date</span><DateInput className="field-input" value={date} onChange={e => setDate(e.target.value)} /></div><div className="form-field"><span className="field-label">Source</span><StyledSelect className="field-input" value={source} onChange={e => setSource(e.target.value)}><option value="manual">Manual</option><option value="account_balance">Account Balance</option><option value="holdings">Holdings</option><option value="market_price">Market Price</option><option value="appraisal">Appraisal</option><option value="import">Import</option></StyledSelect></div></div>
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
    const [layout, setLayout] = window.HL_NAV.usePersistentView('list');
    const [modal, setModal] = React.useState(null);
    const [snapshot, setSnapshot] = React.useState(null);
    const [flash, setFlash] = React.useState(null);
    const [error, setError] = React.useState('');

    const reload = React.useCallback(() => {
      setError('');
      Promise.all([API.listAssets(), API.summary()])
        .then(([a, s]) => { setAssets(a); setSummary(s); })
        .catch(e => setError(e.message || 'Could not load asset data.'));
    }, []);
    React.useEffect(() => { reload(); }, [reload]);
    const rows = assets;
    const filtered = rows.filter(r => {
      const q = search.trim().toLowerCase();
      return !q || [r.name, r.institution, r.type].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    async function save(item) {
      const editing = !!item.id;
      const fn = editing ? API.updateAsset : API.createAsset;
      try {
        const saved = await window.HL_OP_NOTIFY.promise(editing ? fn(item.id, item) : fn(item), { pending: 'Saving...', success: 'Saved.', error: false });
        setModal(null); setFlash(saved.id); setTimeout(() => setFlash(null), 1500); reload();
      } catch (e) { window.HL_OP_NOTIFY.show('Could not save: ' + (e.message || e), { type: 'error', timeout: 4200 }); }
    }
    async function remove(item) {
      if (!confirm('Delete ' + item.name + '?')) return;
      try { await window.HL_OP_NOTIFY.promise(API.removeAsset(item.id), { pending: 'Deleting...', success: 'Deleted.', error: false }); reload(); }
      catch (e) { window.HL_OP_NOTIFY.show('Could not delete: ' + (e.message || e), { type: 'error', timeout: 4200 }); }
    }
    async function saveSnapshot(item) {
      try { await window.HL_OP_NOTIFY.promise(API.addValuation(snapshot.id, item), { pending: 'Saving snapshot...', success: 'Snapshot saved.', error: false }); setSnapshot(null); reload(); }
      catch (e) { window.HL_OP_NOTIFY.show('Could not save snapshot: ' + (e.message || e), { type: 'error', timeout: 4200 }); }
    }
    return (
      <div className="app">
        <Sidebar active={mode === 'overview' ? 'assets-overview' : 'assets'} />
        <div className="main">
          <Toolbar mode={mode} search={search} setSearch={setSearch} layout={layout} setLayout={setLayout} onNew={() => setModal({})} />
          {error && <div className="acct-form-error asset-load-error"><Icon name="alert-triangle" size={14} />{error}</div>}
          {mode === 'overview' ? <Overview summary={summary} assets={assets} /> : (
            <main className="asset-body">
              <div className={'card-grid asset-grid' + (layout === 'list' ? ' card-grid--list asset-list' : '')}>
                {filtered.map(r => <AssetCard key={r.id} item={r} onEdit={setModal} onSnapshot={setSnapshot} onDelete={remove} flash={flash === r.id} />)}
              </div>
              {!filtered.length && <Empty icon="wallet" text="No assets found." />}
            </main>
          )}
        </div>
        {modal && <AssetModal initial={modal} mode={mode} onClose={() => setModal(null)} onSave={save} />}
        {snapshot && <SnapshotModal item={snapshot} mode={mode} onClose={() => setSnapshot(null)} onSave={saveSnapshot} />}
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
