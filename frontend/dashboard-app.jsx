// dashboard-app.jsx — Home Ledger Dashboard + Reports (merged)
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { CATS, TX } = window.LEDGER;
  const { grp, MONTHS } = window.LEDGER_FMT;
  const { BUDGETS } = window.BUDGETS_DATA;
  const { ACCOUNTS, FX } = window.ACCOUNTS_DATA;
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

  const TWEAK_DEFAULTS = { accent: '#4f8ef7', layout: '2-col' };
  const CURRENT_YEAR = window.LEDGER.CURRENT_YEAR;
  const CURRENT_MONTH = window.LEDGER.CURRENT_MONTH; // 0-indexed: Jan=0, Jun=5, etc.

  const { Sidebar } = window.HL_NAV;

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
    { key: 'kpis',       label: 'KPIs',               icon: 'gauge' },
    { key: 'annual',     label: 'Annual Summary',   icon: 'calendar-range' },
    { key: 'overview',   label: 'Monthly Overview',  icon: 'layout-grid' },
    { key: 'categories', label: 'Categories',        icon: 'tag' },
    { key: 'budget',     label: 'Budget Analysis',   icon: 'target' },
    { key: 'trends',     label: 'Trends',            icon: 'trending-up' },
  ];

  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const [month, setMonth] = React.useState(CURRENT_MONTH);
    const [year, setYear]   = React.useState(CURRENT_YEAR);
    const [annualYear, setAnnualYear] = React.useState(CURRENT_YEAR);
    const [tab, setTab]     = React.useState('calendar');
    const [modal, setModal] = React.useState(null);
    const [del, setDel]     = React.useState(null);
    // Bumped after every tx mutation; threaded into the aggregation memos below
    // (whose period-only dependency arrays would otherwise miss data changes).
    const [dataVersion, setDataVersion] = React.useState(0);

    React.useEffect(() => {
      window.HL_THEME.accent(t.accent);
    }, [t.accent]);

    // Re-pull transactions from the DB (mutated into LEDGER.TX in place) and
    // force the read-only memos to recompute.
    async function refreshTx() {
      await window.HL_HYDRATE.hydrateTx();
      setDataVersion(v => v + 1);
    }

    async function saveTx(tx) {
      try {
        if (!tx.id) await window.HL_SPENDING_API.create(tx);
        else        await window.HL_SPENDING_API.update(tx.id, tx);
        await refreshTx();
        setModal(null);
      } catch (e) {
        alert('Could not save transaction: ' + ((e && e.message) || e));
      }
    }
    async function confirmDelete() {
      try {
        await window.HL_SPENDING_API.remove(del.id);
        await refreshTx();
        setDel(null);
      } catch (e) {
        alert('Could not delete transaction: ' + ((e && e.message) || e));
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

    let totalAssets = 0, totalLiabilities = 0;
    ACCOUNTS.forEach(a => {
      const rate = FX[a.cur] ? FX[a.cur].toTRY : 1;
      const tryV = a.balance * rate;
      if (tryV >= 0) totalAssets += tryV; else totalLiabilities += Math.abs(tryV);
    });
    const netWorth = totalAssets - totalLiabilities;

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

    const totalBudgeted = bva.reduce((s, d) => s + d.limit, 0);
    const layoutCls = t.layout === '1-col' ? 'rpt-single' : '';
    const isAnnual  = tab === 'annual';

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
              {!isAnnual && tab !== 'calendar' && (
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
                      <option key={tb.key} value={tb.key}>{tb.label}</option>
                    ))}
                  </StyledSelect>
                </div>
              </div>
            </div>
          </header>

          {/* ── Scrollable body: tab content ── */}
          <div className="rpt-body">

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
                    sub={'Assets − liabilities'}
                    detail={'₺' + grp(totalLiabilities, 0) + ' in liabilities'} />
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
                      <div className="dash-kpi-source"><Icon name="database" size={11} /><span>Source: <strong>Subscriptions</strong></span></div>
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
            options={['#4f8ef7', '#8b5cf6', '#22c55e', '#f97316', '#ec4899']}
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
