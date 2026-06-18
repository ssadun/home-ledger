// dashboard-components.jsx — Hyper Ledger Dashboard widget components.
(function () {
  const Icon = window.Icon;
  const { CATS } = window.LEDGER;
  const { grp, MONTHS } = window.LEDGER_FMT;

  // ── Summary widget (single KPI card) ───────────────────────────────────
  function KpiCard({ label, icon, value, sub, cls, detail }) {
    return (
      <div className={'dash-kpi' + (cls ? ' ' + cls : '')}>
        <span className="dash-kpi-label"><Icon name={icon} size={13} />{label}</span>
        <span className="dash-kpi-value">{value}</span>
        {sub && <span className="dash-kpi-sub">{sub}</span>}
        {detail && <span className="dash-kpi-detail">{detail}</span>}
      </div>
    );
  }

  // ── Monthly Spend vs Budget bar chart (Jan–Dec) ────────────────────────
  function MonthlySpendVsBudgetChart({ data, title, icon, currentMonth }) {
    if (!data || data.length === 0) return null;
    const maxVal = Math.max(...data.map(d => Math.max(d.spend, d.budget)), 1);

    return (
      <div className="dash-widget">
        <div className="dash-widget-head">
          <Icon name={icon || 'bar-chart-3'} size={15} />
          <span className="dash-widget-title">{title}</span>
          <div className="dash-widget-legend">
            <span className="dash-wl-item"><span className="dash-wl-dot" style={{ background: 'var(--accent)' }} />Actual</span>
            <span className="dash-wl-item"><span className="dash-wl-dot" style={{ background: 'var(--accent)', opacity: 0.3 }} />Forecast</span>
            <span className="dash-wl-item"><span className="dash-wl-line" />Budget</span>
          </div>
        </div>
        <div className="dash-monthly-chart">
          {data.map((d, i) => {
            const spendH = maxVal > 0 ? (d.spend / maxVal) * 100 : 0;
            const budgetH = maxVal > 0 ? (d.budget / maxVal) * 100 : 0;
            const over = d.spend > d.budget && d.budget > 0;
            const isCurrent = i === currentMonth;
            return (
              <div className={'dash-mc-col' + (isCurrent ? ' current' : '') + (d.forecast ? ' forecast' : '')} key={i}>
                <div className="dash-mc-bars" title={d.label + ': ₺' + grp(d.spend, 0) + ' / ₺' + grp(d.budget, 0)}>
                  {/* budget marker line */}
                  <div className="dash-mc-budget-line" style={{ bottom: budgetH + '%' }} />
                  {/* spend bar */}
                  <div className={'dash-mc-bar' + (over ? ' over' : '') + (d.forecast ? ' fc' : '')}
                    style={{ height: spendH + '%' }}>
                  </div>
                </div>
                <span className="dash-mc-label">{d.label}</span>
                {d.spend > 0 && <span className="dash-mc-val">₺{grp(d.spend, 0)}</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Category annual forecast table ─────────────────────────────────────
  function CategoryForecastTable({ data, title, icon }) {
    if (!data || data.length === 0) return null;
    return (
      <div className="dash-widget">
        <div className="dash-widget-head">
          <Icon name={icon || 'list'} size={15} />
          <span className="dash-widget-title">{title}</span>
        </div>
        <div className="dash-cat-table">
          <div className="dash-ct-header">
            <span className="dash-ct-h cat">Category</span>
            <span className="dash-ct-h num">YTD Spend</span>
            <span className="dash-ct-h num">Foreseen EOY</span>
            <span className="dash-ct-h num">Annual Budget</span>
            <span className="dash-ct-h num">Status</span>
          </div>
          {data.map(d => {
            const over = d.forecastTotal > d.annualBudget;
            const pct = Math.round(d.pctUsed * 100);
            const statusCls = pct > 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
            return (
              <div className="dash-ct-row" key={d.cat}>
                <span className="dash-ct-cat">
                  <span className="dash-ct-ico" style={{ color: d.color, background: 'color-mix(in srgb, ' + d.color + ' 13%, transparent)', borderColor: 'color-mix(in srgb, ' + d.color + ' 40%, transparent)' }}>
                    <Icon name={d.icon} size={12} />
                  </span>
                  {d.label}
                </span>
                <div className="dash-ct-nums-row">
                  <span className="dash-ct-num" data-label="YTD Spend">₺{grp(d.ytdSpend, 0)}</span>
                  <span className={'dash-ct-num' + (over ? ' txt-over' : '')} data-label="Foreseen EOY">₺{grp(d.forecastTotal, 0)}</span>
                  <span className="dash-ct-num" data-label="Annual Budget">₺{grp(d.annualBudget, 0)}</span>
                </div>
                <span className={'dash-ct-status ' + statusCls}>
                  <span className="dash-ct-pct">{pct}%</span>
                  <div className="dash-ct-bar">
                    <div className={'dash-ct-fill ' + statusCls} style={{ width: Math.min(pct, 100) + '%' }} />
                  </div>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Cumulative spend vs budget area chart (SVG) ────────────────────────
  function CumulativeChart({ data, title, icon, currentMonth }) {
    if (!data || data.length === 0) return null;

    // Build cumulative actual and budget
    let cumSpend = 0, cumBudget = 0;
    const points = data.map((d, i) => {
      cumSpend += d.spend;
      cumBudget += d.budget;
      return { month: i, label: d.label, cumSpend, cumBudget, forecast: d.forecast };
    });

    const maxVal = Math.max(...points.map(p => Math.max(p.cumSpend, p.cumBudget)), 1);
    const w = 580, h = 200, px = 48, py = 20;
    const innerW = w - px * 2, innerH = h - py * 2;

    const xOf = (i) => px + (i / 11) * innerW;
    const yOf = (v) => py + innerH - (v / maxVal) * innerH;

    // Budget line
    const budgetLine = points.map((p, i) => (i === 0 ? 'M' : 'L') + xOf(i).toFixed(1) + ',' + yOf(p.cumBudget).toFixed(1)).join(' ');

    // Spend line (split into actual + forecast)
    const actualPts = points.filter(p => !p.forecast);
    const forecastPts = points.filter(p => p.forecast);
    // Include the last actual point in forecast line for continuity
    const forecastWithBridge = actualPts.length > 0
      ? [actualPts[actualPts.length - 1], ...forecastPts]
      : forecastPts;

    const actualLine = actualPts.map((p, i) => (i === 0 ? 'M' : 'L') + xOf(p.month).toFixed(1) + ',' + yOf(p.cumSpend).toFixed(1)).join(' ');
    const forecastLine = forecastWithBridge.map((p, i) => (i === 0 ? 'M' : 'L') + xOf(p.month).toFixed(1) + ',' + yOf(p.cumSpend).toFixed(1)).join(' ');

    // Area under actual spend
    const actualArea = actualPts.length > 0
      ? actualLine + ' L' + xOf(actualPts[actualPts.length - 1].month).toFixed(1) + ',' + (py + innerH) + ' L' + px + ',' + (py + innerH) + ' Z'
      : '';

    // Y-axis steps
    const ySteps = [0, 0.25, 0.5, 0.75, 1];

    return (
      <div className="dash-widget">
        <div className="dash-widget-head">
          <Icon name={icon || 'activity'} size={15} />
          <span className="dash-widget-title">{title}</span>
          <div className="dash-widget-legend">
            <span className="dash-wl-item"><span className="dash-wl-dot" style={{ background: 'var(--accent)' }} />Actual Spend</span>
            <span className="dash-wl-item"><span className="dash-wl-dot" style={{ background: 'var(--accent)', opacity: 0.3 }} />Forecast</span>
            <span className="dash-wl-item"><span className="dash-wl-line dash-wl-line-orange" />Budget</span>
          </div>
        </div>
        <div className="dash-cum-wrap">
          <svg viewBox={'0 0 ' + w + ' ' + h} className="dash-cum-svg" preserveAspectRatio="none">
            <defs>
              <linearGradient id="dashCumGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* grid */}
            {ySteps.map(f => {
              const y = yOf(f * maxVal);
              return <line key={f} x1={px} y1={y} x2={w - px} y2={y} stroke="var(--border)" strokeWidth="1" />;
            })}
            {/* Y labels */}
            {ySteps.filter(f => f > 0).map(f => {
              const y = yOf(f * maxVal);
              return <text key={f} x={px - 5} y={y + 3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--font-sans)">₺{grp(f * maxVal, 0)}</text>;
            })}
            {/* X labels */}
            {points.map((p, i) => (
              <text key={i} x={xOf(i)} y={h - 3} textAnchor="middle" fontSize="9" fill={p.forecast ? 'var(--border2)' : 'var(--muted)'} fontFamily="var(--font-sans)" fontWeight={i === currentMonth ? '700' : '400'}>{p.label}</text>
            ))}
            {/* Budget line */}
            <path d={budgetLine} fill="none" stroke="var(--orange)" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.55" />
            {/* Actual area */}
            {actualArea && <path d={actualArea} fill="url(#dashCumGrad)" />}
            {/* Actual line */}
            {actualLine && <path d={actualLine} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
            {/* Forecast line */}
            {forecastLine && forecastPts.length > 0 && <path d={forecastLine} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="6 4" opacity="0.4" />}
            {/* Current month dot */}
            {actualPts.length > 0 && (
              <circle cx={xOf(actualPts[actualPts.length - 1].month)} cy={yOf(actualPts[actualPts.length - 1].cumSpend)}
                r="4" fill="var(--accent)" stroke="var(--bg3)" strokeWidth="2" />
            )}
            {/* EOY forecast dot */}
            {forecastPts.length > 0 && (
              <circle cx={xOf(11)} cy={yOf(points[11].cumSpend)}
                r="3.5" fill="var(--accent)" stroke="var(--bg3)" strokeWidth="2" opacity="0.5" />
            )}
          </svg>
        </div>
      </div>
    );
  }

  Object.assign(window, {
    KpiCard, MonthlySpendVsBudgetChart,
    CategoryForecastTable, CumulativeChart
  });
})();
