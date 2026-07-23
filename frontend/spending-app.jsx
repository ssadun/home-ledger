// spending-app.jsx — Home Ledger Spending page.
(function () {
  const Icon = window.Icon;
  const { CATS, TX, CURRENT_MONTH, CURRENT_YEAR } = window.LEDGER;
  const { FilterBar, SummaryStrip, Pagination, TxModal, DeleteConfirm, TxRow, ScanModal } = window;
  const ExportData = window.ExportData;
  const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakColor, TweakToggle, TweakButton } = window;
  const { useResizableColumns, ColResizer } = window;

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "#4f8ef7",
    "density": "compact",
    "showConverted": true,
    "zebra": true,
    "colorAmounts": true,
    "groupByWeek": true
  }/*EDITMODE-END*/;

  const { Sidebar } = window.HL_NAV;

  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function weekOfMonth(iso) { return Math.ceil(+iso.split('-')[2] / 7); }
  function weekRangeLabel(wk, month, year) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const from = (wk - 1) * 7 + 1;
    const to = Math.min(wk * 7, daysInMonth);
    return MONTH_ABBR[month] + ' ' + from + '\u2013' + to;
  }

  // size = default width; minSize / maxSize = drag constraints (px), enforced by TanStack
  const COLS = [
    { key: 'date', label: 'Date', size: 130, minSize: 96, maxSize: 240 },
    { key: 'desc', label: 'Description', size: 320, minSize: 160, maxSize: 640 },
    { key: 'cat', label: 'Category', size: 175, minSize: 130, maxSize: 320 },
    { key: 'payingFor', label: 'Paying For', size: 150, minSize: 115, maxSize: 280 },
    { key: 'paymentMethod', label: 'Payment Method', noSort: false, size: 185, minSize: 150, maxSize: 320 },
    { key: 'amt', label: 'Amount', num: true, size: 150, minSize: 105, maxSize: 280 },
  ];

  // ── CSV export schema (raw values, resolved labels) ──
  const PM_LABEL = { 'credit-card': 'Credit Card', 'debit-card': 'Debit Card', 'cash': 'Cash' };
  // Resolve a payment-method value to a display label: legacy key → fixed label,
  // otherwise an account id (e.g. "acc-1") → the hydrated account's name.
  function pmLabel(value) {
    if (PM_LABEL[value]) return PM_LABEL[value];
    const accts = (window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.ACCOUNTS) || [];
    const acct = accts.find(a => a.id === value);
    return acct ? acct.name : (value || '');
  }

  // Filter options need enough context to distinguish accounts with the same
  // name. Institutions are stored on accounts by full name, so resolve that
  // value back to the shared short name before composing the label.
  function paymentSourceLabel(value) {
    if (PM_LABEL[value]) return PM_LABEL[value];
    const data = window.ACCOUNTS_DATA || {};
    const acct = (data.ACCOUNTS || []).find(a => a.id === value);
    if (!acct) return value || '';
    const institutions = Object.values(data.FINANCIAL_INSTITUTIONS || {});
    const institution = institutions.find(fi => fi.name === acct.institution || fi.shortName === acct.institution);
    const shortName = institution && institution.shortName;
    return shortName ? shortName + ' - ' + acct.name : acct.name;
  }
  const EXPORT_COLS = [
    { key: 'date', label: 'Date' },
    { key: 'desc', label: 'Description' },
    { key: 'cat', label: 'Category', get: r => (CATS[r.cat] || {}).label || r.cat },
    { key: 'type', label: 'Type' },
    { key: 'payer', label: 'Payer' },
    { key: 'payingFor', label: 'Paying For', get: r => r.payingFor === '\u2013' ? '' : r.payingFor },
    { key: 'paymentMethod', label: 'Payment Method', get: r => pmLabel(r.paymentMethod) },
    { key: 'cur', label: 'Currency' },
    { key: 'amt', label: 'Amount' },
    { key: 'tryV', label: 'Amount (TRY)' },
    { key: 'usdV', label: 'Amount (USD)' },
  ];

  // ── Table body — memoized so rows do NOT re-render during a column drag ──
  const TableBody = React.memo(function TableBody({ rows, colCount, flashId, grouped, month, year, onEdit, order, selectable, selectedSet, onToggleSelect, collapsedWeeks, onToggleWeek }) {
    const selProps = (tx) => ({ selectable, selected: selectable && selectedSet.has(tx.id), onToggleSelect });
    if (rows.length === 0) {
      return (
        <tbody>
          <tr className="empty-row"><td colSpan={colCount}>
            <div className="empty-state">
              <Icon name="receipt-text" size={32} />
              <span className="et">No transactions match</span>
              <span className="es">Try a different month or clear the filters above.</span>
            </div>
          </td></tr>
        </tbody>
      );
    }
    if (!grouped) {
      return (
        <tbody>
          {rows.map(tx => <TxRow key={tx.id} tx={tx} flash={tx.id === flashId} onEdit={onEdit} order={order} {...selProps(tx)} />)}
        </tbody>
      );
    }
    const groups = [];
    let cur = null;
    rows.forEach((tx) => {
      const wk = weekOfMonth(tx.date);
      if (!cur || cur.wk !== wk) { cur = { wk, rows: [] }; groups.push(cur); }
      cur.rows.push(tx);
    });
    const out = [];
    groups.forEach((g, gi) => {
      const collapsed = collapsedWeeks && collapsedWeeks.has(g.wk);
      if (gi > 0) out.push(<tr className="week-spacer" key={'wkspc-' + g.wk}><td colSpan={99}></td></tr>);
      out.push(
        <tr className={'week-group-row' + (collapsed ? ' wk-collapsed' : '')} key={'wk-' + g.wk}
          onClick={() => onToggleWeek && onToggleWeek(g.wk)} title={collapsed ? 'Expand week' : 'Collapse week'}>
          <td colSpan={99}>
            <Icon name="chevron-down" size={12} className="week-group-chevron" />
            <span className="week-group-label">
              <Icon name="calendar-range" size={12} />Week {g.wk}
            </span>
            <span className="week-group-range">{weekRangeLabel(g.wk, month, year)}</span>
            {collapsed && <span className="week-group-count">{g.rows.length} item{g.rows.length !== 1 ? 's' : ''}</span>}
          </td>
        </tr>
      );
      if (!collapsed) g.rows.forEach((tx, ri) => {
        const isLast = ri === g.rows.length - 1;
        out.push(
          <TxRow key={tx.id} tx={tx} flash={tx.id === flashId} onEdit={onEdit} order={order} {...selProps(tx)}
            extraClass={(ri % 2 === 1 ? 'row-alt' : '') + (isLast ? ' week-last' : '')} />
        );
      });
    });
    return <tbody>{out}</tbody>;
  });

  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const [rows, setRows] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState(null);

    // Load transactions + accounts from the backend on mount (replaces the old static
    // TX seed). Accounts hydrate ACCOUNTS_DATA.ACCOUNTS in place so the Payment Method
    // cell can resolve account ids (e.g. "acc-3") to their real names before rows render.
    React.useEffect(() => {
      let alive = true;
      // Category colors/icons/labels live in the DB (edited on the Configuration
      // page). Rehydrate LEDGER.CATS in place so the table reflects the current
      // colors instead of the static data.js seed. Runs before setRows so the
      // first meaningful render already reads the fresh values.
      const loadCats = (window.HL_CATEGORIES_API && window.HL_CATEGORIES_API.hydrateLedgerCats)
        ? window.HL_CATEGORIES_API.hydrateLedgerCats().catch(() => { /* keep static fallback */ })
        : Promise.resolve();
      // Payer / Paying For options come from the users table too — rehydrate
      // LEDGER.PAYERS in place before the Payer/Paying For selects render.
      const loadPayers = (window.HL_MEMBERS_API && window.HL_MEMBERS_API.hydrateLedgerPayers)
        ? window.HL_MEMBERS_API.hydrateLedgerPayers().catch(() => { /* keep static fallback */ })
        : Promise.resolve();
      // Payment Source labels use institution short names, so hydrate that map
      // before accounts and transactions are combined into filter options.
      const loadInstitutions = (window.HL_INSTITUTIONS_API && window.HL_INSTITUTIONS_API.hydrate)
        ? window.HL_INSTITUTIONS_API.hydrate().catch(() => { /* keep static fallback */ })
        : Promise.resolve();
      const loadAccounts = (window.HL_ACCOUNTS_API && window.ACCOUNTS_DATA)
        ? window.HL_ACCOUNTS_API.list()
            .then(accts => {
              const arr = window.ACCOUNTS_DATA.ACCOUNTS;
              arr.length = 0;
              (accts || []).forEach(a => arr.push(a));
            })
            .catch(() => { /* names just fall back to the raw id */ })
        : Promise.resolve();
      Promise.all([loadCats, loadPayers, loadInstitutions, loadAccounts])
        .then(() => window.HL_SPENDING_API.list())
        .then(data => { if (alive) { setRows(data); setLoadError(null); } })
        .catch(err => { if (alive) setLoadError(err.message || 'Failed to load'); })
        .finally(() => { if (alive) setLoading(false); });
      return () => { alive = false; };
    }, []);
    // Deep-link support: ?month=&year=&highlight= (e.g. from Recurring/Subscriptions linked rows)
    const URLP = React.useMemo(() => new URLSearchParams(window.location.search), []);
    const [month, setMonth] = React.useState(() => { const m = URLP.has('month') ? +URLP.get('month') : NaN; return (m >= 0 && m <= 11) ? m : CURRENT_MONTH; });   // default current month (0-indexed)
    const [year, setYear] = React.useState(() => { const y = URLP.has('year') ? +URLP.get('year') : NaN; return (y >= 2000 && y <= 2100) ? y : CURRENT_YEAR; });
    const [type, setType] = React.useState('all');
    const [payer, setPayer] = React.useState('all');
    const [payingFor, setPayingFor] = React.useState('all');
    const [cat, setCat] = React.useState('all');
    const [source, setSource] = React.useState('all');
    const [paymentSource, setPaymentSource] = React.useState('all');
    const [search, setSearch] = React.useState('');
    const [sort, setSort] = React.useState({ col: 'date', dir: 'desc' });
    const [page, setPage] = React.useState(1);
    const [perPage, setPerPage] = React.useState(() => { const v = +localStorage.getItem('hl-rows-per-page'); return [10, 20, 30, 40, 50, 100].includes(v) ? v : 10; });
    React.useEffect(() => { try { localStorage.setItem('hl-rows-per-page', String(perPage)); } catch (e) {} }, [perPage]);
    const [modal, setModal] = React.useState(null);   // {mode, tx, scan}
    const [scan, setScan] = React.useState(false);
    const [del, setDel] = React.useState(null);
    const [flashId, setFlashId] = React.useState(null);
    // Mass-delete: ids of checkbox-selected rows + the batch-confirm dialog toggle.
    const [selected, setSelected] = React.useState(() => new Set());
    const [batchDel, setBatchDel] = React.useState(false);
    const toggleSelect = React.useCallback((id) => setSelected(s => {
      const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
    }), []);
    // Week-group collapse state (Group By Week tweak) — keyed by week-of-month
    // number, so it resets whenever the viewed month changes (else "Week 1"
    // collapsed in June would also start collapsed in July).
    const [collapsedWeeks, setCollapsedWeeks] = React.useState(() => new Set());
    const toggleWeek = React.useCallback((key) => setCollapsedWeeks(s => {
      const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n;
    }), []);
    React.useEffect(() => { setCollapsedWeeks(new Set()); }, [month, year]);

    // Highlight a deep-linked transaction on load (reuses the row-flash used for edits/adds)
    React.useEffect(() => {
      const h = URLP.get('highlight');
      if (!h) return;
      setFlashId(h);
      const id = setTimeout(() => setFlashId(null), 2000);
      return () => clearTimeout(id);
    }, []);

    // apply accent tweak to root
    React.useEffect(() => { window.HL_THEME.accent(t.accent); }, [t.accent]);

    function monthStep(d) {
      let m = month + d, y = year;
      if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
      setMonth(m); setYear(y); setPage(1);
    }

    // ── filter ──
    const filtered = React.useMemo(() => {
      const mm = String(month + 1).padStart(2, '0');
      const prefix = `${year}-${mm}`;
      return rows.filter(r => {
        if (!r.date.startsWith(prefix)) return false;
        if (type !== 'all' && r.type !== type) return false;
        if (payer !== 'all' && r.payer !== payer) return false;
        if (payingFor !== 'all' && r.payingFor !== payingFor) return false;
        if (cat !== 'all' && r.cat !== cat) return false;
        if (paymentSource !== 'all' && r.paymentMethod !== paymentSource) return false;
        if (source !== 'all') {
          if (source === 'recurring' && !r.recurringId) return false;
          if (source === 'manual' && r.recurringId) return false;
          if (source !== 'recurring' && source !== 'manual' && String(r.recurringId) !== String(source)) return false;
        }
        if (search.trim() && !r.desc.toLowerCase().includes(search.trim().toLowerCase())) return false;
        return true;
      });
    }, [rows, month, year, type, payer, payingFor, cat, paymentSource, source, search]);

    // ── sort ──
    const sorted = React.useMemo(() => {
      const arr = [...filtered];
      const { col, dir } = sort;
      arr.sort((a, b) => {
        let av = a[col], bv = b[col];
        if (col === 'cat') { av = CATS[a.cat].label; bv = CATS[b.cat].label; }
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
    // memoized: stable identity keeps the memoized <TableBody> from re-rendering during column drags
    const pageRows = React.useMemo(() => sorted.slice(start, end), [sorted, start, end]);

    React.useEffect(() => { setPage(1); setSelected(new Set()); }, [month, year, type, payer, payingFor, cat, paymentSource, source, search, perPage]);

    function toggleSort(col) {
      if (rz.isResizing || rz.wasResizingRef.current) return;   // don't sort during/after a column drag
      if (COLS.find(c => c.key === col)?.noSort) return;
      setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'desc' ? 'asc' : 'desc' });
    }

    async function saveTx(tx) {
      try {
        if (tx.id) {
          const saved = await window.HL_SPENDING_API.update(tx.id, tx);
          setRows(rs => rs.map(r => r.id === saved.id ? saved : r));
          setFlashId(saved.id);
        } else {
          const saved = await window.HL_SPENDING_API.create(tx);
          setRows(rs => [saved, ...rs]);
          setFlashId(saved.id);
          // jump view to the new tx's month
          const [y, m] = saved.date.split('-'); setYear(+y); setMonth(+m - 1);
        }
        setModal(null);
        setTimeout(() => setFlashId(null), 1500);
      } catch (err) {
        alert('Could not save transaction: ' + (err.message || err));
      }
    }
    async function confirmDelete() {
      const id = del.id;
      try {
        await window.HL_SPENDING_API.remove(id);
        setRows(rs => rs.filter(r => r.id !== id));
        setDel(null);
      } catch (err) {
        alert('Could not delete transaction: ' + (err.message || err));
      }
    }
    // Mass delete — loops the per-row API (no bulk endpoint needed); keeps rows that
    // failed so the user sees exactly what remains, and never silently drops errors.
    async function confirmBatchDelete() {
      const ids = [...selected];
      const results = await Promise.allSettled(ids.map(id => window.HL_SPENDING_API.remove(id)));
      const okIds = new Set(ids.filter((id, i) => results[i].status === 'fulfilled'));
      setRows(rs => rs.filter(r => !okIds.has(r.id)));
      setSelected(s => new Set([...s].filter(id => !okIds.has(id))));
      setBatchDel(false);
      const failed = ids.length - okIds.size;
      if (failed) alert(failed + (failed === 1 ? ' record' : ' records') + ' could not be deleted.');
    }

    const cols = React.useMemo(() => COLS.filter(c => t.showConverted || !c.conv), [t.showConverted]);

    const paymentSourceOptions = React.useMemo(() => {
      const seen = new Set();
      rows.forEach(r => { if (r.paymentMethod) seen.add(r.paymentMethod); });
      return [...seen]
        .map(value => ({ value, label: paymentSourceLabel(value) || value }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
    }, [rows]);

    // ── column resizing (TanStack Table) — widths persist in localStorage ──
    const rz = useResizableColumns({ columns: cols, storageKey: 'hl-spending-colwidths' });
    const onEditTx = React.useCallback((x) => setModal({ mode: 'edit', tx: x }), []);
    // Stable list of keys in the user's column order — drives <colgroup>, <thead>,
    // and each row's cell order. Memoized so resize re-renders don't churn rows.
    const orderKeys = React.useMemo(() => rz.orderedColumns.map(c => c.key), [rz.orderedColumns]);

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
        <Sidebar active="spending" />
        <div className="main">
          <header className="page-head">
            <div className="page-head-top">
              <div className="cfg-detail-head-left">
                <div className="page-title-wrap cfg-detail-title-wrap">
                  <div className="cfg-title-col">
                    <h1 className="page-title">Spending</h1>
                    <p className="page-subtitle">Expenses by category and member</p>
                  </div>
                </div>
              </div>
              <div className="head-actions sp-head-actions">
                <button id="sp-scan-receipt-btn" className="action-modal-btn scan" onClick={() => setScan(true)}><Icon name="scan-line" size={14} />Scan Receipt</button>
                <button id="sp-add-btn" className="action-modal-btn ok ha-overflow" onClick={() => setModal({ mode: 'add', tx: {} })}><Icon name="plus" size={14} />Add Spending</button>
              </div>
            </div>
            <FilterBar
              month={month} year={year} onMonthStep={monthStep}
              type={type} setType={setType} payer={payer} setPayer={setPayer}
              payingFor={payingFor} setPayingFor={setPayingFor}
              cat={cat} setCat={setCat}
              paymentSource={paymentSource} setPaymentSource={setPaymentSource} paymentSourceOptions={paymentSourceOptions}
              source={source} setSource={setSource}
              search={search} setSearch={setSearch}
              onResetCols={rz.resetSizes}
              onResetOrder={rz.resetOrder} orderIsDefault={rz.isDefaultOrder}
              onAdd={() => setModal({ mode: 'add', tx: {} })}
              onScan={() => setScan(true)}
              popActions={<button id="sp-add-fp-btn" className="action-modal-btn ok" onClick={() => setModal({ mode: 'add', tx: {} })}><Icon name="plus" size={14} />Add Spending</button>}
              extra={<ExportData entity="spending" entityLabel="Transactions"
                period={year + '-' + String(month + 1).padStart(2, '0')}
                columns={EXPORT_COLS} rows={sorted} allRows={rows} inline />} />
          </header>

          <div className="table-card">
            {selected.size > 0 && (
              <div className="bulk-bar" id="sp-bulk-bar">
                <button id="sp-bulk-selectall-btn" type="button" className="bulk-count bulk-check" onClick={toggleSelectAll} title={allSelected ? 'Clear all' : 'Select all'} aria-label={allSelected ? 'Clear all' : 'Select all'} aria-pressed={allSelected}><Icon name={allSelected ? 'check-square' : 'minus-square'} size={14} />{selected.size} selected</button>
                <div className="bulk-actions">
                  <button id="sp-bulk-clear-btn" className="list-btn blue" onClick={() => setSelected(new Set())}><Icon name="x" size={12} />Clear</button>
                  <button id="sp-bulk-delete-btn" className="list-btn red" onClick={() => setBatchDel(true)}><Icon name="trash-2" size={12} />Delete Selected</button>
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
                      <input id="sp-select-all" type="checkbox" className="row-select-box" checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleSelectAll} aria-label="Select all rows on this page" />
                    </th>
                    {rz.orderedColumns.map(c => (
                      <th key={c.key} className={(c.num ? 'num ' : '') + (sort.col === c.key && !c.noSort ? 'sorted' : '')}
                          title="Drag To Reorder · Click To Sort"
                          {...rz.getReorderProps(c.key)}
                          onClick={() => toggleSort(c.key)}>
                        <span className="th-inner">
                          <span className="th-label">{c.label}</span>
                          {!c.noSort && <span className="sort-arrow">{sort.col === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>}
                        </span>
                        <ColResizer header={rz.headersById[c.key]} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <TableBody rows={pageRows} colCount={cols.length + 1} flashId={flashId} order={orderKeys}
                  grouped={t.groupByWeek && sort.col === 'date'} month={month} year={year} onEdit={onEditTx}
                  selectable selectedSet={selected} onToggleSelect={toggleSelect}
                  collapsedWeeks={collapsedWeeks} onToggleWeek={toggleWeek} />
              </table>
            </div>
            <Pagination page={curPage} pages={pages} total={total} start={start} end={end}
              perPage={perPage} setPage={setPage} setPerPage={setPerPage} />
          </div>
        </div>

        {modal && <TxModal initial={modal.tx} scan={modal.scan} onClose={() => setModal(null)} onSave={saveTx} onDelete={(tx) => { setModal(null); setDel(tx); }} />}
        {scan && <ScanModal onClose={() => setScan(false)} onScanned={(tx) => { setScan(false); setModal({ mode: 'add', tx, scan: true }); }} />}
        {del && <DeleteConfirm tx={del} onClose={() => setDel(null)} onConfirm={confirmDelete} />}
        {batchDel && <DeleteConfirm count={selected.size} onClose={() => setBatchDel(false)} onConfirm={confirmBatchDelete} />}

        <TweaksPanel title="Tweaks">
          <TweakSection label="Appearance" />
          <TweakColor label="Accent" value={t.accent}
            options={['#4f8ef7', '#8b5cf6', '#22c55e', '#f97316', '#ec4899']}
            onChange={(v) => setTweak('accent', v)} />
          <TweakRadio label="Density" value={t.density}
            options={['compact', 'regular', 'comfy']}
            onChange={(v) => setTweak('density', v)} />
          <TweakSection label="Table" />
          <TweakToggle label="Zebra striping" value={t.zebra}
            onChange={(v) => setTweak('zebra', v)} />
          <TweakToggle label="Color income / expense" value={t.colorAmounts}
            onChange={(v) => setTweak('colorAmounts', v)} />
          <TweakToggle label="Group by week" value={t.groupByWeek}
            onChange={(v) => setTweak('groupByWeek', v)} />
        </TweaksPanel>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
