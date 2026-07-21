// account-pension.jsx — Retirement plan (BES) panels shown inside a "pension"-type
// account's detail on the Accounts page.
//
//   PensionSummary       — the figures off the BES Birikim Özeti statement
//                          (accounts.pension JSON column).
//   PensionContributions — the credit-card charges that funded the plan, matched
//                          by contract number.
//
// The fund split itself is NOT here: funds are ordinary Investment rows and reuse
// the shared AccountHoldings panel (see account-holdings.jsx).
(function () {
  const Icon = window.Icon;

  // Defined locally, matching accounts-components.jsx / account-holdings.jsx — the
  // Accounts page does not load components.jsx/LEDGER_FMT.
  function grp(v, dec = 2) { return Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
  const SYM = { TRY: '₺', USD: '$', EUR: '€' };
  const fmtDate = (iso) => { if (!iso) return '—'; const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : iso; };
  const money = (v, cur) => (v == null ? '—' : (v < 0 ? '−' : '') + SYM[cur || 'TRY'] + grp(v));

  // ── BES figures ───────────────────────────────────────────────────────────
  function PensionSummary({ account }) {
    const p = account.pension || {};
    const cur = account.cur || 'TRY';
    // Investment return is never stored — it is exactly what the statement calls
    // "Yatırım Getiriniz": total savings less the state's share less what you paid in.
    const ret = (account.balance != null && p.state_contribution != null && p.total_paid != null)
      ? +(account.balance - p.state_contribution - p.total_paid).toFixed(2)
      : null;

    const tiles = [
      { id: 'state',   k: 'State Contribution', v: money(p.state_contribution, cur), icon: 'landmark' },
      { id: 'paid',    k: 'Paid In',            v: money(p.total_paid, cur),         icon: 'arrow-down-to-line' },
      { id: 'return',  k: 'Return',             v: money(ret, cur),                  icon: 'trending-up',
        cls: ret == null ? '' : (ret < 0 ? 'neg' : 'pos') },
      { id: 'pending', k: 'Pending',            v: money(p.pending, cur),            icon: 'hourglass' },
    ];

    return (
      <div className="acct-pension" id="acct-pension-summary">
        <div className="detail-section-label acct-pension-head">
          <span><Icon name="piggy-bank" size={12} />Retirement Plan</span>
          {p.report_date && <span className="acct-pension-asof">as of {fmtDate(p.report_date)}</span>}
        </div>

        <div className="acct-pension-tiles">
          {tiles.map(t => (
            <div className="acct-pension-tile" id={'acct-pension-tile-' + t.id} key={t.id}>
              <span className="apt-k"><Icon name={t.icon} size={11} />{t.k}</span>
              <span className={'apt-v ' + (t.cls || '')}>{t.v}</span>
            </div>
          ))}
        </div>

        {(p.next_payment_date || p.next_payment_amount != null) && (
          <div className="acct-pension-next" id="acct-pension-next-payment">
            <span className="apn-k"><Icon name="calendar-clock" size={12} />Next Payment</span>
            <span className="apn-v">
              {fmtDate(p.next_payment_date)}
              {p.next_payment_amount != null && <span className="apn-amt"> · {money(p.next_payment_amount, cur)}</span>}
            </span>
          </div>
        )}

        <div className="acct-pension-meta">
          {p.contract_no && <span id="acct-pension-contract"><b>Contract</b> {p.contract_no}</span>}
          {p.plan && <span id="acct-pension-plan"><b>Plan</b> {p.plan}</span>}
          {p.start_date && <span id="acct-pension-start"><b>Started</b> {fmtDate(p.start_date)}</span>}
          {p.vesting_pct != null && <span id="acct-pension-vesting"><b>Vested</b> {grp(p.vesting_pct, 0)}%</span>}
        </div>
      </div>
    );
  }

  // ── Contributions charged to a card ───────────────────────────────────────
  // Matched at READ time on the contract number, which the bank writes into the
  // card line's description ("G.E. 17943452 İSTANBUL"). Deliberately not a stored
  // link: this way a card statement imported BEFORE the pension account existed
  // still shows up, with no backfill.
  function PensionContributions({ account }) {
    const contract = (account.pension || {}).contract_no;
    const [rows, setRows] = React.useState(null);   // null = loading
    const [error, setError] = React.useState(null);

    React.useEffect(() => {
      if (!contract) { setRows([]); return; }
      let alive = true;
      window.HL_ACCT_TX_API.listContributions(contract)
        .then(r => { if (alive) setRows(r); })
        .catch(e => { if (alive) { setError(e.message || 'Could not load contributions.'); setRows([]); } });
      return () => { alive = false; };
    }, [contract]);

    if (!contract) return null;

    const loading = rows === null;
    const list = rows || [];
    const total = list.reduce((s, r) => s + (r.amt || 0), 0);
    const paid = (account.pension || {}).total_paid;
    // Card charges can still be in provision ("Provizyonda Bekleyen Tutar") and not
    // yet folded into the BES balance, so a gap here is expected, not an error.
    const gap = paid != null ? +(paid - total).toFixed(2) : null;

    return (
      <div className="acct-pension-contrib" id="acct-pension-contributions">
        <div className="detail-section-label acct-pension-contrib-head">
          <span><Icon name="credit-card" size={12} />Contributions{list.length ? ' · ' + list.length : ''}</span>
        </div>

        {error && <div className="acct-holdings-error"><Icon name="alert-triangle" size={13} />{error}</div>}

        {loading ? (
          <div className="detail-empty"><Icon name="loader" size={22} /><span>Loading contributions…</span></div>
        ) : list.length === 0 ? (
          <div className="detail-empty">
            <Icon name="credit-card" size={26} />
            <span>No card charges found for contract {contract} yet.</span>
          </div>
        ) : (
          <React.Fragment>
            <div className="acct-holdings-total">
              <span className="ah-total-k">Total Contributed</span>
              <span className="ah-total-v">₺{grp(total)}</span>
            </div>
            <div className="acct-pension-contrib-list">
              {list.map(r => (
                <div className="apc-row" id={'apc-row-' + r.id} key={r.id}>
                  <span className="apc-date">{fmtDate(r.date)}</span>
                  <span className="apc-desc" title={r.desc}>{r.desc}</span>
                  <span className="apc-amt">{SYM[r.cur] || SYM.TRY}{grp(r.amt)}</span>
                </div>
              ))}
            </div>
            {gap != null && Math.abs(gap) >= 0.01 && (
              <span className="acct-pension-gap" id="acct-pension-gap">
                <Icon name="info" size={11} />
                Statement says {SYM.TRY}{grp(paid)} paid in — {SYM.TRY}{grp(Math.abs(gap))} {gap > 0 ? 'not yet matched to a card charge' : 'more charged than the statement shows'}.
              </span>
            )}
          </React.Fragment>
        )}
      </div>
    );
  }

  window.PensionSummary = PensionSummary;
  window.PensionContributions = PensionContributions;
})();
