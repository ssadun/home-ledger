// recurring-app.jsx — Home Ledger Recurring Transactions page.
(function () {
  const Icon = window.Icon;
  const { CATS, PAYERS } = window.LEDGER;
  const { grp, SYM, fmtDate, dowOf } = window.LEDGER_FMT;
  const { Pagination, DeleteConfirm } = window;
  const { StatusBadge, FreqBadge, WeekendBadge, RecRow, HistoryPanel, RecModal } = window;
  const ExportData = window.ExportData;
  const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakColor, TweakToggle } = window;
  const { useResizableColumns, ColResizer } = window;

  const TWEAK_DEFAULTS = {
    accent: '#4f8ef7',
    layout: 'table',
    zebra: true,
    showEnded: true,
    groupByWeek: true,
  };

  const { Sidebar } = window.HL_NAV;

  // ── Week grouping helpers (group "Next Due" by calendar week, Mon–Sun) ──
  const WK_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function mondayOf(iso) {
    const d = new Date(iso + 'T00:00:00');
    const dow = (d.getDay() + 6) % 7; // 0 = Monday
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function fmtMonthDay(d) { return WK_MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  // Stable key per week — the Monday's ISO date.
  function weekKey(iso) {
    const m = mondayOf(iso);
    return m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0') + '-' + String(m.getDate()).padStart(2, '0');
  }
  // Relative heading: This Week / Next Week / In N Weeks / Last Week / N Weeks Ago.
  function weekHeading(iso) {
    const target = mondayOf(iso).getTime();
    const base = mondayOf(new Date().toISOString().slice(0, 10)).getTime();
    const diff = Math.round((target - base) / (7 * 86400000));
    if (diff === 0) return 'This Week';
    if (diff === 1) return 'Next Week';
    if (diff === -1) return 'Last Week';
    if (diff > 1) return 'In ' + diff + ' Weeks';
    return Math.abs(diff) + ' Weeks Ago';
  }
  // Date span for the week, e.g. "Jun 22 – 28" or "Jun 29 – Jul 5".
  function weekRange(iso) {
    const mon = mondayOf(iso);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const right = mon.getMonth() === sun.getMonth() ? String(sun.getDate()) : fmtMonthDay(sun);
    return fmtMonthDay(mon) + ' \u2013 ' + right;
  }

  // ── Table columns ─────────────────────────────────────────────────────
  // size = default width; minSize / maxSize = drag constraints (px), enforced by TanStack
  const COLS = [
    { key: 'name', label: 'NAME', size: 240, minSize: 150, maxSize: 420 },
    { key: 'status', label: 'STATUS', size: 110, minSize: 90, maxSize: 200 },
    { key: 'frequency', label: 'FREQUENCY', size: 140, minSize: 130, maxSize: 240 },
    { key: 'weekendRule', label: 'WEEKEND RULE', size: 130, minSize: 100, maxSize: 220 },
    { key: 'payer', label: 'PAYER', size: 120, minSize: 90, maxSize: 220 },
    { key: 'nextDue', label: 'NEXT DUE', size: 130, minSize: 100, maxSize: 220 },
    { key: 'amount', label: 'AMOUNT', num: true, size: 120, minSize: 90, maxSize: 220 },
  ];

  // ── CSV export schema ──
  const EXPORT_COLS = [
    { key: 'name', label: 'Name' },
    { key: 'desc', label: 'Description' },
    { key: 'cat', label: 'Category', get: r => (CATS[r.cat] || {}).label || r.cat },
    { key: 'status', label: 'Status' },
    { key: 'frequency', label: 'Frequency' },
    { key: 'paymentDay', label: 'Payment Day' },
    { key: 'weekendRule', label: 'Weekend Rule' },
    { key: 'payer', label: 'Payer' },
    { key: 'nextDue', label: 'Next Due' },
    { key: 'cur', label: 'Currency' },
    { key: 'amount', label: 'Amount' },
    { key: 'tryAmount', label: 'Amount (TRY)' },
  ];

  // ── Card view item ────────────────────────────────────────────────────
  function RecCard({ rec, onEdit, onHistory }) {
    const c = CATS[rec.cat] || CATS.subscriptions;
    return (
      <div className="rec-card" onClick={() => onEdit(rec)}>
        <div className="rc-top">
          <span className="cat-ico cat-chip" style={{ '--cat': c.color }}>
            <Icon name={c.icon} size={15} />
          </span>
          <div className="rc-info">
            <span className="rc-name">{rec.name}</span>
            <span className="rc-desc">{rec.desc}</span>
          </div>
          <div className="rc-amount">
            <span className="amount-val expense"><span className="sign">−</span><span className="cur-sym">{SYM[rec.cur]}</span>{grp(rec.amount)}</span>
          </div>
        </div>
        <div className="rc-bottom">
          <StatusBadge status={rec.status} />
          <FreqBadge frequency={rec.frequency} paymentDay={rec.paymentDay} />
          <WeekendBadge rule={rec.weekendRule} />
          {rec.nextDue && <span className="rc-due"><Icon name="calendar" size={10} />{fmtDate(rec.nextDue)}</span>}
          <button className="rc-history-btn" onClick={e => { e.stopPropagation(); onHistory(rec); }} title="Payment history">
            <Icon name="history" size={12} />
          </button>
        </div>
      </div>
    );
  }

  // ── Grouped cards view ────────────────────────────────────────────────
  function GroupedCards({ items, onEdit, onHistory }) {
    const groups = [
      { key: 'active', label: 'Active', icon: 'circle-check', items: items.filter(r => r.status === 'active') },
      { key: 'paused', label: 'Paused', icon: 'pause-circle', items: items.filter(r => r.status === 'paused') },
      { key: 'ended', label: 'Ended', icon: 'circle-x', items: items.filter(r => r.status === 'ended') },
    ];
    return (
      <div className="rec-grouped">
        {groups.map(g => g.items.length > 0 && (
          <div key={g.key} className="rec-group">
            <div className="rec-group-head">
              <Icon name={g.icon} size={14} />
              <span>{g.label}</span>
              <span className="rec-group-count">{g.items.length}</span>
            </div>
            <div className="rec-group-cards">
              {g.items.map(r => <RecCard key={r.id} rec={r} onEdit={onEdit} onHistory={onHistory} />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Timeline view ─────────────────────────────────────────────────────
  function TimelineView({ items, onEdit, onHistory }) {
    // Sort by nextDue, nulls last
    const sorted = [...items].sort((a, b) => {
      if (!a.nextDue && !b.nextDue) return 0;
      if (!a.nextDue) return 1;
      if (!b.nextDue) return -1;
      return a.nextDue.localeCompare(b.nextDue);
    });
    return (
      <div className="rec-timeline">
        {sorted.map(rec => {
          const c = CATS[rec.cat] || CATS.subscriptions;
          return (
            <div key={rec.id} className={'rec-tl-item tl-' + rec.status} onClick={() => onEdit(rec)}>
              <div className="tl-dot-col">
                <span className={'tl-dot tl-dot-' + rec.status}></span>
                <span className="tl-line"></span>
              </div>
              <div className="tl-content">
                <div className="tl-head">
                  <span className="tl-due">{rec.nextDue ? fmtDate(rec.nextDue) + ' ' + dowOf(rec.nextDue) : 'No next date'}</span>
                  <StatusBadge status={rec.status} />
                </div>
                <div className="tl-body">
                  <span className="cat-ico cat-chip" style={{ '--cat': c.color }}>
                    <Icon name={c.icon} size={13} />
                  </span>
                  <div className="tl-info">
                    <span className="tl-name">{rec.name}</span>
                    <span className="tl-desc">{rec.desc}</span>
                  </div>
                  <div className="tl-amount">
                    <span className="amount-val expense"><span className="sign">−</span><span className="cur-sym">{SYM[rec.cur]}</span>{grp(rec.amount)}</span>
                  </div>
                </div>
                <div className="tl-meta">
                  <FreqBadge frequency={rec.frequency} paymentDay={rec.paymentDay} />
                  <WeekendBadge rule={rec.weekendRule} />
                  <button className="rc-history-btn" onClick={e => { e.stopPropagation(); onHistory(rec); }} title="Payment history">
                    <Icon name="history" size={12} />History
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Filter bar (simpler than Transactions) ────────────────────────────
  function RecFilterBar({ status, setStatus, cat, setCat, search, setSearch, payer, setPayer, frequency, setFrequency, onResetCols, onResetOrder, orderIsDefault, exportEl }) {
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
    const freqLabel = (v) => ({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[v] || v);

    const active = [
      status !== 'all' && { key: 'status', label: 'Status', val: cap(status), clear: () => setStatus('all') },
      cat !== 'all' && { key: 'cat', label: 'Category', val: (CATS[cat] || {}).label || cat, clear: () => setCat('all') },
      payer !== 'all' && { key: 'payer', label: 'Payer', val: payer, clear: () => setPayer('all') },
      frequency !== 'all' && { key: 'frequency', label: 'Frequency', val: freqLabel(frequency), clear: () => setFrequency('all') },
    ].filter(Boolean);
    const clearAll = () => { setStatus('all'); setCat('all'); setPayer('all'); setFrequency('all'); };

    function RecSelect({ label, icon, value, onChange, children }) {
      return (
        <div className="filter-field">
          <span className="filter-label">{icon && <Icon name={icon} size={11} />}{label}</span>
          <div className="select-wrap">
            <select className="sel" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
            <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </div>
        </div>
      );
    }

    return (
      <div className="filter-wrap">
        <div className="filter-bar">
          <div className="filter-field ff-search">
            <span className="filter-label"><Icon name="search" size={11} />Search</span>
            <div className="search-wrap">
              <Icon name="search" size={13} />
              <input className="search-input" placeholder="Name…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {exportEl}

          <div className="filter-field ff-filters">
            <span className="filter-label"><Icon name="sliders-horizontal" size={11} />Filters</span>
            <div className="filters-anchor" ref={anchorRef}>
              <button className={'filters-btn' + (active.length ? ' has' : '') + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
                <Icon name="sliders-horizontal" size={14} /><span className="filters-text">Filters</span>
                {active.length > 0 && <span className="filters-count">{active.length}</span>}
                <svg className="filters-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {open && (
                <div className="filters-pop">
                  <div className="filters-pop-head">
                    <span>Filter By Column</span>
                    {active.length > 0 && <button className="fp-clear" onClick={clearAll}><Icon name="x" size={12} />Clear All</button>}
                  </div>
                  <RecSelect label="Status" icon="circle-check" value={status} onChange={setStatus}>
                    <option value="all">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="ended">Ended</option>
                  </RecSelect>
                  <RecSelect label="Category" icon="tag" value={cat} onChange={setCat}>
                    <option value="all">All Categories</option>
                    {Object.keys(CATS).filter(k => CATS[k].kind === 'expense').map(k => <option key={k} value={k}>{CATS[k].label}</option>)}
                  </RecSelect>
                  <RecSelect label="Payer" icon="user" value={payer} onChange={setPayer}>
                    <option value="all">All Payers</option>
                    {PAYERS.map(p => <option key={p} value={p}>{p}</option>)}
                  </RecSelect>
                  <RecSelect label="Frequency" icon="calendar-clock" value={frequency} onChange={setFrequency}>
                    <option value="all">All Frequencies</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </RecSelect>
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
              <button key={a.key} className="chip" onClick={a.clear} title={'Clear ' + a.label + ' filter'}>
                <span className="chip-k">{a.label}:</span><span className="chip-v">{a.val}</span><Icon name="x" size={11} />
              </button>
            ))}
            <button className="chip chip-clear" onClick={clearAll}>Clear All</button>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // Main App
  // ══════════════════════════════════════════════════════════════════════
  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const [items, setItems] = React.useState([]);

    // Load recurring bills from the backend on mount (replaces the static seed).
    React.useEffect(() => {
      if (!window.HL_RECURRING_API) return;
      let alive = true;
      window.HL_RECURRING_API.list()
        .then(data => { if (alive) setItems(data); })
        .catch(() => {});
      return () => { alive = false; };
    }, []);

    const [status, setStatus] = React.useState('all');
    const [cat, setCat] = React.useState('all');
    const [search, setSearch] = React.useState('');
    const [payer, setPayer] = React.useState('all');
    const [frequency, setFrequency] = React.useState('all');
    const [sort, setSort] = React.useState({ col: 'nextDue', dir: 'asc' });
    const [page, setPage] = React.useState(1);
    const [perPage, setPerPage] = React.useState(() => { const v = +localStorage.getItem('hl-rows-per-page'); return [10, 20, 30, 40, 50, 100].includes(v) ? v : 10; });
    React.useEffect(() => { try { localStorage.setItem('hl-rows-per-page', String(perPage)); } catch (e) {} }, [perPage]);
    const [modal, setModal] = React.useState(null);
    const [historyRec, setHistoryRec] = React.useState(null);
    const [del, setDel] = React.useState(null);
    const [flashId, setFlashId] = React.useState(null);
    const rz = useResizableColumns({ columns: COLS, storageKey: 'hl-recurring-colwidths' });
    const orderKeys = React.useMemo(() => rz.orderedColumns.map(c => c.key), [rz.orderedColumns]);

    React.useEffect(() => { document.documentElement.style.setProperty('--accent', t.accent); }, [t.accent]);

    // ── Filter ──
    const filtered = React.useMemo(() => {
      return items.filter(r => {
        if (status !== 'all' && r.status !== status) return false;
        if (!t.showEnded && r.status === 'ended') return false;
        if (cat !== 'all' && r.cat !== cat) return false;
        if (payer !== 'all' && r.payer !== payer) return false;
        if (frequency !== 'all' && r.frequency !== frequency) return false;
        if (search.trim() && !r.name.toLowerCase().includes(search.trim().toLowerCase()) && !r.desc.toLowerCase().includes(search.trim().toLowerCase())) return false;
        return true;
      });
    }, [items, status, cat, search, payer, frequency, t.showEnded]);

    // ── Sort ──
    const sorted = React.useMemo(() => {
      const arr = [...filtered];
      const { col, dir } = sort;
      arr.sort((a, b) => {
        let av, bv;
        if (col === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
        else if (col === 'status') { av = a.status; bv = b.status; }
        else if (col === 'frequency') { av = a.frequency; bv = b.frequency; }
        else if (col === 'weekendRule') { av = a.weekendRule; bv = b.weekendRule; }
        else if (col === 'payer') { av = a.payer; bv = b.payer; }
        else if (col === 'nextDue') { av = a.nextDue || 'z'; bv = b.nextDue || 'z'; }
        else if (col === 'amount') { av = a.tryAmount; bv = b.tryAmount; }
        else { av = a[col]; bv = b[col]; }
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

    React.useEffect(() => { setPage(1); }, [status, cat, search, payer, frequency, perPage]);

    function toggleSort(col) {
      if (rz.isResizing || rz.wasResizingRef.current) return;   // don't sort during/after a column drag
      setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
    }

    async function saveRec(rec) {
      try {
        const exists = rec.id && items.find(r => r.id === rec.id);
        const saved = exists
          ? await window.HL_RECURRING_API.update(rec.id, rec)
          : await window.HL_RECURRING_API.create(rec);
        setItems(rs => exists ? rs.map(r => r.id === saved.id ? saved : r) : [saved, ...rs]);
        setFlashId(saved.id);
        setModal(null);
        setTimeout(() => setFlashId(null), 1500);
      } catch (err) {
        alert('Could not save recurring item: ' + (err.message || err));
      }
    }
    async function confirmDelete() {
      const id = del.id;
      try {
        await window.HL_RECURRING_API.remove(id);
        setItems(rs => rs.filter(r => r.id !== id));
        setDel(null);
      } catch (err) {
        alert('Could not delete recurring item: ' + (err.message || err));
      }
    }

    return (
      <div className="app">
        <Sidebar active="recurring" />
        <div className="main">
          <header className="page-head">
            <div className="page-head-top">
              <div className="cfg-detail-head-left">
                <div className="page-title-wrap cfg-detail-title-wrap">
                  <span className="cfg-title-icon" id="page-header-icon" style={{ color: '#d946ef' }}><Icon name="repeat" size={21} /></span>
                  <div className="cfg-title-col">
                    <h1 className="page-title">Recurring</h1>
                    <p className="page-subtitle">Scheduled repeating transactions</p>
                  </div>
                </div>
              </div>
              <div className="head-actions">
                <button className="action-modal-btn ok" onClick={() => setModal({ mode: 'add', rec: {} })}><Icon name="plus" size={14} />Add Recurring</button>
              </div>
            </div>
            <RecFilterBar status={status} setStatus={setStatus} cat={cat} setCat={setCat} search={search} setSearch={setSearch} payer={payer} setPayer={setPayer} frequency={frequency} setFrequency={setFrequency} onResetCols={rz.resetSizes} onResetOrder={rz.resetOrder} orderIsDefault={rz.isDefaultOrder}
              exportEl={<ExportData entity="recurring" entityLabel="Recurring Items"
                columns={EXPORT_COLS} rows={sorted} allRows={items} inline />} />
          </header>

          {/* Layout: table */}
          {t.layout === 'table' && (
            <div className="table-card">
              <div className="table-scroll">
                <table ref={rz.tableRef} className={'ledger-table rec-table resizable' + (t.zebra ? ' zebra' : '') + (t.groupByWeek && sort.col === 'nextDue' ? ' week-cards' : '')} style={rz.colSizeVars}>
                  <colgroup>
                    {rz.orderedColumns.map(c => <col key={c.key} style={{ width: 'var(--rz-' + c.key + ')' }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      {rz.orderedColumns.map(c => (
                        <th key={c.key} className={(c.num ? 'num ' : '') + (sort.col === c.key ? 'sorted' : '')} title="Drag To Reorder · Click To Sort" {...rz.getReorderProps(c.key)} onClick={() => toggleSort(c.key)}>
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
                    {pageRows.length === 0 ? (
                      <tr className="empty-row"><td colSpan={COLS.length}>
                        <div className="empty-state">
                          <Icon name="repeat" size={32} />
                          <span className="et">No recurring items match</span>
                          <span className="es">Try a different filter or add a new recurring expense.</span>
                        </div>
                      </td></tr>
                    ) : (!t.groupByWeek || sort.col !== 'nextDue') ? (
                      pageRows.map(rec => (
                        <RecRow key={rec.id} rec={rec} flash={rec.id === flashId} order={orderKeys}
                          onEdit={r => setModal({ mode: 'edit', rec: r })}
                          onHistory={r => setHistoryRec(r)} />
                      ))
                    ) : (() => {
                      const groups = [];
                      let cur = null;
                      pageRows.forEach(rec => {
                        const key = rec.nextDue ? weekKey(rec.nextDue) : 'none';
                        if (!cur || cur.key !== key) { cur = { key, due: rec.nextDue, rows: [] }; groups.push(cur); }
                        cur.rows.push(rec);
                      });
                      const out = [];
                      groups.forEach((g, gi) => {
                        if (gi > 0) out.push(<tr className="week-spacer" key={'wkspc-' + g.key}><td colSpan={99}></td></tr>);
                        out.push(
                          <tr className="week-group-row" key={'wk-' + g.key}>
                            <td colSpan={99}>
                              {g.key === 'none' ? (
                                <span className="week-group-label"><Icon name="calendar-off" size={12} />No Upcoming Date</span>
                              ) : (
                                <React.Fragment>
                                  <span className="week-group-label"><Icon name="calendar-range" size={12} />{weekHeading(g.due)}</span>
                                  <span className="week-group-range">{weekRange(g.due)}</span>
                                </React.Fragment>
                              )}
                            </td>
                          </tr>
                        );
                        g.rows.forEach((rec, ri) => {
                          const isLast = ri === g.rows.length - 1;
                          out.push(
                            <RecRow key={rec.id} rec={rec} flash={rec.id === flashId} order={orderKeys}
                              onEdit={r => setModal({ mode: 'edit', rec: r })}
                              onHistory={r => setHistoryRec(r)}
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
          )}

          {/* Layout: cards */}
          {t.layout === 'cards' && (
            <div className="rec-cards-wrap">
              <GroupedCards items={sorted} onEdit={r => setModal({ mode: 'edit', rec: r })} onHistory={r => setHistoryRec(r)} />
            </div>
          )}

          {/* Layout: timeline */}
          {t.layout === 'timeline' && (
            <div className="rec-timeline-wrap">
              <TimelineView items={sorted} onEdit={r => setModal({ mode: 'edit', rec: r })} onHistory={r => setHistoryRec(r)} />
            </div>
          )}
        </div>

        {modal && <RecModal initial={modal.rec} onClose={() => setModal(null)} onSave={saveRec} onDelete={rec => { setModal(null); setDel(rec); }} />}
        {historyRec && <HistoryPanel rec={historyRec} onClose={() => setHistoryRec(null)} />}
        {del && <DeleteConfirm tx={del} onClose={() => setDel(null)} onConfirm={confirmDelete} />}

        <TweaksPanel title="Tweaks">
          <TweakSection label="Layout" />
          <TweakRadio label="View" value={t.layout}
            options={['table', 'cards', 'timeline']}
            onChange={v => setTweak('layout', v)} />
          <TweakSection label="Appearance" />
          <TweakColor label="Accent" value={t.accent}
            options={['#4f8ef7', '#8b5cf6', '#22c55e', '#f97316', '#d946ef']}
            onChange={v => setTweak('accent', v)} />
          <TweakToggle label="Zebra Striping" value={t.zebra}
            onChange={v => setTweak('zebra', v)} />
          <TweakToggle label="Group By Week" value={t.groupByWeek}
            onChange={v => setTweak('groupByWeek', v)} />
          <TweakToggle label="Show Ended Items" value={t.showEnded}
            onChange={v => setTweak('showEnded', v)} />
        </TweaksPanel>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
