// dashboard-app.jsx — Home Ledger Dashboard + Reports (merged)
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { CATS, TX } = window.LEDGER;
  const { grp, MONTHS, SYM } = window.LEDGER_FMT;
  const { BUDGETS } = window.BUDGETS_DATA;
  const { ACCOUNTS, FX } = window.ACCOUNTS_DATA;
  const INVESTMENTS = window.INVESTMENTS_DATA || { HOLDINGS: [], ASSET_TYPES: {} };
  const HOLDINGS = INVESTMENTS.HOLDINGS || [];
  const ASSET_TYPES = INVESTMENTS.ASSET_TYPES || {};
  const { buildYearData, categoryYTDForecast } = window.DASHBOARD;
  const {
    spendByCat, incomeByCat, monthlyTotals, spendByPayer,
    topExpenses, dailyCumulative, budgetVsActual
  } = window.REPORTS;
  const {
    KpiCard, MonthlySpendVsBudgetChart, CategoryForecastTable, CumulativeChart,
    CategoryBarChart, DonutChart, MonthlyTrendChart, BudgetVsActualChart,
    DailySpendChart, TopExpensesTable, PayerCompareChart
  } = window;
  const { useTweaks, TweaksPanel, TweakSection, TweakColor, TweakRadio } = window;
  const { TxModal, DeleteConfirm } = window;
  const { RecSummaryStrip } = window;
  const { CalendarWidget } = window;
  const ExportData = window.ExportData;
  const ASSET_DOMAIN = window.HL_ASSET_DOMAIN || null;

  const TWEAK_DEFAULTS = { accent: 'var(--theme-accent)', layout: '2-col' };
  const CURRENT_YEAR = window.LEDGER.CURRENT_YEAR;
  const CURRENT_MONTH = window.LEDGER.CURRENT_MONTH; // 0-indexed: Jan=0, Jun=5, etc.

  const { Sidebar } = window.HL_NAV;
  const DASH_VIEW_KEY = 'hl-dashboard-view';
  const DEFAULT_TAB = 'calendar';

  // ── CSV export schema (transactions feeding the dashboard) ──
  const PM_LABEL = { 'credit-card': 'Credit Card', 'debit-card': 'Debit Card', 'cash': 'Cash' };
  const EXPORT_COLS = [
    { key: 'date', label: 'Date' },
    { key: 'desc', label: 'Description' },
    { key: 'cat', label: 'Category', get: r => (CATS[r.cat] || {}).label || r.cat },
    { key: 'type', label: 'Type' },
    { key: 'payer', label: 'Payer' },
    { key: 'payingFor', label: 'Paying For', get: r => r.payingFor === '\u2013' ? '' : r.payingFor },
    { key: 'paymentMethod', label: 'Payment Method', get: r => PM_LABEL[r.paymentMethod] || r.paymentMethod || '' },
    { key: 'cur', label: 'Currency' },
    { key: 'amt', label: 'Amount' },
    { key: 'tryV', label: 'Amount (TRY)' },
    { key: 'usdV', label: 'Amount (USD)' },
  ];

  const TABS = [
    { key: 'calendar',   label: 'Calendar',           icon: 'calendar' },
    { key: 'assets-overview', label: 'Assets Overview', icon: 'scale' },
    { key: 'networth',   label: 'Net Worth Trend',    icon: 'line-chart' },
    { key: 'kpis',       label: 'KPIs',               icon: 'gauge' },
    { key: 'investments',label: 'Investments',       icon: 'chart-no-axes-combined' },
    { key: 'annual',     label: 'Spendig vs Budget',icon: 'calendar-range' },
    { key: 'overview',   label: 'Monthly Overview',  icon: 'layout-grid' },
    { key: 'categories', label: 'Categories',        icon: 'tag' },
    { key: 'budget',     label: 'Budget Analysis',   icon: 'target' },
    { key: 'trends',     label: 'Trends',            icon: 'trending-up' },
  ];

  function invTryValue(h) {
    return h && h.tryValue != null ? Number(h.tryValue) || 0 : 0;
  }

  function invMeta(type) {
    return ASSET_TYPES[type] || { label: type || 'Other', icon: 'circle', color: 'var(--accent)' };
  }

  function groupInvestments(rows, keyOf, metaOf) {
    const map = {};
    rows.forEach(h => {
      const key = keyOf(h) || 'Unassigned';
      if (!map[key]) {
        const meta = metaOf ? metaOf(h, key) : {};
        map[key] = {
          key,
          label: meta.label || key,
          value: 0,
          color: meta.color,
          icon: meta.icon,
          count: 0,
        };
      }
      map[key].value += invTryValue(h);
      map[key].count += 1;
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }

  function InvestmentHoldingsTable({ data, title, icon }) {
    if (!data || data.length === 0) return null;
    return (
      <div className="dash-widget">
        <div className="dash-widget-head">
          <Icon name={icon || 'list'} size={15} />
          <span className="dash-widget-title">{title}</span>
        </div>
        <div className="dash-inv-table">
          {data.map((h, i) => {
            const meta = invMeta(h.assetType);
            return (
              <div className="dash-inv-row" key={h.id || i}>
                <span className="dash-inv-rank">{i + 1}</span>
                <span className="dash-inv-ico" style={{ color: meta.color, background: 'color-mix(in srgb, ' + meta.color + ' 13%, transparent)', borderColor: 'color-mix(in srgb, ' + meta.color + ' 40%, transparent)' }}>
                  <Icon name={meta.icon || 'circle'} size={12} />
                </span>
                <div className="dash-inv-main">
                  <span className="dash-inv-name" title={h.name}>{h.name || 'Unnamed holding'}</span>
                  <span className="dash-inv-sub">{h.platform || 'Unassigned'} · {meta.label} · {h.cur}</span>
                </div>
                <div className="dash-inv-metrics">
                  <span className="dash-inv-amt">₺{grp(invTryValue(h), 0)}</span>
                  <span className="dash-inv-native">{(SYM && SYM[h.cur]) || h.cur + ' '}{grp(h.costBasis != null ? h.costBasis : h.qty, 2)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function netWorthLabel(value, digits) {
    const v = Number(value) || 0;
    return (v < 0 ? '−₺' : '₺') + grp(Math.abs(v), digits == null ? 0 : digits);
  }

  function buildNetWorthTrend(txList, endYear, endMonth, count, currentNetWorth) {
    let y = endYear, m = endMonth - (count - 1);
    while (m < 0) { m += 12; y--; }
    const months = [];
    for (let i = 0; i < count; i++) {
      months.push({ year: y, month: m, key: y + '-' + String(m + 1).padStart(2, '0'), label: MONTHS[m] });
      m++;
      if (m > 11) { m = 0; y++; }
    }
    const flowByKey = {};
    months.forEach(row => { flowByKey[row.key] = 0; });
    txList.forEach(tx => {
      const key = String(tx.date || '').slice(0, 7);
      if (!(key in flowByKey)) return;
      const amount = Number(tx.tryV) || 0;
      if (tx.type === 'income') flowByKey[key] += amount;
      else if (tx.type === 'expense') flowByKey[key] -= amount;
    });
    let worth = currentNetWorth;
    for (let i = months.length - 1; i >= 0; i--) {
      const flow = flowByKey[months[i].key] || 0;
      months[i].netWorth = worth;
      months[i].netFlow = flow;
      worth -= flow;
    }
    return months;
  }

  function NetWorthTrendChart({ data, title, icon }) {
    if (!data || data.length === 0) return null;
    const values = data.map(d => Number(d.netWorth) || 0);
    let minVal = Math.min(...values, 0);
    let maxVal = Math.max(...values, 0);
    if (minVal === maxVal) { minVal -= 1; maxVal += 1; }
    const pad = (maxVal - minVal) * 0.12;
    minVal -= pad;
    maxVal += pad;
    const w = 580, h = 220, px = 54, py = 24;
    const innerW = w - px * 2, innerH = h - py * 2;
    const xOf = i => px + (i / Math.max(data.length - 1, 1)) * innerW;
    const yOf = v => py + innerH - ((v - minVal) / (maxVal - minVal)) * innerH;
    const line = data.map((d, i) => (i === 0 ? 'M' : 'L') + xOf(i).toFixed(1) + ',' + yOf(d.netWorth).toFixed(1)).join(' ');
    const zeroY = yOf(0);
    const ySteps = [0, 0.25, 0.5, 0.75, 1].map(f => minVal + (maxVal - minVal) * f);

    return (
      <div className="dash-widget dash-widget-full">
        <div className="dash-widget-head">
          <Icon name={icon || 'line-chart'} size={15} />
          <span className="dash-widget-title">{title}</span>
          <div className="dash-widget-legend">
            <span className="dash-wl-item"><span className="dash-wl-dot" style={{ background: 'var(--accent)' }} />Net Worth</span>
            <span className="dash-wl-item"><span className="dash-wl-line dash-wl-line-orange" />Zero</span>
          </div>
        </div>
        <div className="dash-cum-wrap">
          <svg viewBox={'0 0 ' + w + ' ' + h} className="dash-cum-svg" preserveAspectRatio="none">
            {ySteps.map((v, i) => {
              const y = yOf(v);
              return (
                <React.Fragment key={i}>
                  <line x1={px} y1={y} x2={w - px} y2={y} stroke="var(--border)" strokeWidth="1" />
                  <text x={px - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--font-sans)">{netWorthLabel(v)}</text>
                </React.Fragment>
              );
            })}
            {zeroY >= py && zeroY <= py + innerH && (
              <line x1={px} y1={zeroY} x2={w - px} y2={zeroY} stroke="var(--orange)" strokeWidth="1.4" strokeDasharray="6 4" opacity="0.55" />
            )}
            {data.map((d, i) => (
              <text key={d.key} x={xOf(i)} y={h - 4} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-sans)">{d.label}</text>
            ))}
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
            {data.map((d, i) => (
              <circle key={d.key} cx={xOf(i)} cy={yOf(d.netWorth)} r={i === data.length - 1 ? 4 : 3}
                fill="var(--accent)" stroke="var(--bg3)" strokeWidth="2">
                <title>{d.label + ' ' + d.year + ': ' + netWorthLabel(d.netWorth)}</title>
              </circle>
            ))}
          </svg>
        </div>
      </div>
    );
  }

  function buildNetWorthAllocation(accounts, holdings) {
    const buckets = {
      cash: { key: 'cash', label: 'Cash', value: 0, color: 'var(--green)' },
      stocks: { key: 'stocks', label: 'Stocks', value: 0, color: 'var(--accent)' },
      crypto: { key: 'crypto', label: 'Crypto', value: 0, color: 'var(--orange)' },
      realEstate: { key: 'realEstate', label: 'Real Estate', value: 0, color: 'var(--lavender)' },
      other: { key: 'other', label: 'Other', value: 0, color: 'var(--slate)' },
    };
    const platformHoldings = {};

    (holdings || []).forEach(h => {
      const type = String(h.assetType || '').toLowerCase();
      const value = invTryValue(h);
      const platform = String(h.platform || '').trim().toLowerCase();
      if (platform) platformHoldings[platform] = (platformHoldings[platform] || 0) + value;
      if (type === 'stock' || type === 'fund') buckets.stocks.value += value;
      else if (type === 'crypto') buckets.crypto.value += value;
      else if (type === 'deposit' || type === 'usd' || type === 'cash') buckets.cash.value += value;
      else if (type === 'real-estate' || type === 'real_estate' || type === 'realestate') buckets.realEstate.value += value;
      else buckets.other.value += value;
    });

    (accounts || []).forEach(a => {
      const rate = FX[a.cur] ? FX[a.cur].toTRY : 1;
      const value = (Number(a.balance) || 0) * rate;
      if (value <= 0) return;
      const type = String(a.type || '').toLowerCase();
      const name = String(a.name || '').toLowerCase();
      const platform = String(a.name || '').trim().toLowerCase();
      if (name.includes('real estate') || name.includes('realestate') || type === 'real-estate' || type === 'real_estate') {
        buckets.realEstate.value += value;
      } else if (type === 'invest' || type === 'pension') {
        if (!platformHoldings[platform]) buckets.other.value += value;
      } else {
        buckets.cash.value += value;
      }
    });

    const total = Object.values(buckets).reduce((s, b) => s + b.value, 0);
    return Object.values(buckets).map(b => Object.assign({}, b, {
      pct: total > 0 ? (b.value / total) * 100 : 0,
    }));
  }

  function NetWorthAllocationPanel({ data }) {
    const rows = data || [];
    return (
      <div className="dash-widget">
        <div className="dash-widget-head">
          <Icon name="pie-chart" size={15} />
          <span className="dash-widget-title">Asset Allocation</span>
        </div>
        <div className="dash-alloc-list">
          {rows.map(row => (
            <div className="dash-alloc-row" key={row.key}>
              <span className="dash-alloc-name">{row.label}</span>
              <div className="dash-alloc-track">
                <div className="dash-alloc-fill" style={{ width: Math.round(row.pct) + '%', background: row.color }} />
              </div>
              <span className="dash-alloc-pct">{Math.round(row.pct)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function assetDomainMeta(map, key) {
    return (map && map[key]) || (map && map.other) || { label: key || 'Other', icon: 'circle', color: 'var(--steel)' };
  }

  function assetDomainMoney(value, cur, digits) {
    const c = cur || 'TRY';
    const sym = (window.LEDGER_FMT.SYM && window.LEDGER_FMT.SYM[c]) || c + ' ';
    return sym + grp(value || 0, digits == null ? 0 : digits);
  }

  function DashboardAssetMiniRow({ item }) {
    const metaMap = ASSET_DOMAIN ? ASSET_DOMAIN.ASSET_TYPES : {};
    const m = assetDomainMeta(metaMap, item.type);
    const latest = item.latest;
    return (
      <div className="asset-mini-row">
        <span className="asset-card-icon" style={{ '--asset-color': m.color }}><Icon name={m.icon} size={14} /></span>
        <span className="asset-mini-main"><b>{item.name}</b><small>{m.label}{item.institution ? ' - ' + item.institution : ''}</small></span>
        <span className="asset-mini-val income">{latest ? assetDomainMoney(latest.tryValue, 'TRY') : 'No value'}</span>
      </div>
    );
  }

  function DashboardAssetsOverview({ summary, assets, loading, error }) {
    const assetValue = assets.reduce((s, a) => s + (a.latest ? a.latest.tryValue * (a.ownership || 100) / 100 : 0), 0);
    const cards = [
      { label: 'Assets', icon: 'trending-up', cls: 'income', val: assetDomainMoney(summary?.assets_try ?? assetValue, 'TRY'), sub: (summary?.assets_count ?? assets.length) + ' records' },
      { label: 'Net Worth', icon: 'scale', cls: 'net', val: assetDomainMoney(summary?.net_worth_try ?? assetValue, 'TRY'), sub: 'Included values' },
      { label: 'Needs Update', icon: 'alert-triangle', cls: (summary?.missing_asset_valuations || 0) ? 'expense' : 'count', val: String(summary?.missing_asset_valuations || 0), sub: 'missing values' },
    ];
    const valuedAssets = assets.filter(a => a.latest).sort((a, b) => b.latest.tryValue - a.latest.tryValue).slice(0, 8);
    const staleAssets = assets.filter(a => !a.latest).slice(0, 6);
    return (
      <main className="asset-body">
        {error && <div className="rpt-source-alert asset-load-error" role="status"><Icon name="alert-triangle" size={14} /><span>{error}</span></div>}
        {loading && <div className="dash-empty-state"><Icon name="loader-2" size={24} /><span>Loading assets overview...</span></div>}
        {!loading && (
          <React.Fragment>
            <div className="summary-row">
              {cards.map(c => <div className="summary-card" key={c.label}><span className="summary-label"><Icon name={c.icon} size={13} />{c.label}</span><span className={'summary-value ' + c.cls}>{c.val}</span><span className="summary-sub">{c.sub}</span></div>)}
            </div>
            <div className="asset-overview-grid">
              <section className="asset-panel">
                <div className="asset-panel-head"><span><Icon name="wallet" size={14} />Largest Assets</span><a href="Assets.html">Open Assets</a></div>
                {valuedAssets.map(a => <DashboardAssetMiniRow key={a.id} item={a} />)}
                {!assets.length && <div className="detail-empty asset-empty"><Icon name="wallet" size={24} /><span>No assets yet.</span></div>}
              </section>
              <section className="asset-panel asset-panel-wide">
                <div className="asset-panel-head"><span><Icon name="alert-triangle" size={14} />Needs Valuation</span><a href="Assets.html">Open Assets</a></div>
                {staleAssets.map(a => <DashboardAssetMiniRow key={a.id} item={a} />)}
                {!staleAssets.length && <div className="detail-empty asset-empty"><Icon name="check-circle" size={24} /><span>Every included asset has a valuation.</span></div>}
              </section>
            </div>
          </React.Fragment>
        )}
      </main>
    );
  }

  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const [month, setMonth] = React.useState(CURRENT_MONTH);
    const [year, setYear]   = React.useState(CURRENT_YEAR);
    const [annualYear, setAnnualYear] = React.useState(CURRENT_YEAR);
    const [tab, setTab]     = React.useState(() => {
      try {
        const saved = localStorage.getItem(DASH_VIEW_KEY);
        return TABS.some(tb => tb.key === saved) ? saved : DEFAULT_TAB;
      } catch (e) {
        return DEFAULT_TAB;
      }
    });
    const [modal, setModal] = React.useState(null);
    const [del, setDel]     = React.useState(null);
    // Bumped after every tx mutation; threaded into the aggregation memos below
    // (whose period-only dependency arrays would otherwise miss data changes).
    const [dataVersion, setDataVersion] = React.useState(0);
    const [assetOverview, setAssetOverview] = React.useState({ assets: [], summary: null, loading: false, loaded: false, error: '' });

    React.useEffect(() => {
      window.HL_THEME.accent(t.accent);
    }, [t.accent]);

    React.useEffect(() => {
      try { localStorage.setItem(DASH_VIEW_KEY, tab); } catch (e) {}
    }, [tab]);

    // Re-pull transactions from the DB (mutated into LEDGER.TX in place) and
    // force the read-only memos to recompute.
    async function refreshTx() {
      await window.HL_HYDRATE.hydrateTx();
      setDataVersion(v => v + 1);
    }

    const loadAssetOverview = React.useCallback(async () => {
      if (!ASSET_DOMAIN) {
        setAssetOverview(s => ({ ...s, loading: false, loaded: true, error: 'Asset overview data client is not available.' }));
        return;
      }
      setAssetOverview(s => ({ ...s, loading: true, error: '' }));
      try {
        const [assets, summary] = await Promise.all([
          ASSET_DOMAIN.listAssets(),
          ASSET_DOMAIN.summary(),
        ]);
        setAssetOverview({ assets, summary, loading: false, loaded: true, error: '' });
      } catch (e) {
        setAssetOverview(s => ({ ...s, loading: false, loaded: true, error: 'Could not load assets overview: ' + ((e && e.message) || e) }));
      }
    }, []);

    React.useEffect(() => {
      if (tab === 'assets-overview' && !assetOverview.loaded && !assetOverview.loading) loadAssetOverview();
    }, [tab, assetOverview.loaded, assetOverview.loading, loadAssetOverview]);

    async function saveTx(tx) {
      const editing = !!tx.id;
      try {
        await window.HL_OP_NOTIFY.promise(
          editing ? window.HL_SPENDING_API.update(tx.id, tx) : window.HL_SPENDING_API.create(tx),
          {
            pending: editing ? 'Updating transaction...' : 'Saving transaction...',
            success: editing ? 'Transaction updated.' : 'Transaction saved.',
            error: false,
          }
        );
        await refreshTx();
        setModal(null);
      } catch (e) {
        window.HL_OP_NOTIFY.show((editing ? 'Could not update transaction: ' : 'Could not save transaction: ') + ((e && e.message) || e), { type: 'error', timeout: 4200 });
      }
    }
    async function confirmDelete() {
      try {
        await window.HL_OP_NOTIFY.promise(
          window.HL_SPENDING_API.remove(del.id),
          { pending: 'Deleting transaction...', success: 'Transaction deleted.', error: false }
        );
        await refreshTx();
        setDel(null);
      } catch (e) {
        window.HL_OP_NOTIFY.show('Could not delete transaction: ' + ((e && e.message) || e), { type: 'error', timeout: 4200 });
      }
    }

    function monthStep(d) {
      let m = month + d, y = year;
      if (m < 0)  { m = 11; y--; }
      if (m > 11) { m = 0;  y++; }
      setMonth(m); setYear(y);
    }

    // ── Annual (dashboard) derived data ───────────────────────────────────
    // Determine effective "current month" for the selected annual year:
    // Past year → 11 (all months actual), Current year → CURRENT_MONTH, Future → -1 (all forecast)
    const effectiveMonth = annualYear < CURRENT_YEAR ? 11 : annualYear === CURRENT_YEAR ? CURRENT_MONTH : -1;
    const yearData   = React.useMemo(() => buildYearData(TX, BUDGETS, annualYear, effectiveMonth), [annualYear, effectiveMonth, dataVersion]);
    const catForecast= React.useMemo(() => categoryYTDForecast(TX, BUDGETS, CATS, annualYear, effectiveMonth), [annualYear, effectiveMonth, dataVersion]);

    const ytdActual   = yearData.filter(d => !d.forecast).reduce((s, d) => s + d.spend, 0);
    const ytdBudget   = yearData.filter(d => !d.forecast).reduce((s, d) => s + d.budget, 0);
    const foreseenEOY = yearData.reduce((s, d) => s + d.spend, 0);
    const annualBudget= yearData.reduce((s, d) => s + d.budget, 0);
    const ytdIncome   = yearData.filter(d => !d.forecast).reduce((s, d) => s + d.income, 0);
    const ytdNet      = ytdIncome - ytdActual;
    const savingsRate = ytdIncome > 0 ? Math.round((ytdNet / ytdIncome) * 100) : 0;
    const ytdDiff     = ytdBudget - ytdActual;
    const eoyDiff     = annualBudget - foreseenEOY;
    const ytdPct      = ytdBudget > 0 ? Math.round((ytdActual / ytdBudget) * 100) : 0;
    const eoyPct      = annualBudget > 0 ? Math.round((foreseenEOY / annualBudget) * 100) : 0;

    // Determine available years from transactions
    const availableYears = React.useMemo(() => {
      const ySet = new Set();
      TX.forEach(tx => ySet.add(parseInt(tx.date.substring(0, 4), 10)));
      ySet.add(CURRENT_YEAR);
      return Array.from(ySet).sort();
    }, [dataVersion]);
    const minYear = availableYears[0];
    const maxYear = availableYears[availableYears.length - 1];

    let totalAssets = 0, totalNegativeBalances = 0;
    ACCOUNTS.forEach(a => {
      const rate = FX[a.cur] ? FX[a.cur].toTRY : 1;
      const tryV = a.balance * rate;
      if (tryV >= 0) totalAssets += tryV; else totalNegativeBalances += Math.abs(tryV);
    });
    const assetAccountCount = ACCOUNTS.filter(a => a.balance * (FX[a.cur]?.toTRY || 1) >= 0).length;
    const netWorth = totalAssets - totalNegativeBalances;
    const netWorthTrend = React.useMemo(() =>
      buildNetWorthTrend(TX, CURRENT_YEAR, CURRENT_MONTH, 12, netWorth), [dataVersion, netWorth]);
    const netWorthStart = netWorthTrend.length ? netWorthTrend[0].netWorth : netWorth;
    const netWorthChange = netWorth - netWorthStart;
    const avgMonthlyFlow = netWorthTrend.length
      ? netWorthTrend.reduce((s, d) => s + d.netFlow, 0) / netWorthTrend.length
      : 0;
    const netWorthAllocation = React.useMemo(() =>
      buildNetWorthAllocation(ACCOUNTS, HOLDINGS), [dataVersion]);
    // ── Monthly (reports) derived data ────────────────────────────────────
    const catSpend    = React.useMemo(() => spendByCat(TX, year, month),            [year, month, dataVersion]);
    const catIncome   = React.useMemo(() => incomeByCat(TX, year, month),           [year, month, dataVersion]);
    const payerData   = React.useMemo(() => spendByPayer(TX, year, month),          [year, month, dataVersion]);
    const topExp      = React.useMemo(() => topExpenses(TX, year, month, 8),        [year, month, dataVersion]);
    const dailyCum    = React.useMemo(() => dailyCumulative(TX, year, month),       [year, month, dataVersion]);
    const bva         = React.useMemo(() => budgetVsActual(TX, BUDGETS, year, month),[year, month, dataVersion]);

    const prefix     = year + '-' + String(month + 1).padStart(2, '0');
    const monthTx    = TX.filter(tx => tx.date.startsWith(prefix));
    const totalExpense = monthTx.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.tryV, 0);

    const trendData = React.useMemo(() => {
      let sy = year, sm = month - 5;
      while (sm < 0) { sm += 12; sy--; }
      return monthlyTotals(TX, sy, sm, 6);
    }, [year, month, dataVersion]);

    const donutData = React.useMemo(() =>
      Object.entries(catSpend).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
        const c = CATS[k] || {};
        return { key: k, label: c.label || k, value: v, color: c.color };
      }), [catSpend]);

    const barData = React.useMemo(() =>
      Object.entries(catSpend).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
        ({ key: k, label: (CATS[k] || {}).label || k, value: v })), [catSpend]);

    const incomeBarData = React.useMemo(() =>
      Object.entries(catIncome).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
        ({ key: k, label: (CATS[k] || {}).label || k, value: v })), [catIncome]);

    const investmentRows = React.useMemo(() => HOLDINGS.slice(), [dataVersion]);
    const totalInvestedTry = investmentRows.reduce((s, h) => s + invTryValue(h), 0);
    const investPlatforms = React.useMemo(() => groupInvestments(
      investmentRows,
      h => (h.platform || '').trim() || 'Unassigned',
      (h, key) => {
        const acc = ACCOUNTS.find(a => String(a.name || '').trim().toLowerCase() === String(key).trim().toLowerCase());
        return { label: key, color: acc && window.ACCOUNTS_DATA.ACCOUNT_TYPES[acc.type] ? window.ACCOUNTS_DATA.ACCOUNT_TYPES[acc.type].color : 'var(--emerald)', icon: acc && window.ACCOUNTS_DATA.ACCOUNT_TYPES[acc.type] ? window.ACCOUNTS_DATA.ACCOUNT_TYPES[acc.type].icon : 'briefcase' };
      }
    ), [dataVersion]);
    const investAssetTypes = React.useMemo(() => groupInvestments(
      investmentRows,
      h => h.assetType || 'other',
      h => invMeta(h.assetType)
    ), [dataVersion]);
    const topHoldings = React.useMemo(() =>
      investmentRows.slice().sort((a, b) => invTryValue(b) - invTryValue(a)).slice(0, 10), [dataVersion]);
    const investAccounts = ACCOUNTS.filter(a => a.type === 'invest' || a.type === 'pension');
    const largestHolding = topHoldings[0];

    const totalBudgeted = bva.reduce((s, d) => s + d.limit, 0);
    const layoutCls = t.layout === '1-col' ? 'rpt-single' : '';
    const isAnnual  = tab === 'annual';
    const usesMonthlyPeriod = !isAnnual && tab !== 'calendar' && tab !== 'assets-overview' && tab !== 'networth' && tab !== 'investments';
    const loadErrors = (window.HL_HYDRATE && window.HL_HYDRATE.state && window.HL_HYDRATE.state.errors) || {};
    const missingSources = Object.keys(loadErrors).filter(k => ['transactions','budgets','accounts','investments','recurring','credit-payments'].includes(k));

    return (
      <div className="app">
        <Sidebar active="dashboard" />
        <div className="main">

          {/* ── Page header ── */}
          <header className="page-head">
            <div className="page-head-top">
              {/* Same header structure as every other page (page-title-wrap
                  cfg-detail-title-wrap > cfg-title-col) so the title treatment and
                  the mobile app-logo (`.cfg-detail-title-wrap::before`) are shared,
                  not a Dashboard one-off. On desktop the row carries no leading
                  icon, so it reads identically to the old column layout. */}
              <div className="page-title-wrap cfg-detail-title-wrap">
                <div className="cfg-title-col">
                  <h1 className="page-title">Dashboard</h1>
                  <p className="page-subtitle">At-a-glance view of household finances</p>
                </div>
              </div>
            </div>

            {/* ── Tab bar + optional period picker ── */}
            <div className="filter-bar rpt-filter-bar">
              <span className="rpt-view-name">
                <Icon name={(TABS.find(tb => tb.key === tab) || TABS[0]).icon} size={14} />
                {(TABS.find(tb => tb.key === tab) || TABS[0]).label}
              </span>
              {usesMonthlyPeriod && (
                <div className="filter-field ff-period">
                  <span className="filter-label"><Icon name="calendar" size={11} />Period</span>
                  <div className="month-step">
                    <button id="dash-period-prev-btn" className="ms-btn" onClick={() => monthStep(-1)} title="Previous month">
                      <Icon name="chevron-left" size={14} />
                    </button>
                    <span className="ms-label">
                      <Icon name="calendar-days" size={13} />{MONTHS[month]} {year}
                    </span>
                    <button id="dash-period-next-btn" className="ms-btn" onClick={() => monthStep(1)} title="Next month">
                      <Icon name="chevron-right" size={14} />
                    </button>
                  </div>
                </div>
              )}
              {isAnnual && (
                <div className="filter-field ff-period">
                  <span className="filter-label"><Icon name="calendar-range" size={11} />Year</span>
                  <div className="month-step">
                    <button id="dash-year-prev-btn" className="ms-btn" onClick={() => setAnnualYear(y => Math.max(y - 1, minYear - 1))} title="Previous year">
                      <Icon name="chevron-left" size={14} />
                    </button>
                    <span className="ms-label">
                      <Icon name="calendar-range" size={13} />{annualYear}
                    </span>
                    <button id="dash-year-next-btn" className="ms-btn" onClick={() => setAnnualYear(y => Math.min(y + 1, maxYear + 1))} title="Next year">
                      <Icon name="chevron-right" size={14} />
                    </button>
                  </div>
                </div>
              )}
              <div className="filter-field ff-tabs">
                <span className="filter-label"><Icon name="layout-grid" size={11} />View</span>
                <div className="select-wrap">
                  <StyledSelect id="dash-view-select" className="sel" value={tab} onChange={(e) => setTab(e.target.value)}>
                    {TABS.map(tb => (
                      <option key={tb.key} value={tb.key} data-icon={tb.icon}>{tb.label}</option>
                    ))}
                  </StyledSelect>
                </div>
              </div>
            </div>
          </header>

          {/* ── Scrollable body: tab content ── */}
          <div className="rpt-body">
            {missingSources.length > 0 && (
              <div className="rpt-source-alert" role="status">
                <Icon name="alert-triangle" size={14} />
                <span>Some report data could not be loaded: {missingSources.map(s => s.replace('-', ' ')).join(', ')}.</span>
              </div>
            )}

            {/* KPIs view */}
            {tab === 'kpis' && (
              <React.Fragment>
                <div className="dash-kpi-group">
                  <div className="dash-kpi-source"><Icon name="database" size={11} /><span>Source: <strong>Transactions</strong> (Expenses) · <strong>Budgets</strong></span></div>
                  <div className="dash-kpi-row">
                  <KpiCard label="Actual Spend YTD" icon="arrow-up-right" cls="kpi-expense"
                    value={'₺' + grp(ytdActual, 0)}
                    sub={ytdPct + '% of YTD budget'}
                    detail={ytdDiff >= 0
                      ? '₺' + grp(ytdDiff, 0) + ' under budget'
                      : '₺' + grp(Math.abs(ytdDiff), 0) + ' over budget'} />
                  <KpiCard label="YTD Budget" icon="target" cls="kpi-budget"
                    value={'₺' + grp(ytdBudget, 0)}
                    sub={'Jan – ' + MONTHS[CURRENT_MONTH] + ' ' + CURRENT_YEAR}
                    detail={(CURRENT_MONTH + 1) + ' months'} />
                  <KpiCard label="Foreseen Spend EOY" icon="telescope"
                    cls={eoyDiff >= 0 ? 'kpi-ok' : 'kpi-warn'}
                    value={'₺' + grp(foreseenEOY, 0)}
                    sub={eoyPct + '% of annual budget'}
                    detail={eoyDiff >= 0
                      ? '₺' + grp(eoyDiff, 0) + ' projected surplus'
                      : '₺' + grp(Math.abs(eoyDiff), 0) + ' projected deficit'} />
                  <KpiCard label="Annual Budget" icon="calendar-range" cls="kpi-total"
                    value={'₺' + grp(annualBudget, 0)}
                    sub={'Full year ' + CURRENT_YEAR}
                    detail={'₺' + grp(annualBudget / 12, 0) + ' / month avg'} />
                  </div>
                </div>

                <div className="dash-kpi-group">
                  <div className="dash-kpi-source"><Icon name="database" size={11} /><span>Source: <strong>Transactions</strong> (Income) · <strong>Accounts</strong></span></div>
                  <div className="dash-kpi-row">
                  <KpiCard label="YTD Income" icon="arrow-down-left" cls="kpi-income"
                    value={'₺' + grp(ytdIncome, 0)}
                    sub={'Jan – ' + MONTHS[CURRENT_MONTH] + ' ' + CURRENT_YEAR}
                    detail={'₺' + grp(ytdIncome / (CURRENT_MONTH + 1), 0) + ' / month avg'} />
                  <KpiCard label="YTD Net" icon="scale"
                    cls={ytdNet >= 0 ? 'kpi-ok' : 'kpi-warn'}
                    value={(ytdNet < 0 ? '−₺' : '₺') + grp(Math.abs(ytdNet), 0)}
                    sub={ytdNet >= 0 ? savingsRate + '% savings rate' : 'Deficit'}
                    detail={ytdNet >= 0 ? 'Income surplus' : 'Spending exceeds income'} />
                  <KpiCard label="Total Assets" icon="landmark" cls="kpi-budget"
                    value={'₺' + grp(totalAssets, 0)}
                    sub={'All positive balances'}
                    detail={ACCOUNTS.filter(a => a.balance * (FX[a.cur]?.toTRY || 1) >= 0).length + ' accounts'} />
                    <KpiCard label="Net Worth" icon="wallet"
                      cls={netWorth >= 0 ? 'kpi-total' : 'kpi-warn'}
                      value={(netWorth < 0 ? '−₺' : '₺') + grp(Math.abs(netWorth), 0)}
                    sub={'Account net balance'}
                    detail={'₺' + grp(totalAssets, 0) + ' positive balances'} />
                  </div>
                </div>

                {/* Recurring summary strip — using KpiCard for consistency */}
                {(() => {
                  const recItems = window.RECURRING_DATA ? window.RECURRING_DATA.RECURRING : [];
                  const recActive = recItems.filter(r => r.status === 'active');
                  const recPaused = recItems.filter(r => r.status === 'paused');
                  const recEnded  = recItems.filter(r => r.status === 'ended');
                  let recMonthly = 0;
                  recActive.forEach(r => {
                    let m = r.tryAmount;
                    if (r.frequency === 'daily') m *= 30;
                    else if (r.frequency === 'weekly') m *= 4.33;
                    recMonthly += m;
                  });
                  return (
                    <div className="dash-kpi-group">
                      <div className="dash-kpi-source"><Icon name="database" size={11} /><span>Source: <strong>Recurring</strong></span></div>
                      <div className="dash-kpi-row">
                        <KpiCard label="Monthly Cost" icon="calculator" cls="kpi-expense"
                          value={'₺' + grp(recMonthly, 0)}
                          sub="Active recurring"
                          detail={'₺' + grp(recMonthly * 12, 0) + ' / year'} />
                        <KpiCard label="Active" icon="circle-check" cls="kpi-income"
                          value={String(recActive.length)}
                          sub="Bills & subs"
                          detail="Currently running" />
                        <KpiCard label="Paused" icon="pause-circle" cls="kpi-budget"
                          value={String(recPaused.length)}
                          sub="Temporarily off"
                          detail="Can be resumed" />
                        <KpiCard label="Ended" icon="circle-x" cls="kpi-total"
                          value={String(recEnded.length)}
                          sub="Cancelled"
                          detail="No longer active" />
                      </div>
                    </div>
                  );
                })()}
              </React.Fragment>
            )}

            {/* Calendar */}
            {tab === 'calendar' && <CalendarWidget />}

            {/* Assets Overview */}
            {tab === 'assets-overview' && (
              <DashboardAssetsOverview
                summary={assetOverview.summary}
                assets={assetOverview.assets}
                loading={assetOverview.loading}
                error={assetOverview.error}
              />
            )}

            {/* Net Worth Trend */}
            {tab === 'networth' && (
              <React.Fragment>
                <div className="dash-kpi-group">
                  <div className="dash-kpi-source"><Icon name="database" size={11} /><span>Source: <strong>Accounts</strong> · <strong>Transactions</strong></span></div>
                  <div className="dash-kpi-row">
                    <KpiCard label="Net Worth" icon="wallet"
                      cls={netWorth >= 0 ? 'kpi-total' : 'kpi-warn'}
                      value={netWorthLabel(netWorth)}
                      sub="Current account balances"
                      detail={'₺' + grp(totalAssets, 0) + ' assets'} />
                    <KpiCard label="12-Month Change" icon="activity"
                      cls={netWorthChange >= 0 ? 'kpi-ok' : 'kpi-warn'}
                      value={netWorthLabel(netWorthChange)}
                      sub={netWorthChange >= 0 ? 'Increase' : 'Decrease'}
                      detail={netWorthLabel(avgMonthlyFlow) + ' / month avg'} />
                    <KpiCard label="Assets" icon="landmark" cls="kpi-budget"
                      value={'₺' + grp(totalAssets, 0)}
                      sub="Positive balances"
                      detail={<a className="dash-kpi-link" href="Accounts.html?balance=assets">{assetAccountCount + ' accounts'}</a>} />
                  </div>
                </div>
                <div className="rpt-grid rpt-single">
                  <div className="rpt-col-full">
                    <NetWorthTrendChart data={netWorthTrend} title="Net Worth Trend" icon="line-chart" />
                  </div>
                  <div className="rpt-col-full">
                    <NetWorthAllocationPanel data={netWorthAllocation} />
                  </div>
                </div>
              </React.Fragment>
            )}

            {/* Annual Summary — full-year charts */}
            {tab === 'annual' && (
              <div className={'rpt-grid ' + layoutCls}>
                <div className="rpt-col-left">
                  <MonthlySpendVsBudgetChart data={yearData}
                    title="Monthly Spending vs Budget" icon="bar-chart-3"
                    currentMonth={effectiveMonth} />
                </div>
                <div className="rpt-col-right">
                  <CumulativeChart data={yearData}
                    title="Cumulative Spend vs Budget" icon="trending-up"
                    currentMonth={effectiveMonth} />
                </div>
                <div className="rpt-col-full">
                  <CategoryForecastTable data={catForecast}
                    title="Category Budget Forecast (EOY)" icon="list" />
                </div>
              </div>
            )}

            {/* Monthly Overview */}
            {tab === 'overview' && (
              <div className={'rpt-grid ' + layoutCls}>
                <div className="rpt-col-left">
                  <MonthlyTrendChart data={trendData}
                    title="Income vs Expense Trend" icon="bar-chart-3" />
                  <DailySpendChart data={dailyCum}
                    title="Daily Cumulative Spending" icon="activity"
                    budgetDailyAvg={totalBudgeted > 0 ? totalBudgeted : null} />
                </div>
                <div className="rpt-col-right">
                  <DonutChart data={donutData} title="Expense Breakdown" icon="pie-chart"
                    centerLabel="Total" centerValue={'₺' + grp(totalExpense, 0)} />
                  <PayerCompareChart data={payerData} title="Spending By Payer" icon="users" />
                </div>
              </div>
            )}

            {/* Categories */}
            {tab === 'categories' && (
              <div className={'rpt-grid ' + layoutCls}>
                <div className="rpt-col-left">
                  <CategoryBarChart data={barData} title="Expense By Category" icon="bar-chart-3" />
                  {incomeBarData.length > 0 && (
                    <CategoryBarChart data={incomeBarData} title="Income By Source" icon="arrow-down-left" />
                  )}
                </div>
                <div className="rpt-col-right">
                  <DonutChart data={donutData} title="Category Distribution" icon="pie-chart"
                    centerLabel="Categories" centerValue={String(donutData.length)} />
                  <TopExpensesTable data={topExp} title="Largest Expenses" icon="trophy" />
                </div>
              </div>
            )}

            {/* Budget Analysis */}
            {tab === 'budget' && (
              <div className={'rpt-grid ' + layoutCls}>
                <div className="rpt-col-full">
                  <BudgetVsActualChart data={bva}
                    title="Budget vs Actual Spending" icon="target" />
                </div>
              </div>
            )}

            {/* Investments */}
            {tab === 'investments' && (
              <React.Fragment>
                <div className="dash-kpi-group">
                  <div className="dash-kpi-source"><Icon name="database" size={11} /><span>Source: <strong>Investments</strong> · <strong>Accounts</strong></span></div>
                  <div className="dash-kpi-row">
                    <KpiCard label="Portfolio Value" icon="trending-up" cls="kpi-total"
                      value={'₺' + grp(totalInvestedTry, 0)}
                      sub={investmentRows.length + ' holdings'}
                      detail={investAccounts.length + ' investment accounts'} />
                    <KpiCard label="Platforms" icon="briefcase" cls="kpi-budget"
                      value={String(investPlatforms.length)}
                      sub="Linked by account name"
                      detail={investPlatforms[0] ? investPlatforms[0].label : 'No platform data'} />
                    <KpiCard label="Asset Types" icon="layers" cls="kpi-income"
                      value={String(investAssetTypes.length)}
                      sub="Allocation groups"
                      detail={investAssetTypes[0] ? investAssetTypes[0].label : 'No allocation data'} />
                    <KpiCard label="Largest Holding" icon="trophy" cls="kpi-ok"
                      value={largestHolding ? '₺' + grp(invTryValue(largestHolding), 0) : '₺0'}
                      sub={largestHolding ? largestHolding.name : 'No holdings'}
                      detail={largestHolding ? (largestHolding.platform || 'Unassigned') : 'Add or import investments'} />
                  </div>
                </div>
                {investmentRows.length === 0 ? (
                  <div className="dash-empty-state">
                    <Icon name="trending-up" size={28} />
                    <span>No investment holdings yet</span>
                  </div>
                ) : (
                  <div className={'rpt-grid ' + layoutCls}>
                    <div className="rpt-col-left">
                      <DonutChart data={investAssetTypes} title="Asset Allocation" icon="pie-chart"
                        centerLabel="Portfolio" centerValue={'₺' + grp(totalInvestedTry, 0)} />
                      <CategoryBarChart data={investAssetTypes} title="Value By Asset Type" icon="bar-chart-3" />
                    </div>
                    <div className="rpt-col-right">
                      <DonutChart data={investPlatforms} title="Platform Allocation" icon="briefcase"
                        centerLabel="Platforms" centerValue={String(investPlatforms.length)} />
                      <CategoryBarChart data={investPlatforms} title="Value By Platform" icon="landmark" />
                    </div>
                    <div className="rpt-col-full">
                      <InvestmentHoldingsTable data={topHoldings} title="Top Holdings" icon="list" />
                    </div>
                  </div>
                )}
              </React.Fragment>
            )}

            {/* Trends */}
            {tab === 'trends' && (
              <div className={'rpt-grid ' + layoutCls}>
                <div className="rpt-col-left">
                  <MonthlyTrendChart data={trendData}
                    title="6-Month Income vs Expense" icon="bar-chart-3" />
                </div>
                <div className="rpt-col-right">
                  <DailySpendChart data={dailyCum}
                    title="Daily Cumulative Spending" icon="activity"
                    budgetDailyAvg={totalBudgeted > 0 ? totalBudgeted : null} />
                </div>
              </div>
            )}

          </div>
        </div>

        {modal && <TxModal initial={modal.tx} scan={modal.scan} onClose={() => setModal(null)} onSave={saveTx} onDelete={(tx) => { setModal(null); setDel(tx); }} />}
        {del   && <DeleteConfirm tx={del} onClose={() => setDel(null)} onConfirm={confirmDelete} />}

        <TweaksPanel title="Tweaks">
          <TweakSection label="Appearance" />
          <TweakColor label="Accent" value={t.accent}
            options={['var(--theme-accent)', 'var(--lavender)', 'var(--green)', 'var(--orange)', 'var(--pink)']}
            onChange={(v) => setTweak('accent', v)} />
          <TweakRadio label="Layout" value={t.layout}
            options={['2-col', '1-col']}
            onChange={(v) => setTweak('layout', v)} />
        </TweaksPanel>
      </div>
    );
  }

  // Hydrate TX + budgets + accounts + recurring + cats/FX into the static
  // placeholders (in place) BEFORE the first render, so every aggregation memo
  // computes against real DB data on mount.
  window.HL_HYDRATE.all().finally(() => {
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  });
})();
