// reports-components.jsx — Home Ledger chart & report widgets.
(function () {
  const Icon = window.Icon;
  const { CATS } = window.LEDGER;
  const { grp, MONTHS, fmtDate } = window.LEDGER_FMT;

  const PALETTE = [
    'var(--accent)', 'var(--green)', 'var(--orange)', 'var(--lavender)',
    'var(--coral)', 'var(--sky)', 'var(--yellow)', 'var(--pink)',
    'var(--emerald)', 'var(--fuchsia)', 'var(--red)', 'var(--mint)',
    'var(--gold)', 'var(--steel)', 'var(--rose)', 'var(--lime)'
  ];

  function pickColor(i) { return PALETTE[i % PALETTE.length]; }

  // ── Horizontal category bar chart ──────────────────────────────────────
  function CategoryBarChart({ data, title, icon }) {
    if (!data || data.length === 0) return null;
    const maxVal = Math.max(...data.map(d => d.value), 1);
    return (
      <div className="dash-widget">
        <div className="dash-widget-head">
          <Icon name={icon || 'bar-chart-3'} size={15} />
          <span className="dash-widget-title">{title}</span>
        </div>
        <div className="rpt-hbar-list">
          {data.map((d, i) => {
            const pct = maxVal > 0 ? (d.value / maxVal) * 100 : 0;
            const cat = CATS[d.key] || {};
            const color = cat.color || pickColor(i);
            return (
              <div className="rpt-hbar-row" key={d.key}>
                <span className="rpt-hbar-label">
                  <span className="rpt-hbar-ico" style={{ color: color, background: 'color-mix(in srgb, ' + color + ' 13%, transparent)', borderColor: 'color-mix(in srgb, ' + color + ' 40%, transparent)' }}>
                    <Icon name={cat.icon || 'circle'} size={11} />
                  </span>
                  {d.label}
                </span>
                <div className="rpt-hbar-track">
                  <div className="rpt-hbar-fill" style={{ width: pct + '%', background: color }} />
                </div>
                <span className="rpt-hbar-val">₺{grp(d.value, 0)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Donut chart (SVG) ──────────────────────────────────────────────────
  function DonutChart({ data, title, icon, centerLabel, centerValue }) {
    if (!data || data.length === 0) return null;
    const total = data.reduce((s, d) => s + d.value, 0);
    const r = 70, cx = 100, cy = 100, stroke = 22;
    const circ = 2 * Math.PI * r;
    let offset = 0;

    const arcs = data.map((d, i) => {
      const frac = total > 0 ? d.value / total : 0;
      const dashLen = frac * circ;
      const dashOff = -offset;
      offset += dashLen;
      const color = d.color || pickColor(i);
      return (
        <circle key={d.key} cx={cx} cy={cy} r={r} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={dashLen + ' ' + (circ - dashLen)}
          strokeDashoffset={dashOff}
          style={{ transition: 'stroke-dasharray .5s ease, stroke-dashoffset .5s ease' }} />
      );
    });

    return (
      <div className="dash-widget">
        <div className="dash-widget-head">
          <Icon name={icon || 'pie-chart'} size={15} />
          <span className="dash-widget-title">{title}</span>
        </div>
        <div className="rpt-donut-wrap">
          <svg viewBox="0 0 200 200" className="rpt-donut-svg">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
            <g transform={'rotate(-90 ' + cx + ' ' + cy + ')'}>{arcs}</g>
          </svg>
          <div className="rpt-donut-center">
            <span className="rpt-dc-label">{centerLabel}</span>
            <span className="rpt-dc-value">{centerValue}</span>
          </div>
        </div>
        <div className="rpt-donut-legend">
          {data.slice(0, 8).map((d, i) => {
            const color = d.color || pickColor(i);
            const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
            return (
              <span className="rpt-dl-item" key={d.key}>
                <span className="rpt-dl-dot" style={{ background: color }} />
                <span className="rpt-dl-name">{d.label}</span>
                <span className="rpt-dl-pct">{pct}%</span>
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Monthly income vs expense trend (grouped bars) ─────────────────────
  function MonthlyTrendChart({ data, title, icon }) {
    if (!data || data.length === 0) return null;
    const maxVal = Math.max(...data.map(d => Math.max(d.expense, d.income)), 1);
    return (
      <div className="dash-widget">
        <div className="dash-widget-head">
          <Icon name={icon || 'bar-chart-3'} size={15} />
          <span className="dash-widget-title">{title}</span>
          <div className="dash-widget-legend">
            <span className="dash-wl-item"><span className="dash-wl-dot" style={{ background: 'var(--green)' }} />Income</span>
            <span className="dash-wl-item"><span className="dash-wl-dot" style={{ background: 'var(--red)' }} />Expense</span>
          </div>
        </div>
        <div className="rpt-trend-chart">
          {data.map((d, i) => {
            const incH = maxVal > 0 ? (d.income / maxVal) * 100 : 0;
            const expH = maxVal > 0 ? (d.expense / maxVal) * 100 : 0;
            return (
              <div className="rpt-tc-col" key={i}>
                <div className="rpt-tc-bars">
                  <div className="rpt-tc-bar income" style={{ height: incH + '%' }}
                    title={'Income: ₺' + grp(d.income, 0)} />
                  <div className="rpt-tc-bar expense" style={{ height: expH + '%' }}
                    title={'Expense: ₺' + grp(d.expense, 0)} />
                </div>
                <span className="rpt-tc-label">{d.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Budget vs actual horizontal bars ───────────────────────────────────
  function BudgetVsActualChart({ data, title, icon }) {
    if (!data || data.length === 0) return null;
    const maxVal = Math.max(...data.map(d => Math.max(d.limit, d.actual)), 1);
    return (
      <div className="dash-widget">
        <div className="dash-widget-head">
          <Icon name={icon || 'target'} size={15} />
          <span className="dash-widget-title">{title}</span>
          <div className="dash-widget-legend">
            <span className="dash-wl-item"><span className="dash-wl-dot" style={{ background: 'var(--accent)' }} />Actual</span>
            <span className="dash-wl-item"><span className="dash-wl-dot" style={{ background: 'var(--accent)', opacity: 0.25 }} />Budget</span>
          </div>
        </div>
        <div className="rpt-bva-list">
          {data.map((d, i) => {
            const budgetPct = maxVal > 0 ? (d.limit / maxVal) * 100 : 0;
            const actualPct = maxVal > 0 ? (d.actual / maxVal) * 100 : 0;
            const over = d.actual > d.limit;
            const cat = CATS[d.cat] || {};
            const color = cat.color || 'var(--accent)';
            return (
              <div className="rpt-bva-row" key={d.cat}>
                <span className="rpt-bva-label">
                  <span className="rpt-bva-ico" style={{ color: color, background: 'color-mix(in srgb, ' + color + ' 13%, transparent)', borderColor: 'color-mix(in srgb, ' + color + ' 40%, transparent)' }}>
                    <Icon name={d.icon || 'circle'} size={11} />
                  </span>
                  {d.label}
                </span>
                <div className="rpt-bva-track">
                  <div className="rpt-bva-budget" style={{ width: budgetPct + '%' }} />
                  <div className={'rpt-bva-actual' + (over ? ' over' : '')}
                    style={{ width: actualPct + '%' }} />
                </div>
                <span className="rpt-bva-vals">
                  <span className={'rpt-bva-amt' + (over ? ' over' : '')}>₺{grp(d.actual, 0)}</span>
                  <span className="rpt-bva-lim">/ ₺{grp(d.limit, 0)}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Daily cumulative spend area chart (SVG) ────────────────────────────
  function DailySpendChart({ data, title, icon, budgetDailyAvg }) {
    if (!data || data.length === 0) return null;
    const maxCum = Math.max(...data.map(d => d.cumulative), 1);
    const budgetLine = budgetDailyAvg ? budgetDailyAvg : null;
    const maxVal = budgetLine ? Math.max(maxCum, budgetLine) * 1.1 : maxCum * 1.1;
    const days = data.length;
    const w = 580, h = 200, px = 48, py = 20;
    const innerW = w - px * 2, innerH = h - py * 2;
    const xOf = (d) => px + ((d - 1) / Math.max(days - 1, 1)) * innerW;
    const yOf = (v) => py + innerH - (v / maxVal) * innerH;

    const line = data.map((d, i) =>
      (i === 0 ? 'M' : 'L') + xOf(d.day).toFixed(1) + ',' + yOf(d.cumulative).toFixed(1)
    ).join(' ');

    const area = line +
      ' L' + xOf(data[data.length - 1].day).toFixed(1) + ',' + (py + innerH) +
      ' L' + px + ',' + (py + innerH) + ' Z';

    const ySteps = [0, 0.25, 0.5, 0.75, 1];
    const xLabels = data.filter(d => d.day === 1 || d.day % 5 === 0 || d.day === days);

    return (
      <div className="dash-widget">
        <div className="dash-widget-head">
          <Icon name={icon || 'activity'} size={15} />
          <span className="dash-widget-title">{title}</span>
          {budgetLine && (
            <div className="dash-widget-legend">
              <span className="dash-wl-item"><span className="dash-wl-dot" style={{ background: 'var(--accent)' }} />Spend</span>
              <span className="dash-wl-item"><span className="dash-wl-line dash-wl-line-orange" />Budget</span>
            </div>
          )}
        </div>
        <div className="dash-cum-wrap">
          <svg viewBox={'0 0 ' + w + ' ' + h} className="dash-cum-svg" preserveAspectRatio="none">
            <defs>
              <linearGradient id="rptDailyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ySteps.map(f => {
              const y = yOf(f * maxVal);
              return <line key={f} x1={px} y1={y} x2={w - px} y2={y} stroke="var(--border)" strokeWidth="1" />;
            })}
            {ySteps.filter(f => f > 0).map(f => {
              const y = yOf(f * maxVal);
              return <text key={f} x={px - 5} y={y + 3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--font-sans)">₺{grp(f * maxVal, 0)}</text>;
            })}
            {xLabels.map(d => (
              <text key={d.day} x={xOf(d.day)} y={h - 3} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-sans)">{d.day}</text>
            ))}
            {budgetLine && (
              <line x1={px} y1={yOf(budgetLine)} x2={w - px} y2={yOf(budgetLine)}
                stroke="var(--orange)" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.55" />
            )}
            <path d={area} fill="url(#rptDailyGrad)" />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {data.length > 0 && (
              <circle cx={xOf(data[data.length - 1].day)} cy={yOf(data[data.length - 1].cumulative)}
                r="4" fill="var(--accent)" stroke="var(--bg3)" strokeWidth="2" />
            )}
          </svg>
        </div>
      </div>
    );
  }

  // ── Top expenses table ─────────────────────────────────────────────────
  function TopExpensesTable({ data, title, icon }) {
    if (!data || data.length === 0) return null;
    return (
      <div className="dash-widget">
        <div className="dash-widget-head">
          <Icon name={icon || 'trophy'} size={15} />
          <span className="dash-widget-title">{title}</span>
        </div>
        <div className="rpt-top-list">
          {data.map((tx, i) => {
            const cat = CATS[tx.cat] || {};
            const color = cat.color || 'var(--accent)';
            return (
              <div className="rpt-top-row" key={tx.id || i}>
                <span className="rpt-top-rank">{i + 1}</span>
                <span className="rpt-top-ico" style={{ color: color, background: 'color-mix(in srgb, ' + color + ' 13%, transparent)', borderColor: 'color-mix(in srgb, ' + color + ' 40%, transparent)' }}>
                  <Icon name={cat.icon || 'circle'} size={11} />
                </span>
                <span className="rpt-top-desc" title={tx.desc}>{tx.desc}</span>
                <span className="rpt-top-date">{fmtDate(tx.date)}</span>
                <span className="rpt-top-amt">₺{grp(tx.tryV, 0)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Payer comparison chart ─────────────────────────────────────────────
  function PayerCompareChart({ data, title, icon }) {
    if (!data || data.length === 0) return null;
    const total = data.reduce((s, d) => s + d.total, 0);
    const PAYER_COLORS = { 'Sadun': 'var(--accent)', 'Handan': 'var(--lavender)' };
    return (
      <div className="dash-widget">
        <div className="dash-widget-head">
          <Icon name={icon || 'users'} size={15} />
          <span className="dash-widget-title">{title}</span>
        </div>
        <div className="rpt-payer-chart">
          <div className="rpt-payer-bar">
            {data.map(d => {
              const pct = total > 0 ? (d.total / total) * 100 : 0;
              const color = PAYER_COLORS[d.payer] || pickColor(0);
              return (
                <div key={d.payer} className="rpt-pb-seg"
                  style={{ width: pct + '%', background: color }}
                  title={d.payer + ': ₺' + grp(d.total, 0) + ' (' + Math.round(pct) + '%)'} />
              );
            })}
          </div>
          <div className="rpt-payer-legend">
            {data.map(d => {
              const pct = total > 0 ? Math.round((d.total / total) * 100) : 0;
              const color = PAYER_COLORS[d.payer] || pickColor(0);
              return (
                <div className="rpt-pl-item" key={d.payer}>
                  <span className="rpt-pl-dot" style={{ background: color }} />
                  <span className="rpt-pl-name">{d.payer}</span>
                  <span className="rpt-pl-val">₺{grp(d.total, 0)}</span>
                  <span className="rpt-pl-pct">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, {
    CategoryBarChart, DonutChart, MonthlyTrendChart,
    BudgetVsActualChart, DailySpendChart, TopExpensesTable,
    PayerCompareChart
  });
})();
