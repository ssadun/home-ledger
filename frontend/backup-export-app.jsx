// backup-export-app.jsx — Home Ledger "Backup & Export" configuration sub-page.
// ─────────────────────────────────────────────────────────────────────────────
// A system-wide export hub living in the Configuration submenu. Lets the user:
//   • tick which tables to include (per-table checkboxes + Select All)
//   • scope the transaction tables to All Time / a Year / a Date Range
//   • download one CSV per selected table, OR a single JSON backup snapshot
// Reuses window.HL_EXPORT (CSV helper) + the shared dark-theme component classes.
(function () {
  const Icon = window.Icon;
  const { Sidebar } = window.HL_NAV;
  const L = window.LEDGER || {};
  const A = window.ACCOUNTS_DATA || {};
  const ACCT_TX_DATA = window.ACCT_TX_DATA || {};
  const RECURRING_DATA = window.RECURRING_DATA || {};
  const BUDGETS_DATA = window.BUDGETS_DATA || {};
  const CATS = L.CATS || {};

  const TWEAK_DEFAULTS = { accent: '#4f8ef7', includeManifest: true, tableLayout: 'list' };

  // ── DateInput — flatpickr wrapper, dark theme, .date-input-wrap shell ────────
  // Project rule: every date field renders through this shared shell (never a raw
  // <input type="date">) so calendar styling stays identical across pages.

  // Swaps flatpickr's year spinner for a dropdown (month dropdown is built-in).
  // Idempotent + shared via window so it's defined once across script bundles.
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

  function DateInput({ value, onChange, min, max, className, placeholder, dataTable, dataCol, id }) {
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
        dateFormat: 'Y-m-d', defaultDate: value || null, minDate: min || null, maxDate: max || null,
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
        <input id={id} ref={inputRef} type="text" className={className || 'field-input'}
          placeholder={placeholder || 'YYYY-MM-DD'} data-table={dataTable} data-col={dataCol} readOnly />
        <span className="date-input-icon"><Icon name="calendar" size={14} /></span>
      </div>
    );
  }

  // ── Shared column resolvers (match each screen's per-page CSV schema 1:1) ────
  const PM_LABEL = { 'credit-card': 'Credit Card', 'debit-card': 'Debit Card', 'cash': 'Cash' };
  const catLabel = (c) => (CATS[c] || {}).label || c;
  const ACCOUNTS = A.ACCOUNTS || [];
  const acctName = (id) => (ACCOUNTS.find(a => a.id === id) || {}).name || id;
  const ACCOUNT_TYPES = A.ACCOUNT_TYPES || {};
  const ACCT_TX_TYPES = ACCT_TX_DATA.ACCT_TX_TYPES || {};

  // ── Dataset source builders ──────────────────────────────────────────────────
  function membersRows() {
    return (L.PAYERS || []).map((name, i) => ({
      name, username: String(name).toLowerCase(), role: i === 0 ? 'admin' : 'user', active: true,
    }));
  }
  function categoriesRows() {
    return Object.entries(CATS).map(([key, v]) => ({ key, label: v.label, kind: v.kind, icon: v.icon, color: v.color }));
  }
  function currenciesRows() {
    return Object.entries(L.FX || {}).map(([code, v]) => ({ code, toTRY: v.toTRY, toUSD: +Number(v.toUSD).toFixed(4) }));
  }
  function typeRows(map) {
    return Object.entries(map || {}).map(([key, v]) => ({ key, label: v.label, color: v.color }));
  }
  function budgetRows() {
    return Object.entries(BUDGETS_DATA.BUDGETS || {}).map(([cat, v]) => ({ cat, limit: v.limit, start: v.start, end: v.end }));
  }

  // ── Dataset registry ──────────────────────────────────────────────────────────
  // dateKey set → period-aware (filtered by Year / Date Range). null → always full.
  const DATASETS = [
    {
      id: 'spending', label: 'Spending Transactions', icon: 'shopping-bag', color: '#22c55e',
      group: 'Transactions', desc: 'Day-to-day income & expense ledger entries', dateKey: 'date',
      getRows: () => L.TX || [],
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'desc', label: 'Description' },
        { key: 'cat', label: 'Category', get: r => catLabel(r.cat) },
        { key: 'type', label: 'Type' },
        { key: 'payer', label: 'Payer' },
        { key: 'payingFor', label: 'Paying For', get: r => r.payingFor === '\u2013' ? '' : r.payingFor },
        { key: 'paymentMethod', label: 'Payment Method', get: r => PM_LABEL[r.paymentMethod] || r.paymentMethod || '' },
        { key: 'cur', label: 'Currency' },
        { key: 'amt', label: 'Amount' },
        { key: 'tryV', label: 'Amount (TRY)' },
        { key: 'usdV', label: 'Amount (USD)' },
      ],
    },
    {
      id: 'account-activity', label: 'Account Activity', icon: 'landmark', color: '#4f8ef7',
      group: 'Transactions', desc: 'Bank- & card-sourced statement records', dateKey: 'date',
      getRows: () => ACCT_TX_DATA.ACCT_TX || [],
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'accountId', label: 'Account', get: t => acctName(t.accountId) },
        { key: 'txType', label: 'Type', get: t => (ACCT_TX_TYPES[t.txType] || {}).label || t.txType },
        { key: 'direction', label: 'Direction', get: t => t.direction === 'incoming' ? 'In' : 'Out' },
        { key: 'desc', label: 'Description' },
        { key: 'cur', label: 'Currency' },
        { key: 'amt', label: 'Amount' },
        { key: 'tryV', label: 'Amount (TRY)' },
      ],
    },
    {
      id: 'recurring', label: 'Recurring & Subscriptions', icon: 'repeat', color: '#d946ef',
      group: 'Transactions', desc: 'Scheduled bills, services and renewals', dateKey: null,
      getRows: () => RECURRING_DATA.RECURRING || [],
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'desc', label: 'Description' },
        { key: 'cat', label: 'Category', get: r => catLabel(r.cat) },
        { key: 'status', label: 'Status' },
        { key: 'frequency', label: 'Frequency' },
        { key: 'paymentDay', label: 'Payment Day' },
        { key: 'weekendRule', label: 'Weekend Rule' },
        { key: 'payer', label: 'Payer' },
        { key: 'nextDue', label: 'Next Due' },
        { key: 'cur', label: 'Currency' },
        { key: 'amount', label: 'Amount' },
        { key: 'tryAmount', label: 'Amount (TRY)' },
      ],
    },
    {
      id: 'accounts', label: 'Accounts', icon: 'wallet', color: '#8b5cf6',
      group: 'Accounts & Budgets', desc: 'Banks, cards, wallets, cash & investments', dateKey: null,
      getRows: () => ACCOUNTS,
      columns: [
        { key: 'name', label: 'Account Name' },
        { key: 'owner', label: 'Owner' },
        { key: 'type', label: 'Type', get: a => (ACCOUNT_TYPES[a.type] || {}).label || a.type },
        { key: 'institution', label: 'Institution' },
        { key: 'number', label: 'Account Number' },
        { key: 'cur', label: 'Currency' },
        { key: 'balance', label: 'Balance' },
        { key: 'limit', label: 'Credit/Overdraft Limit', get: a => a.limit != null ? a.limit : '' },
        { key: 'iban', label: 'IBAN', get: a => a.iban || '' },
      ],
    },
    {
      id: 'budgets', label: 'Budgets', icon: 'target', color: '#eab308',
      group: 'Accounts & Budgets', desc: 'Monthly spending limits per category', dateKey: null,
      getRows: budgetRows,
      columns: [
        { key: 'cat', label: 'Category', get: r => catLabel(r.cat) },
        { key: 'limit', label: 'Monthly Limit (TRY)' },
        { key: 'start', label: 'Period Start' },
        { key: 'end', label: 'Period End', get: r => r.end || '' },
      ],
    },
    {
      id: 'members', label: 'Members', icon: 'users', color: '#22c55e',
      group: 'Configuration', desc: 'Users and their access roles', dateKey: null,
      getRows: membersRows,
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'username', label: 'Username' },
        { key: 'role', label: 'Role', get: r => r.role === 'admin' ? 'Admin' : 'User' },
        { key: 'active', label: 'Status', get: r => r.active !== false ? 'Active' : 'Inactive' },
      ],
    },
    {
      id: 'categories', label: 'Transaction Categories', icon: 'tag', color: '#8b5cf6',
      group: 'Configuration', desc: 'Income & expense classification', dateKey: null,
      getRows: categoriesRows,
      columns: [
        { key: 'label', label: 'Label' },
        { key: 'key', label: 'Key' },
        { key: 'kind', label: 'Kind' },
        { key: 'icon', label: 'Icon' },
        { key: 'color', label: 'Color' },
      ],
    },
    {
      id: 'currencies', label: 'Currencies', icon: 'circle-dollar-sign', color: '#fbbf24',
      group: 'Configuration', desc: 'Currencies and FX rates vs TRY', dateKey: null,
      getRows: currenciesRows,
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'toTRY', label: 'Rate \u2192 TRY' },
        { key: 'toUSD', label: 'Rate \u2192 USD' },
      ],
    },
    {
      id: 'cc-types', label: 'Credit Card Types', icon: 'credit-card', color: '#f97316',
      group: 'Configuration', desc: 'Card networks for credit cards', dateKey: null,
      getRows: () => typeRows(A.CC_TYPES),
      columns: [{ key: 'key', label: 'Key' }, { key: 'label', label: 'Label' }],
    },
    {
      id: 'debit-types', label: 'Debit Card Types', icon: 'wallet-cards', color: '#38bdf8',
      group: 'Configuration', desc: 'Card networks for debit cards', dateKey: null,
      getRows: () => typeRows(A.DEBIT_TYPES),
      columns: [{ key: 'key', label: 'Key' }, { key: 'label', label: 'Label' }],
    },
    {
      id: 'account-types', label: 'Account Types', icon: 'landmark', color: '#4f8ef7',
      group: 'Configuration', desc: 'Financial account types', dateKey: null,
      getRows: () => typeRows(A.ACCOUNT_TYPES),
      columns: [{ key: 'key', label: 'Key' }, { key: 'label', label: 'Label' }, { key: 'color', label: 'Color' }],
    },
  ];

  const GROUPS = ['Transactions', 'Accounts & Budgets', 'Configuration'];
  const PERIOD_AWARE_IDS = DATASETS.filter(d => d.dateKey).map(d => d.id);

  // Years present across the period-aware datasets (for the Year picker).
  // Computed lazily (called from inside App after pre-mount hydration) so it
  // reflects the real transaction rows, not the empty placeholders.
  function computeAvailableYears() {
    const set = new Set();
    DATASETS.filter(d => d.dateKey).forEach(d => (d.getRows() || []).forEach(r => {
      const v = r[d.dateKey]; if (v) set.add(String(v).slice(0, 4));
    }));
    const arr = [...set].sort().reverse();
    return arr.length ? arr : [String((L.CURRENT_YEAR) || new Date().getFullYear())];
  }

  // ── Period helpers ─────────────────────────────────────────────────────────
  function inPeriod(row, ds, period) {
    if (!ds.dateKey || period.mode === 'all') return true;
    const d = row[ds.dateKey];
    if (!d) return true;
    if (period.mode === 'year') return String(d).slice(0, 4) === String(period.year);
    if (period.mode === 'range') {
      if (period.from && d < period.from) return false;
      if (period.to && d > period.to) return false;
      return true;
    }
    return true;
  }
  function filteredRows(ds, period) {
    const all = ds.getRows() || [];
    if (!ds.dateKey || period.mode === 'all') return all;
    return all.filter(r => inPeriod(r, ds, period));
  }
  function periodSuffix(period) {
    if (period.mode === 'year') return '-' + period.year;
    if (period.mode === 'range') {
      const f = period.from || 'start', t = period.to || 'now';
      return '-' + f + '_' + t;
    }
    return '';
  }
  function periodLabel(period) {
    if (period.mode === 'year') return 'Year ' + period.year;
    if (period.mode === 'range') return (period.from || '…') + ' \u2192 ' + (period.to || '…');
    return 'All Time';
  }

  // ── Row → plain object keyed by column label (used for JSON + matches CSV) ──
  function rowToObj(row, columns) {
    const o = {};
    columns.forEach(c => { o[c.label] = c.get ? c.get(row) : (row[c.key] ?? ''); });
    return o;
  }

  // ── Downloads ──────────────────────────────────────────────────────────────
  const base = 'home-ledger';
  function exportOneCSV(ds, period) {
    const rows = filteredRows(ds, period);
    const name = base + '-' + ds.id + periodSuffix(period) + '.csv';
    window.HL_EXPORT.exportCSV(name, rows, ds.columns);
  }
  function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ── Dataset row ──────────────────────────────────────────────────────────────
  function DatasetRow({ ds, selected, onToggle, onExport, period }) {
    const all = ds.getRows() || [];
    const total = all.length;
    const shown = ds.dateKey && period.mode !== 'all' ? filteredRows(ds, period).length : total;
    const narrowed = ds.dateKey && period.mode !== 'all' && shown !== total;
    return (
      <div className={'bx-row' + (selected ? '' : ' unsel')} onClick={() => onToggle(ds.id)}
        title={(selected ? 'Exclude ' : 'Include ') + ds.label}>
        <label className="acct-check-label bx-row-check">
          <input id={'bx-include-' + ds.id} type="checkbox" checked={selected} readOnly
            data-table={ds.id} data-col="__include" />
        </label>
        <span className="bx-row-ico" style={{ color: ds.color, background: 'color-mix(in srgb, ' + ds.color + ' 14%, transparent)' }}>
          <Icon name={ds.icon} size={18} />
        </span>
        <div className="bx-row-txt">
          <span className="bx-row-label">{ds.label}</span>
          <span className="bx-row-desc">{ds.desc}</span>
        </div>
        <div className="bx-row-meta">
          <span className="bx-count">
            {narrowed
              ? <React.Fragment><span className="bx-count-num">{shown}</span> <i>of {total} rows</i></React.Fragment>
              : <React.Fragment>{total} <i>rows</i></React.Fragment>}
          </span>
          {ds.dateKey
            ? <span className="bx-period-badge"><Icon name="calendar-range" size={10} />Period</span>
            : null}
        </div>
        <button id={'bx-export-' + ds.id + '-btn'} className="bx-row-export" onClick={(e) => { e.stopPropagation(); onExport(ds); }}
          title={'Export ' + ds.label + ' as CSV'}>
          <Icon name="download" size={13} />CSV
        </button>
      </div>
    );
  }

  // ── App ────────────────────────────────────────────────────────────────────
  function App() {
    const { useTweaks, TweaksPanel, TweakSection, TweakColor, TweakToggle, TweakRadio } = window;
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

    // Resolved once, after hydration has populated the dataset sources.
    const AVAILABLE_YEARS = React.useMemo(computeAvailableYears, []);

    const [period, setPeriod] = React.useState({ mode: 'all', year: AVAILABLE_YEARS[0], from: '', to: '' });
    const [sel, setSel] = React.useState(() => {
      const s = {}; DATASETS.forEach(d => { s[d.id] = true; }); return s;
    });
    const [toast, setToast] = React.useState(null);
    const toastTimer = React.useRef(null);
    const flash = (msg) => {
      setToast(msg);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3200);
    };

    const selectedDatasets = DATASETS.filter(d => sel[d.id]);
    const selCount = selectedDatasets.length;
    const total = DATASETS.length;
    const allSelected = selCount === total;
    const someSelected = selCount > 0 && !allSelected;

    const selectAllRef = React.useRef(null);
    React.useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected; }, [someSelected]);

    const toggle = (id) => setSel(p => ({ ...p, [id]: !p[id] }));
    const toggleAll = () => { const v = !allSelected; const s = {}; DATASETS.forEach(d => { s[d.id] = v; }); setSel(s); };

    function exportCSVAll() {
      if (!selCount) return;
      // Stagger the downloads slightly so the browser fires each one cleanly.
      selectedDatasets.forEach((ds, i) => setTimeout(() => exportOneCSV(ds, period), i * 350));
      flash('Exporting ' + selCount + ' CSV ' + (selCount === 1 ? 'file' : 'files') + ' \u00b7 ' + periodLabel(period));
    }
    function exportSingle(ds) {
      exportOneCSV(ds, period);
      flash('Exported ' + ds.label + '.csv');
    }
    function exportJSON() {
      if (!selCount) return;
      const backup = {};
      if (t.includeManifest) {
        backup._manifest = {
          app: 'Home Ledger', exportedAt: new Date().toISOString(),
          period: period.mode === 'all' ? { mode: 'all' }
            : period.mode === 'year' ? { mode: 'year', year: period.year }
            : { mode: 'range', from: period.from || null, to: period.to || null },
          tables: selectedDatasets.map(ds => ({ id: ds.id, label: ds.label, rows: filteredRows(ds, period).length })),
        };
      }
      selectedDatasets.forEach(ds => { backup[ds.id] = filteredRows(ds, period).map(r => rowToObj(r, ds.columns)); });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJSON(base + '-backup-' + stamp + periodSuffix(period) + '.json', backup);
      flash('JSON backup downloaded \u00b7 ' + selCount + ' ' + (selCount === 1 ? 'table' : 'tables'));
    }

    const totalRows = selectedDatasets.reduce((n, ds) => n + filteredRows(ds, period).length, 0);

    return (
      <div className="app" style={{ '--accent': t.accent }}>
        <Sidebar active="backup-export" />
        <div className="main">
          <header className="page-head">
            <div className="page-head-top">
              <div className="cfg-detail-head-left">
                <div className="page-title-wrap cfg-detail-title-wrap">
                  <span className="cfg-title-icon" style={{ color: 'var(--emerald)' }}><Icon name="database-backup" size={21} /></span>
                  <div className="cfg-title-col">
                    <h1 className="page-title">Backup &amp; Export</h1>
                    <p className="page-subtitle">Export tables as CSV or a full JSON backup</p>
                  </div>
                </div>
              </div>
              <div className="head-actions cfg-head-actions">
                <button id="bx-header-json-btn" className="action-modal-btn bx-json" onClick={exportJSON} disabled={!selCount}>
                  <Icon name="file-json" size={14} />Export JSON Backup
                </button>
                <button id="bx-header-csv-btn" className="action-modal-btn ok" onClick={exportCSVAll} disabled={!selCount}>
                  <Icon name="download" size={14} />Export CSV{selCount ? ' (' + selCount + ')' : ''}
                </button>
              </div>
            </div>
          </header>

          <div className="bx-scroll">
            <div className="bx-inner">
              {/* ── Period ── */}
              <section className="bx-panel">
                <div className="bx-panel-head">
                  <Icon name="calendar-range" size={15} />
                  <span className="bx-panel-title">Period</span>
                  <span className="bx-panel-sub">Applies to transaction tables (Spending, Account Activity). Reference tables always export in full.</span>
                </div>
                <div className="bx-period">
                  <div className="seg bx-seg">
                    {[{ v: 'all', l: 'All Time' }, { v: 'year', l: 'Year' }, { v: 'range', l: 'Date Range' }].map(o => (
                      <button key={o.v} type="button" id={'bx-period-' + o.v + '-btn'} className={period.mode === o.v ? 'on' : ''}
                        onClick={() => setPeriod(p => ({ ...p, mode: o.v }))}>{o.l}</button>
                    ))}
                  </div>
                  {period.mode === 'year' && (
                    <div className="bx-period-field">
                      <span className="field-label">Year</span>
                      <div className="select-wrap bx-year-sel">
                        <select id="bx-period-year-select" className="sel" value={period.year} data-table="transactions" data-col="date"
                          onChange={e => setPeriod(p => ({ ...p, year: e.target.value }))}>
                          {AVAILABLE_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                        <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                      </div>
                    </div>
                  )}
                  {period.mode === 'range' && (
                    <div className="bx-period-dates">
                      <span className="field-label">From</span>
                      <DateInput id="bx-period-from-input" value={period.from} dataTable="transactions" dataCol="date"
                        max={period.to || undefined} placeholder="Start date"
                        onChange={e => setPeriod(p => ({ ...p, from: e.target.value }))} />
                      <span className="bx-period-dash">→</span>
                      <span className="field-label">To</span>
                      <DateInput id="bx-period-to-input" value={period.to} dataTable="transactions" dataCol="date"
                        min={period.from || undefined} placeholder="End date"
                        onChange={e => setPeriod(p => ({ ...p, to: e.target.value }))} />
                    </div>
                  )}
                </div>
              </section>

              {/* ── Select tables ── */}
              <section className="bx-panel">
                <div className="bx-panel-head">
                  <Icon name="table-2" size={15} />
                  <span className="bx-panel-title">Select Tables</span>
                  <label className="acct-check-label bx-selectall" onClick={e => e.stopPropagation()}>
                    <input id="bx-select-all-checkbox" ref={selectAllRef} type="checkbox" checked={allSelected} onChange={toggleAll} />
                    Select All
                  </label>
                  <span className="bx-sel-count">{selCount} of {total} selected</span>
                </div>
                <div className="bx-groups">
                  {GROUPS.map(g => {
                    const rows = DATASETS.filter(d => d.group === g);
                    if (!rows.length) return null;
                    return (
                      <div className="bx-group" key={g}>
                        <div className="bx-group-label">{g}</div>
                        <div className="bx-list">
                          {rows.map(ds => (
                            <DatasetRow key={ds.id} ds={ds} period={period}
                              selected={!!sel[ds.id]} onToggle={toggle} onExport={exportSingle} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* ── Footer summary ── */}
              <div className="bx-foot">
                <div className="bx-foot-info">
                  {toast
                    ? <span className="bx-toast"><Icon name="check-circle-2" size={14} />{toast}</span>
                    : <React.Fragment>
                        <Icon name="info" size={15} />
                        <span><b>{selCount}</b> {selCount === 1 ? 'table' : 'tables'} · <b>{totalRows}</b> {totalRows === 1 ? 'row' : 'rows'} · {periodLabel(period)}</span>
                      </React.Fragment>}
                </div>
                <div className="bx-foot-actions">
                  <button id="bx-foot-json-btn" className="action-modal-btn bx-json" onClick={exportJSON} disabled={!selCount}>
                    <Icon name="file-json" size={14} />Export JSON Backup
                  </button>
                  <button id="bx-foot-csv-btn" className="action-modal-btn ok" onClick={exportCSVAll} disabled={!selCount}>
                    <Icon name="download" size={14} />Export CSV{selCount ? ' (' + selCount + ')' : ''}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <TweaksPanel title="Tweaks">
          <TweakSection label="Appearance" />
          <TweakColor label="Accent" value={t.accent}
            options={['#4f8ef7', '#8b5cf6', '#22c55e', '#f97316', '#ec4899']}
            onChange={v => setTweak('accent', v)} />
          <TweakSection label="JSON Backup" />
          <TweakToggle label="Include Manifest" value={t.includeManifest}
            onChange={v => setTweak('includeManifest', v)} />
        </TweaksPanel>
      </div>
    );
  }

  // Hydrate every export source (spending TX, budgets, accounts, recurring,
  // cats/FX) into the static placeholders before the first render so the
  // dataset row counts, year picker and exported files carry real DB data.
  window.HL_HYDRATE.all().finally(() => {
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  });
})();
