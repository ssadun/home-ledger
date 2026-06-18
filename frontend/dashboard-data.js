// dashboard-data.js — Hyper Ledger Dashboard aggregation & forecast logic.
(function () {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ── Budget limit for a given month (sum of active categories) ──────────
  function budgetForMonth(budgets, year, month) {
    const viewIdx = year * 12 + month;
    let total = 0;
    Object.keys(budgets).forEach(cat => {
      const b = budgets[cat];
      const idxOf = (iso) => { if (!iso) return null; const [y, m] = iso.split('-'); return (+y) * 12 + (+m - 1); };
      const startIdx = b.start ? idxOf(b.start) : null;
      const endIdx = b.end ? idxOf(b.end) : null;
      // active if: no start or viewIdx >= startIdx, AND no end or viewIdx <= endIdx
      const afterStart = startIdx === null || viewIdx >= startIdx;
      const beforeEnd = endIdx === null || viewIdx <= endIdx;
      if (afterStart && beforeEnd) total += b.limit;
    });
    return total;
  }

  // ── Actual expense total for a month ───────────────────────────────────
  function actualSpendMonth(txList, year, month) {
    const prefix = year + '-' + String(month + 1).padStart(2, '0');
    let total = 0;
    txList.forEach(tx => {
      if (tx.type !== 'expense') return;
      if (!tx.date.startsWith(prefix)) return;
      total += tx.tryV;
    });
    return total;
  }

  // ── Actual income total for a month ────────────────────────────────────
  function actualIncomeMonth(txList, year, month) {
    const prefix = year + '-' + String(month + 1).padStart(2, '0');
    let total = 0;
    txList.forEach(tx => {
      if (tx.type !== 'income') return;
      if (!tx.date.startsWith(prefix)) return;
      total += tx.tryV;
    });
    return total;
  }

  // ── Build full-year monthly data (actual + budget + forecast) ──────────
  // currentMonth is 0-indexed (0 = Jan). Months up to and including
  // currentMonth have actual data; months after are forecasted.
  function buildYearData(txList, budgets, year, currentMonth) {
    const rows = [];
    let actualMonths = [];

    // First pass: compute actuals for months up to currentMonth
    for (let m = 0; m <= currentMonth; m++) {
      const spend = actualSpendMonth(txList, year, m);
      const income = actualIncomeMonth(txList, year, m);
      const budget = budgetForMonth(budgets, year, m);
      rows.push({ month: m, label: MONTHS[m], spend, income, budget, forecast: false });
      if (spend > 0) actualMonths.push(spend);
    }

    // Average monthly spend from months that have data
    const avgSpend = actualMonths.length > 0
      ? actualMonths.reduce((s, v) => s + v, 0) / actualMonths.length
      : 0;

    // Second pass: forecast future months
    for (let m = currentMonth + 1; m < 12; m++) {
      const budget = budgetForMonth(budgets, year, m);
      rows.push({ month: m, label: MONTHS[m], spend: avgSpend, income: 0, budget, forecast: true });
    }

    return rows;
  }

  // ── Category-level YTD + forecast ──────────────────────────────────────
  function categoryYTDForecast(txList, budgets, cats, year, currentMonth) {
    const results = [];
    Object.keys(budgets).forEach(cat => {
      const b = budgets[cat];
      const c = cats[cat] || {};
      let ytdSpend = 0;
      let ytdBudget = 0;
      let monthsWithSpend = 0;

      // YTD actuals (Jan through currentMonth)
      for (let m = 0; m <= currentMonth; m++) {
        const prefix = year + '-' + String(m + 1).padStart(2, '0');
        let monthSpend = 0;
        txList.forEach(tx => {
          if (tx.type !== 'expense' || tx.cat !== cat) return;
          if (!tx.date.startsWith(prefix)) return;
          monthSpend += tx.tryV;
        });
        ytdSpend += monthSpend;
        ytdBudget += budgetForMonth({ [cat]: b }, year, m);
        if (monthSpend > 0) monthsWithSpend++;
      }

      const avgMonthly = monthsWithSpend > 0 ? ytdSpend / monthsWithSpend : 0;

      // Forecast remaining months
      let forecastRemaining = 0;
      let budgetRemaining = 0;
      for (let m = currentMonth + 1; m < 12; m++) {
        forecastRemaining += avgMonthly;
        budgetRemaining += budgetForMonth({ [cat]: b }, year, m);
      }

      const annualBudget = ytdBudget + budgetRemaining;
      const forecastTotal = ytdSpend + forecastRemaining;

      results.push({
        cat,
        label: c.label || cat,
        icon: c.icon || 'circle',
        color: c.color || 'var(--accent)',
        ytdSpend,
        ytdBudget,
        annualBudget,
        forecastTotal,
        avgMonthly,
        pctUsed: annualBudget > 0 ? forecastTotal / annualBudget : 0
      });
    });

    return results.sort((a, b) => b.pctUsed - a.pctUsed);
  }

  window.DASHBOARD = {
    MONTHS, budgetForMonth, actualSpendMonth, actualIncomeMonth,
    buildYearData, categoryYTDForecast
  };
})();
