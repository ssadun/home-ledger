// calendar-component.jsx — Home Ledger Calendar widget for Dashboard.
// Aggregates Spending TX, Account Activity TX, and Recurring due dates onto a month grid.
// Clicking a day shows event detail; clicking an event opens a read-only/edit
// detail modal in place — the same modal each source page itself uses (tx-modal
// for Spending, rec-modal for Recurring, atx-detail-modal styling for
// Account Activity / credit-card due dates) — instead of navigating away.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { CATS, TX, FX } = window.LEDGER;
  const { TxModal, DeleteConfirm, RecModal } = window;

  // Credit-card colour follows the user's Account Types setting (Config → Account
  // Types → Credit Card), not a hardcoded orange. Falls back to orange if unset.
  const creditColor = () => (window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.ACCOUNT_TYPES
    && window.ACCOUNTS_DATA.ACCOUNT_TYPES.credit && window.ACCOUNTS_DATA.ACCOUNT_TYPES.credit.color) || 'var(--orange)';

  // TRY value for the month summary. Backend rows can arrive with amount_try = null,
  // so fall back to an FX conversion (TRY → toTRY 1) instead of summing nulls to zero.
  function toTRY(amt, cur) {
    const fx = FX && FX[cur];
    return fx && fx.toTRY != null ? +(amt * fx.toTRY).toFixed(2) : (amt || 0);
  }

  // Combined balance across every account (bank, credit, debit, cash, wallet,
  // investment) converted to TRY. Credit-card balances arrive negative
  // (negative balances), so the sum nets to the household's current total worth.
  // Live balances — not tied to the visible calendar month.
  function accountsTotalTRY() {
    return accountsList().reduce((sum, a) => {
      const fx = FX && FX[a.cur];
      const rate = fx && fx.toTRY != null ? fx.toTRY : 1;
      return sum + (a.balance || 0) * rate;
    }, 0);
  }
  const { grp, fmtDate, dowOf, SYM, MONTHS } = window.LEDGER_FMT;

  /* ── Transaction-type legend ────────────────────────────────────────── */
  const CAL_TYPES = {
    income:        { label: 'Income',           color: 'var(--green)',    icon: 'arrow-down-left' },
    expense:       { label: 'Spending',         color: 'var(--coral)',    icon: 'arrow-up-right' },
    account:       { label: 'Account Activity', color: 'var(--accent)',   icon: 'landmark' },
    recurring:     { label: 'Upcoming Due',     color: 'var(--lavender)', icon: 'repeat' },
  };
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* ── Payment-method resolution (accounts + literal methods) ─────────── */
  const LITERAL_PM = {
    'credit-card': 'Credit Card', 'debit-card': 'Debit Card',
    'cash': 'Cash', 'wallet': 'Wallet', 'bank': 'Bank Transfer',
  };
  const accountsList = () => (window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.ACCOUNTS) || [];

  // Normalise a raw payment-method value (account id/name or a literal) to a
  // stable { key, label }. Prefixed keys keep an account named "cash" ≠ literal "cash".
  function resolvePM(raw) {
    if (raw == null || raw === '') return null;
    const a = accountsList().find(x => x.id === raw || x._dbId === raw || x.name === raw);
    if (a) return { key: 'acct:' + a.id, label: a.name };
    if (LITERAL_PM[raw]) return { key: 'lit:' + raw, label: LITERAL_PM[raw] };
    return { key: 'raw:' + String(raw), label: String(raw) };
  }

  // Distinct payment methods across every calendar source (all months), so the
  // filter list stays stable as the user steps between months.
  function paymentMethodOptions() {
    const seen = new Map();
    const push = (raw) => { const p = resolvePM(raw); if (p && !seen.has(p.key)) seen.set(p.key, p); };
    ((window.LEDGER && window.LEDGER.TX) || []).forEach(t => push(t.paymentMethod));
    if (window.RECURRING_DATA) window.RECURRING_DATA.RECURRING.forEach(r => push(r.paymentMethod));
    if (window.CREDIT_PAYMENTS_DATA) window.CREDIT_PAYMENTS_DATA.RECORDS.forEach(r => push(r.accountKey || r.accountId || r.cardLabel));
    if (window.ACCT_TX_DATA) window.ACCT_TX_DATA.ACCT_TX.forEach(a => push(a.accountName));
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  /* ── Build unified event map { dateStr → [...events] } ─────────────── */
  // pmFilter: a resolvePM key ('' = all methods) restricting which events show.
  function buildEvents(year, month, pmFilter) {
    const map = {};
    const pfx = year + '-' + String(month + 1).padStart(2, '0');
    const add = (d, ev) => { (map[d] || (map[d] = [])).push(ev); };

    // 1. Spending TX
    // Data source: data.js → window.LEDGER.TX
    TX.forEach(tx => {
      if (!tx.date.startsWith(pfx)) return;
      const pm = resolvePM(tx.paymentMethod);
      if (pmFilter && (!pm || pm.key !== pmFilter)) return;
      const c = CATS[tx.cat] || {};
      add(tx.date, {
        // Credit-card-payment is a transfer, not new spending — show it as "Upcoming Due".
        source: tx.cat === 'credit-card-payment' ? 'recurring' : (tx.type === 'income' ? 'income' : 'expense'),
        id: tx.id, desc: tx.desc, amount: tx.tryV != null ? tx.tryV : toTRY(tx.amt, tx.cur), cur: tx.cur, rawAmt: tx.amt,
        catLabel: c.label || tx.cat, catIcon: c.icon || 'circle', catColor: c.color || 'var(--slate)',
        payer: tx.payer, payingFor: tx.payingFor, paymentMethod: tx.paymentMethod, pmKey: pm ? pm.key : null,
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
        const pm = resolvePM(atx.accountName);
        if (pmFilter && (!pm || pm.key !== pmFilter)) return;
        add(atx.date, {
          source: 'account', id: atx.id, desc: atx.desc, amount: atx.tryV,
          cur: atx.cur, rawAmt: atx.amt, direction: atx.direction,
          accountName: atx.accountName, pmKey: pm ? pm.key : null,
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
        const pm = resolvePM(rec.paymentMethod);
        if (pmFilter && (!pm || pm.key !== pmFilter)) return;
        add(rec.nextDue, {
          source: 'recurring', id: rec.id, desc: rec.name + ' - Due',
          amount: rec.tryAmount, cur: rec.cur, rawAmt: rec.amount,
          catLabel: c.label || rec.cat, catIcon: 'repeat', catColor: 'var(--lavender)',
          payer: rec.payer, payingFor: rec.payingFor,
          paymentMethod: pmAcct ? pmAcct.name : null,
          paymentMethodType: pmAcct ? pmAcct.type : null,
          pmKey: pm ? pm.key : null,
          href: 'Recurring.html?highlight=' + rec.id,
        });
      });
    }

    // 4. Credit-card statement payment due dates
    // Data source: credit-payments-data.js → window.CREDIT_PAYMENTS_DATA
    if (window.CREDIT_PAYMENTS_DATA) {
      window.CREDIT_PAYMENTS_DATA.RECORDS.forEach(rec => {
        if (!rec.paymentDate || !rec.paymentDate.startsWith(pfx)) return;
        const pm = resolvePM(rec.accountKey || rec.accountId || rec.cardLabel);
        if (pmFilter && (!pm || pm.key !== pmFilter)) return;
        add(rec.paymentDate, {
          // Merged into "Upcoming Due" (recurring); keeps the credit-card icon + Credit Payments link.
          source: 'recurring', id: rec.id, desc: (rec.name || 'Card Payment') + ' - Due',
          amount: rec.total, cur: rec.cur, rawAmt: rec.total,
          catLabel: rec.cardLabel || 'Credit Card', catIcon: 'credit-card', catColor: creditColor(),
          // Payment Method chip shows the account name (resolved), not the composite card label.
          paymentMethod: pm ? pm.label : (rec.cardLabel || null), pmKey: pm ? pm.key : null,
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

  /* ── Event detail modal — routes each event to the modal its own source
     page would show, instead of navigating away from the Dashboard ──────── */
  function pageLabelOf(href) {
    if (!href) return 'Source';
    if (href.startsWith('Credit Payments')) return 'Credit Payments';
    if (href.startsWith('Account Activity')) return 'Account Activity';
    if (href.startsWith('Recurring')) return 'Recurring';
    return 'Spending';
  }

  // Expense / Income — the real Spending edit form (tx-modal), wired to the
  // same HL_SPENDING_API every other page uses; an edit made here sticks
  // exactly like one made from the Spending page. Reloads on success so the
  // whole Dashboard (totals, chips, this same calendar) reflects it.
  function CalTxBridge({ tx, onClose }) {
    const [del, setDel] = React.useState(null);
    async function save(saved) {
      try {
        await window.HL_OP_NOTIFY.promise(
          window.HL_SPENDING_API.update(saved.id, saved),
          { pending: 'Updating transaction...', success: 'Transaction updated.', error: false }
        );
        window.location.reload();
      } catch (e) {
        window.HL_OP_NOTIFY.show('Could not update transaction: ' + ((e && e.message) || e), { type: 'error', timeout: 4200 });
      }
    }
    async function confirmDel() {
      try {
        await window.HL_OP_NOTIFY.promise(
          window.HL_SPENDING_API.remove(del.id),
          { pending: 'Deleting transaction...', success: 'Transaction deleted.', error: false }
        );
        window.location.reload();
      } catch (e) {
        window.HL_OP_NOTIFY.show('Could not delete transaction: ' + ((e && e.message) || e), { type: 'error', timeout: 4200 });
      }
    }
    return (
      <React.Fragment>
        <TxModal initial={tx} onClose={onClose} onSave={save} onDelete={setDel} />
        {del && <DeleteConfirm tx={del} onClose={() => setDel(null)} onConfirm={confirmDel} />}
      </React.Fragment>
    );
  }

  // Recurring "Upcoming Due" — the real Recurring edit form (rec-modal),
  // wired to HL_RECURRING_API. Only used when the event is backed by an
  // actual RecurringExpense record — a credit-card statement due date shares
  // the same "Upcoming Due" badge but has no such record (falls through to
  // CalReadOnlyDetail below instead).
  function CalRecBridge({ rec, onClose }) {
    const [del, setDel] = React.useState(null);
    async function save(saved) {
      try {
        await window.HL_OP_NOTIFY.promise(
          window.HL_RECURRING_API.update(saved.id, saved),
          { pending: 'Updating recurring item...', success: 'Recurring item updated.', error: false }
        );
        window.location.reload();
      } catch (e) {
        window.HL_OP_NOTIFY.show('Could not update recurring item: ' + ((e && e.message) || e), { type: 'error', timeout: 4200 });
      }
    }
    async function confirmDel() {
      try {
        await window.HL_OP_NOTIFY.promise(
          window.HL_RECURRING_API.remove(del.id),
          { pending: 'Deleting recurring item...', success: 'Recurring item deleted.', error: false }
        );
        window.location.reload();
      } catch (e) {
        window.HL_OP_NOTIFY.show('Could not delete recurring item: ' + ((e && e.message) || e), { type: 'error', timeout: 4200 });
      }
    }
    return (
      <React.Fragment>
        <RecModal initial={rec} onClose={onClose} onSave={save} onDelete={setDel} />
        {del && <DeleteConfirm tx={del} onClose={() => setDel(null)} onConfirm={confirmDel} />}
      </React.Fragment>
    );
  }

  // Account Activity + credit-card due-date fallback — both are read-only
  // from the calendar (their edit forms live only on their own page, which
  // isn't loaded on the Dashboard), so this mirrors Account Activity's own
  // read-only atx-detail-modal chrome/classes rather than pulling in that
  // whole page.
  function CalReadOnlyDetail({ ev, date, onClose }) {
    const isIn = ev.source === 'income' || (ev.source === 'account' && ev.direction === 'incoming');
    const pm = ev.paymentMethod ? resolvePM(ev.paymentMethod) : null;
    return (
      <div className="backdrop" onMouseDown={(e) => { if (e.target.classList.contains('backdrop')) onClose(); }}>
        <div className="modal atx-detail-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name={ev.catIcon || CAL_TYPES[ev.source].icon} size={17} />{ev.desc}</span>
              <span className="modal-sub">{fmtDate(date)} {dowOf(date)}</span>
            </div>
            <button className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>
          <div className="modal-body">
            <div className="detail-balance-hero">
              <span className="detail-bal-label">{isIn ? 'Received' : 'Amount'}</span>
              <span className={'atx-detail-amt ' + (isIn ? 'income' : 'expense')}>
                {isIn ? '+' : '−'}{SYM[ev.cur] || '₺'}{grp(ev.rawAmt)}
              </span>
            </div>
            <div className="detail-info-grid">
              <div className="detail-info-item">
                <span className="detail-info-k">Type</span>
                <span className="detail-info-v">{CAL_TYPES[ev.source].label}</span>
              </div>
              {ev.catLabel && (
                <div className="detail-info-item">
                  <span className="detail-info-k">Category</span>
                  <span className="detail-info-v">{ev.catLabel}</span>
                </div>
              )}
              {ev.accountName && (
                <div className="detail-info-item">
                  <span className="detail-info-k">Account</span>
                  <span className="detail-info-v">{ev.accountName}</span>
                </div>
              )}
              {pm && (
                <div className="detail-info-item">
                  <span className="detail-info-k">Payment Method</span>
                  <span className="detail-info-v">{pm.label}</span>
                </div>
              )}
              {ev.payer && (
                <div className="detail-info-item">
                  <span className="detail-info-k">Payer</span>
                  <span className="detail-info-v">{ev.payer}</span>
                </div>
              )}
              {ev.payingFor && (
                <div className="detail-info-item">
                  <span className="detail-info-k">Paying For</span>
                  <span className="detail-info-v">{ev.payingFor}</span>
                </div>
              )}
            </div>
          </div>
          <div className="modal-foot">
            <a className="amb ok" style={{ textDecoration: 'none' }} href={ev.href}>
              <Icon name="external-link" size={14} />View in {pageLabelOf(ev.href)}
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Routes a clicked cal-event-row to whichever of the above the event's
  // source actually supports.
  function CalEventDetailModal({ ev, date, onClose }) {
    if (ev.source === 'expense' || ev.source === 'income') {
      const txRecord = TX.find(t => t.id === ev.id);
      if (txRecord) return <CalTxBridge tx={txRecord} onClose={onClose} />;
    }
    if (ev.source === 'recurring') {
      const recRecord = window.RECURRING_DATA && window.RECURRING_DATA.RECURRING.find(r => r.id === ev.id);
      if (recRecord) return <CalRecBridge rec={recRecord} onClose={onClose} />;
    }
    return <CalReadOnlyDetail ev={ev} date={date} onClose={onClose} />;
  }

  /* ── CalendarWidget ─────────────────────────────────────────────────── */
  function CalendarWidget({ initialYear, initialMonth }) {
    // Open on the real current month (production data is current); the mock
    // LEDGER.TODAY is a dev-only fixture and would pin this to a stale month.
    const now = new Date();
    const initY = initialYear != null ? initialYear : now.getFullYear();
    const initM = initialMonth != null ? initialMonth : now.getMonth();
    const [year, setYear]   = React.useState(initY);
    const [month, setMonth] = React.useState(initM);
    // Pre-select today on load so its transactions show immediately (only when
    // the calendar opens on the current month — otherwise today isn't in view).
    const [sel, setSel]     = React.useState(
      (initY === now.getFullYear() && initM === now.getMonth())
        ? pfxDate(now.getFullYear(), now.getMonth(), now.getDate())
        : null
    );
    const [pm, setPm]       = React.useState('');   // '' = all payment methods
    // Event selected for its detail modal (opened by clicking a cal-event-row) —
    // routed per-source by CalEventDetailModal; replaces the old direct
    // navigate-away-on-click behaviour.
    const [detailEv, setDetailEv] = React.useState(null);

    const pmOptions = React.useMemo(() => paymentMethodOptions(), []);
    const events = React.useMemo(() => buildEvents(year, month, pm), [year, month, pm]);
    const days   = React.useMemo(() => gridDays(year, month), [year, month]);
    const todayStr = pfxDate(now.getFullYear(), now.getMonth(), now.getDate());
    const selEvts  = sel && events[sel] ? events[sel] : [];

    let mInc = 0, mExp = 0, mCnt = 0;
    // Per-person "Paying For" totals for the visible month — same expense/
    // recurring pool as the Expense chip (so the two numbers can never
    // contradict each other) and the same payment-method filter. Account
    // Activity and Credit-Payment-due events carry no payingFor (no single
    // beneficiary), so they're naturally excluded rather than special-cased.
    const pfMap = {};
    Object.values(events).forEach(arr => {
      arr.forEach(ev => {
        mCnt++;
        if (ev.source === 'income') mInc += ev.amount;
        else if (ev.source === 'expense' || ev.source === 'recurring') {
          mExp += ev.amount;
          const key = ev.payingFor;
          if (key && key !== '–') pfMap[key] = (pfMap[key] || 0) + ev.amount;
        }
      });
    });
    const payingForData = Object.entries(pfMap)
      .map(([payingFor, total]) => ({ payingFor, total }))
      .sort((a, b) => b.total - a.total);

    // Live combined balance across all accounts (independent of the shown month).
    const acctTotal = accountsTotalTRY();
    const acctCount = accountsList().length;

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

    const acctTotalTone = acctTotal > 0 ? ' income' : (acctTotal < 0 ? ' expense' : '');
    // Same color resolution as PayingForCell (components.jsx): per-member
    // color configured on Configuration -> Members; 'Shared' stays a fixed
    // neutral since a household expense has no single owner.
    function pfColor(name) {
      if (name === 'Shared') return 'var(--slate)';
      const colors = (window.LEDGER && window.LEDGER.PAYER_COLORS) || {};
      return colors[name] || 'var(--accent)';
    }

    return (
      <React.Fragment>
        <div className="cal-layout">
          {/* ── Left column: Total Balance chip + calendar grid card ── */}
          <div className="cal-col">
          {acctCount > 0 && (
            <span className={'cal-total-chip cal-chip' + acctTotalTone}>
              <Icon name="wallet" size={13} />
              <span className="cal-total-label">Total Balance</span>
              <span className="cal-total-sub">({acctCount} account{acctCount !== 1 ? 's' : ''})</span>
              <b>{acctTotal < 0 ? '−₺' : '₺'}{grp(Math.abs(acctTotal), 0)}</b>
            </span>
          )}
          <div className="cal-card">
          {pmOptions.length > 0 && (
            <div className="cal-filter">
              <span className="filter-label"><Icon name="wallet" size={11} />Payment Method</span>
              <div className="select-wrap">
                <StyledSelect id="cal-pm-filter" className="sel" value={pm}
                  onChange={(e) => { setPm(e.target.value); setSel(null); }}>
                  <option value="">All Methods</option>
                  {pmOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </StyledSelect>
              </div>
            </div>
          )}
          <div className="cal-header">
            <button id="cal-prev-month-btn" className="cal-nav-btn" onClick={() => step(-1)} title="Previous Month"><Icon name="chevron-left" size={16} /></button>
            <div className="cal-header-center">
              <span className="cal-month-label">{MONTHS[month]} {year}</span>
              <span className="cal-month-sub">{mCnt} transaction{mCnt !== 1 ? 's' : ''}</span>
            </div>
            <button id="cal-next-month-btn" className="cal-nav-btn" onClick={() => step(1)} title="Next Month"><Icon name="chevron-right" size={16} /></button>
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
          </div>

          {/* ── Right column: Income/Expense chips + day detail panel ── */}
          <div className="cal-col">
          <div className="cal-summary">
            <span className="cal-chip income"><Icon name="arrow-down-left" size={11} />Income<b>₺{grp(mInc, 0)}</b></span>
            <span className="cal-chip expense"><Icon name="arrow-up-right" size={11} />Expense<b>₺{grp(mExp, 0)}</b></span>
          </div>
          {payingForData.length > 0 && (
            <div className="cal-pf-wrap">
              <span className="filter-label"><Icon name="users" size={11} />Paying For ({MONTHS[month]})</span>
              <div className="cal-payingfor">
                {payingForData.map(p => (
                  <span key={p.payingFor} className="cal-pf-chip" style={{ '--payer': pfColor(p.payingFor) }}>
                    <Icon name={p.payingFor === 'Shared' ? 'users' : 'user'} size={11} />
                    {p.payingFor}
                    <b>₺{grp(p.total, 0)}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
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
                    <button key={i} type="button" className="cal-event-row" onClick={() => setDetailEv(ev)}
                      title="View details">
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
                          {ev.paymentMethod && (() => {
                            // Show only the account name (resolved label) — no icon.
                            const pm = resolvePM(ev.paymentMethod);
                            return <span className="cal-ev-payer">{pm ? pm.label : ev.paymentMethod}</span>;
                          })()}
                          {ev.accountName && <span className="cal-ev-acct"><Icon name="landmark" size={9} />{ev.accountName}</span>}
                        </span>
                      </div>
                      <div className="cal-ev-amount">
                        <span className={'cal-ev-val ' + (ev.source === 'income' || (ev.source === 'account' && ev.direction === 'incoming') ? 'income' : 'expense')}>
                          {ev.source === 'income' || (ev.source === 'account' && ev.direction === 'incoming') ? '+' : '−'}
                          {SYM[ev.cur] || '₺'}{grp(ev.rawAmt)}
                        </span>
                      </div>
                      <span className="cal-ev-go"><Icon name="chevron-right" size={13} /></span>
                    </button>
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
          </div>
          {detailEv && <CalEventDetailModal ev={detailEv} date={sel} onClose={() => setDetailEv(null)} />}
      </React.Fragment>
    );
  }

  window.CalendarWidget = CalendarWidget;
})();
