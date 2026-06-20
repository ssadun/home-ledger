// reports-data.js — Home Ledger Reports data aggregation helpers.
(function () {
  const { CATS } = window.LEDGER;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ── Expense totals grouped by category for a single month ──────────────
  function spendByCat(TX, year, month) {
    const prefix = year + '-' + String(month + 1).padStart(2, '0');
    const result = {};
    TX.forEach(tx => {
      if (tx.type !== 'expense') return;
      if (!tx.date.startsWith(prefix)) return;
      result[tx.cat] = (result[tx.cat] || 0) + tx.tryV;
    });
    return result;
  }

  // ── Income totals grouped by category for a single month ───────────────
  function incomeByCat(TX, year, month) {
    const prefix = year + '-' + String(month + 1).padStart(2, '0');
    const result = {};
    TX.forEach(tx => {
      if (tx.type !== 'income') return;
      if (!tx.date.startsWith(prefix)) return;
      result[tx.cat] = (result[tx.cat] || 0) + tx.tryV;
    });
    return result;
  }

  // ── Monthly income + expense totals for N consecutive months ───────────
  function monthlyTotals(TX, startYear, startMonth, count) {
    const result = [];
    let y = startYear, m = startMonth;
    for (let i = 0; i < count; i++) {
      const prefix = y + '-' + String(m + 1).padStart(2, '0');
      let expense = 0, income = 0;
      TX.forEach(tx => {
        if (!tx.date.startsWith(prefix)) return;
        if (tx.type === 'expense') expense += tx.tryV;
        else if (tx.type === 'income') income += tx.tryV;
      });
      result.push({ label: MONTHS[m], month: m, year: y, expense, income });
      m++;
      if (m > 11) { m = 0; y++; }
    }
    return result;
  }

  // ── Spend grouped by payer for a month ─────────────────────────────────
  function spendByPayer(TX, year, month) {
    const prefix = year + '-' + String(month + 1).padStart(2, '0');
    const map = {};
    TX.forEach(tx => {
      if (tx.type !== 'expense') return;
      if (!tx.date.startsWith(prefix)) return;
      map[tx.payer] = (map[tx.payer] || 0) + tx.tryV;
    });
    return Object.entries(map)
      .map(([payer, total]) => ({ payer, total }))
      .sort((a, b) => b.total - a.total);
  }

  // ── Top N largest expense transactions for a month ─────────────────────
  function topExpenses(TX, year, month, limit) {
    const prefix = year + '-' + String(month + 1).padStart(2, '0');
    return TX
      .filter(tx => tx.type === 'expense' && tx.date.startsWith(prefix))
      .sort((a, b) => b.tryV - a.tryV)
      .slice(0, limit);
  }

  // ── Daily cumulative spending for a month ──────────────────────────────
  function dailyCumulative(TX, year, month) {
    const prefix = year + '-' + String(month + 1).padStart(2, '0');
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dailySpend = new Array(daysInMonth).fill(0);
    TX.forEach(tx => {
      if (tx.type !== 'expense') return;
      if (!tx.date.startsWith(prefix)) return;
      const day = parseInt(tx.date.substring(8, 10), 10);
      dailySpend[day - 1] += tx.tryV;
    });
    const cumulative = [];
    let running = 0;
    for (let d = 0; d < daysInMonth; d++) {
      running += dailySpend[d];
      cumulative.push({ day: d + 1, daily: dailySpend[d], cumulative: running });
    }
    return cumulative;
  }

  // ── Budget vs actual for each budgeted category in a month ─────────────
  function budgetVsActual(TX, BUDGETS, year, month) {
    const prefix = year + '-' + String(month + 1).padStart(2, '0');
    const viewIdx = year * 12 + month;
    const idxOf = (iso) => {
      if (!iso) return null;
      const parts = iso.split('-');
      return (+parts[0]) * 12 + (+parts[1] - 1);
    };
    const result = [];
    Object.keys(BUDGETS).forEach(cat => {
      const b = BUDGETS[cat];
      const c = CATS[cat] || {};
      const startIdx = b.start ? idxOf(b.start) : null;
      const endIdx   = b.end   ? idxOf(b.end)   : null;
      const afterStart = startIdx === null || viewIdx >= startIdx;
      const beforeEnd  = endIdx   === null || viewIdx <= endIdx;
      if (!afterStart || !beforeEnd) return;

      let actual = 0;
      TX.forEach(tx => {
        if (tx.type !== 'expense' || tx.cat !== cat) return;
        if (!tx.date.startsWith(prefix)) return;
        actual += tx.tryV;
      });
      result.push({
        cat,
        label: c.label || cat,
        icon:  c.icon  || 'circle',
        color: c.color || 'var(--accent)',
        limit: b.limit,
        actual
      });
    });
    return result.sort((a, b) => b.actual - a.actual);
  }

  window.REPORTS = {
    spendByCat, incomeByCat, monthlyTotals, spendByPayer,
    topExpenses, dailyCumulative, budgetVsActual
  };
})();
