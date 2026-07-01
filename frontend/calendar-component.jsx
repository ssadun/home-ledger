// calendar-component.jsx — Home Ledger Calendar widget for Dashboard.
// Aggregates Spending TX, Account Activity TX, and Recurring due dates onto a month grid.
// Clicking a day shows event detail; clicking an event navigates to the source page.
(function () {
  const Icon = window.Icon;
  const { CATS, TX } = window.LEDGER;
  const { grp, fmtDate, dowOf, SYM, MONTHS } = window.LEDGER_FMT;

  /* ── Transaction-type legend ────────────────────────────────────────── */
  const CAL_TYPES = {
    income:        { label: 'Income',           color: 'var(--green)',    icon: 'arrow-down-left' },
    expense:       { label: 'Spending',         color: 'var(--coral)',    icon: 'arrow-up-right' },
    account:       { label: 'Account Activity', color: 'var(--accent)',   icon: 'landmark' },
    recurring:     { label: 'Upcoming Due',     color: 'var(--lavender)', icon: 'repeat' },
    creditPayment: { label: 'Card Payment',     color: 'var(--orange)',   icon: 'credit-card' },
  };
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* ── Build unified event map { dateStr → [...events] } ─────────────── */
  function buildEvents(year, month) {
    const map = {};
    const pfx = year + '-' + String(month + 1).padStart(2, '0');
    const add = (d, ev) => { (map[d] || (map[d] = [])).push(ev); };

    // 1. Spending TX
    // Data source: data.js → window.LEDGER.TX
    TX.forEach(tx => {
      if (!tx.date.startsWith(pfx)) return;
      const c = CATS[tx.cat] || {};
      add(tx.date, {
        source: tx.type === 'income' ? 'income' : 'expense',
        id: tx.id, desc: tx.desc, amount: tx.tryV, cur: tx.cur, rawAmt: tx.amt,
        catLabel: c.label || tx.cat, catIcon: c.icon || 'circle', catColor: c.color || 'var(--slate)',
        payer: tx.payer, paymentMethod: tx.paymentMethod,
        href: 'Spending.html?month=' + month + '&year=' + year + '&highlight=' + tx.id,
      });
    });

    // 2. Account Activity TX
    // Data source: account-tx-data.js → window.ACCT_TX_DATA
    if (window.ACCT_TX_DATA) {
      const { ACCT_TX, ACCT_TX_TYPES } = window.ACCT_TX_DATA;
      ACCT_TX.forEach(atx => {
        if (!atx.date.startsWith(pfx)) return;
        const t = ACCT_TX_TYPES[atx.txType] || {};
        add(atx.date, {
          source: 'account', id: atx.id, desc: atx.desc, amount: atx.tryV,
          cur: atx.cur, rawAmt: atx.amt, direction: atx.direction,
          accountName: atx.accountName,
          catLabel: t.label || atx.txType, catIcon: t.icon || 'landmark', catColor: t.color || 'var(--accent)',
          href: 'Account Activity.html?highlight=' + atx.id,
        });
      });
    }

    // 3. Recurring upcoming due dates (active items only)
    // Data source: recurring-data.js → window.RECURRING_DATA
    if (window.RECURRING_DATA) {
      const accts = (window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.ACCOUNTS) || [];
      window.RECURRING_DATA.RECURRING.forEach(rec => {
        if (rec.status !== 'active' || !rec.nextDue) return;
        if (!rec.nextDue.startsWith(pfx)) return;
        const c = CATS[rec.cat] || {};
        const pmAcct = accts.find(a => a.id === rec.paymentMethod);
        add(rec.nextDue, {
          source: 'recurring', id: rec.id, desc: rec.name + ' — Due',
          amount: rec.tryAmount, cur: rec.cur, rawAmt: rec.amount,
          catLabel: c.label || rec.cat, catIcon: 'repeat', catColor: 'var(--lavender)',
          payer: rec.payer,
          paymentMethod: pmAcct ? pmAcct.name : null,
          paymentMethodType: pmAcct ? pmAcct.type : null,
          href: 'Subscriptions.html?highlight=' + rec.id,
        });
      });
    }

    // 4. Credit-card statement payment due dates
    // Data source: credit-payments-data.js → window.CREDIT_PAYMENTS_DATA
    if (window.CREDIT_PAYMENTS_DATA) {
      window.CREDIT_PAYMENTS_DATA.RECORDS.forEach(rec => {
        if (!rec.paymentDate || !rec.paymentDate.startsWith(pfx)) return;
        add(rec.paymentDate, {
          source: 'creditPayment', id: rec.id, desc: (rec.name || 'Card Payment') + ' — Due',
          amount: rec.total, cur: rec.cur, rawAmt: rec.total,
          catLabel: rec.cardLabel || 'Credit Card', catIcon: 'credit-card', catColor: 'var(--orange)',
          paymentMethod: rec.cardLabel || null,
          href: 'Credit Payments.html?highlight=' + rec.id,
        });
      });
    }

    return map;
  }

  /* ── Compute calendar grid cells (Mon-start) ───────────────────────── */
  function gridDays(year, month) {
    const first = new Date(year, month, 1);
    const total = new Date(year, month + 1, 0).getDate();
    let dow = first.getDay() - 1; if (dow < 0) dow = 6;

    const out = [];
    const prevLast = new Date(year, month, 0).getDate();
    for (let i = dow - 1; i >= 0; i--) out.push({ day: prevLast - i, inMonth: false, date: null });
    for (let d = 1; d <= total; d++) {
      out.push({ day: d, inMonth: true, date: pfxDate(year, month, d) });
    }
    const rem = out.length % 7;
    if (rem) for (let i = 1; i <= 7 - rem; i++) out.push({ day: i, inMonth: false, date: null });
    return out;
  }
  function pfxDate(y, m, d) {
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  /* ── CalendarWidget ─────────────────────────────────────────────────── */
  function CalendarWidget({ initialYear, initialMonth }) {
    const now = window.LEDGER.TODAY || new Date();
    const [year, setYear]   = React.useState(initialYear != null ? initialYear : now.getFullYear());
    const [month, setMonth] = React.useState(initialMonth != null ? initialMonth : now.getMonth());
    const [sel, setSel]     = React.useState(null);

    const events = React.useMemo(() => buildEvents(year, month), [year, month]);
    const days   = React.useMemo(() => gridDays(year, month), [year, month]);
    const todayStr = pfxDate(now.getFullYear(), now.getMonth(), now.getDate());
    const selEvts  = sel && events[sel] ? events[sel] : [];

    let mInc = 0, mExp = 0, mCnt = 0;
    Object.values(events).forEach(arr => {
      arr.forEach(ev => { mCnt++; if (ev.source === 'income') mInc += ev.amount; else if (ev.source === 'expense') mExp += ev.amount; });
    });

    function step(d) {
      let m = month + d, y = year;
      if (m < 0)  { m = 11; y--; }
      if (m > 11) { m = 0;  y++; }
      setMonth(m); setYear(y); setSel(null);
    }

    function dots(dateStr) {
      const de = events[dateStr];
      return de ? [...new Set(de.map(e => e.source))] : [];
    }

    return (
      <div className="cal-layout">
        {/* ── Calendar grid card ── */}
        <div className="cal-card">
          <div className="cal-header">
            <button id="cal-prev-month-btn" className="cal-nav-btn" onClick={() => step(-1)} title="Previous Month"><Icon name="chevron-left" size={16} /></button>
            <div className="cal-header-center">
              <span className="cal-month-label">{MONTHS[month]} {year}</span>
              <span className="cal-month-sub">{mCnt} transaction{mCnt !== 1 ? 's' : ''}</span>
            </div>
            <button id="cal-next-month-btn" className="cal-nav-btn" onClick={() => step(1)} title="Next Month"><Icon name="chevron-right" size={16} /></button>
          </div>

          <div className="cal-summary">
            <span className="cal-chip income"><Icon name="arrow-down-left" size={11} />Income<b>₺{grp(mInc, 0)}</b></span>
            <span className="cal-chip expense"><Icon name="arrow-up-right" size={11} />Expense<b>₺{grp(mExp, 0)}</b></span>
          </div>

          <div className="cal-dow-row">{DOW.map(d => <span key={d} className="cal-dow">{d}</span>)}</div>

          <div className="cal-days">
            {days.map((d, i) => {
              const dd = d.date ? dots(d.date) : [];
              return (
                <button key={i}
                  id={'cal-day-' + (d.date || ('pad-' + i))}
                  className={'cal-day' + (!d.inMonth ? ' out' : '') + (d.date === todayStr ? ' today' : '') + (d.date === sel ? ' selected' : '') + (dd.length ? ' has-events' : '')}
                  onClick={() => d.inMonth && setSel(d.date === sel ? null : d.date)}
                  disabled={!d.inMonth}>
                  <span className="cal-day-num">{d.day}</span>
                  {dd.length > 0 && <span className="cal-dots">{dd.map(t => <span key={t} className={'cal-dot cal-dot-' + t} />)}</span>}
                </button>
              );
            })}
          </div>

          <div className="cal-legend">
            {Object.entries(CAL_TYPES).map(([k, v]) => (
              <span key={k} className="cal-legend-item"><span className={'cal-dot cal-dot-' + k} />{v.label}</span>
            ))}
          </div>
        </div>

        {/* ── Day detail panel ── */}
        <div className="cal-detail">
          {sel ? (
            <React.Fragment>
              <div className="cal-detail-head">
                <Icon name="calendar-days" size={15} />
                <span className="cal-detail-date">{fmtDate(sel)}</span>
                <span className="cal-detail-dow">{dowOf(sel)}</span>
                <span className="cal-detail-count">{selEvts.length} transaction{selEvts.length !== 1 ? 's' : ''}</span>
              </div>
              {selEvts.length > 0 ? (
                <div className="cal-events-list">
                  {selEvts.map((ev, i) => (
                    <a key={i} className="cal-event-row" href={ev.href}
                      title={'View in ' + (ev.source === 'account' ? 'Account Activity' : ev.source === 'recurring' ? 'Subscriptions' : ev.source === 'creditPayment' ? 'Credit Payments' : 'Spending')}>
                      <span className="cal-ev-icon" style={{
                        color: CAL_TYPES[ev.source].color,
                        background: 'color-mix(in srgb, ' + CAL_TYPES[ev.source].color + ' 12%, transparent)',
                        borderColor: 'color-mix(in srgb, ' + CAL_TYPES[ev.source].color + ' 35%, transparent)' }}>
                        <Icon name={ev.catIcon || CAL_TYPES[ev.source].icon} size={13} />
                      </span>
                      <div className="cal-ev-info">
                        <span className="cal-ev-desc">{ev.desc}</span>
                        <span className="cal-ev-meta">
                          <span className={'cal-ev-badge cal-badge-' + ev.source}>{CAL_TYPES[ev.source].label}</span>
                          {ev.payer && <span className="cal-ev-payer"><Icon name="user" size={9} />{ev.payer}</span>}
                          {ev.paymentMethod && (() => {
                            const pm = ev.paymentMethod;
                            const pmt = ev.paymentMethodType;
                            let icon = 'wallet', label = pm;
                            if (pm === 'credit-card') { icon = 'credit-card'; label = 'Credit Card'; }
                            else if (pm === 'debit-card') { icon = 'credit-card'; label = 'Debit Card'; }
                            else if (pm === 'cash') { icon = 'banknote'; label = 'Cash'; }
                            else if (pmt === 'credit' || pmt === 'debit') { icon = 'credit-card'; }
                            else if (pmt === 'bank') { icon = 'landmark'; }
                            return <span className="cal-ev-payer"><Icon name={icon} size={9} />{label}</span>;
                          })()}
                          {ev.accountName && <span className="cal-ev-acct"><Icon name="landmark" size={9} />{ev.accountName}</span>}
                        </span>
                      </div>
                      <div className="cal-ev-amount">
                        <span className={'cal-ev-val ' + (ev.source === 'income' || (ev.source === 'account' && ev.direction === 'incoming') ? 'income' : 'expense')}>
                          {ev.source === 'income' || (ev.source === 'account' && ev.direction === 'incoming') ? '+' : '−'}
                          {SYM[ev.cur] || '₺'}{grp(ev.rawAmt)}
                        </span>
                        <span className={'cur-badge cur-' + ev.cur}>{ev.cur}</span>
                      </div>
                      <span className="cal-ev-go"><Icon name="external-link" size={11} /></span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="cal-empty">
                  <Icon name="calendar-x2" size={28} />
                  <span className="et">No Transactions</span>
                  <span className="es">No recorded activity on this date.</span>
                </div>
              )}
            </React.Fragment>
          ) : (
            <div className="cal-empty">
              <Icon name="calendar-search" size={32} />
              <span className="et">Select A Day</span>
              <span className="es">Click any day to see its transactions and navigate to records.</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  window.CalendarWidget = CalendarWidget;
})();
