// accounts-components.jsx — Home Ledger Accounts page components.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  // Project rule: every date field renders through the shared DateInput (never a
  // raw <input type="date">) — one implementation, in date-input.jsx.
  const DateInput = window.DateInput;
  const { ACCOUNT_TYPES, FINANCIAL_INSTITUTIONS, FX } = window.ACCOUNTS_DATA;
  const { maskCardNumber, cleanIban, cleanAccountNo, cleanCardNo } = window.HL_ACCOUNTS_API;
  function displayNumber(account) {
    return (account.type === 'credit' || account.type === 'debit') ? maskCardNumber(account.number) : account.number;
  }

  // Join metadata bits with " · ", dropping the ones that are unset — the API
  // layer stores '–' for a blank field (accounts-data.js), so a missing value
  // must not leave a dangling separator ("ON Dijital Bankacılık · –").
  function joinMeta(...parts) {
    return parts.filter((p) => p && p !== '–').join(' · ');
  }

  function grp(v, dec = 2) {
    return Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  const SYM = { TRY: '₺', USD: '$', EUR: '€' };
  const fmtDate = (iso) => {const [y, m, d] = iso.split('-');return `${d}.${m}.${y}`;};

  // Resolve an account's institution logo (set per-institution on the Config →
  // Financial Institutions screen). Returns a URL / data-URI, or null to fall back
  // to the generic account-type icon. Matched by institution name.
  // Matched on the TRIMMED name: the Accounts form saves `institution` trimmed, so
  // an institution whose configured name carries stray whitespace would otherwise
  // never match and would silently lose its logo.
  function instName(fi) {
    return String((fi && fi.name) || '').trim();
  }

  function instLogo(institution) {
    if (!institution || institution === '–') return null;
    const map = (window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.FINANCIAL_INSTITUTIONS) || {};
    const wanted = String(institution).trim();
    const hit = Object.values(map).find((fi) => fi && instName(fi) === wanted);
    return hit && hit.logo ? hit.logo : null;
  }

  // ── Statement cutoff & payment date helpers ──
  const WEEK_LABELS = { 1: '1st Week', 2: '2nd Week', 3: '3rd Week', 4: '4th Week' };

  // Last working day (Mon-Fri) of the Nth week range of a given month
  // Week 1 = days 1–7, Week 2 = days 8–14, Week 3 = days 15–21, Week 4 = days 22–28
  function getStatementCutoffDate(year, month, week) {
    const endDay = week * 7;
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    let d = new Date(year, month, Math.min(endDay, lastDayOfMonth));
    // Walk backwards to find last working day (Mon-Fri) in this week range
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() - 1);
    }
    return d;
  }

  // Payment date = cutoff + 10 calendar days, adjusted to next working day if on weekend
  function getPaymentDate(cutoffDate) {
    let d = new Date(cutoffDate);
    d.setDate(d.getDate() + 10);
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  }

  // Inverse of the cutoff→payment model above: estimate the statement cutoff week
  // (1–4) from a payment date. Payment ≈ cutoff + 10 days, so step back 10 days and
  // bucket the resulting day-of-month into a 7-day week (clamped to 1–4).
  function weekFromPaymentDate(iso) {
    if (!iso) return '';
    const p = String(iso).split('-');
    if (p.length !== 3) return '';
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() - 10);
    return Math.min(Math.max(Math.ceil(d.getDate() / 7), 1), 4);
  }

  // Get next statement cutoff and payment dates for a credit card
  function getCCDates(statementCutoff) {
    if (!statementCutoff) return null;
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth();
    // Get cutoff for current month
    let cutoff = getStatementCutoffDate(year, month, statementCutoff);
    // If cutoff already passed, use next month
    if (cutoff < now) {
      month++;
      if (month > 11) { month = 0; year++; }
      cutoff = getStatementCutoffDate(year, month, statementCutoff);
    }
    const payment = getPaymentDate(cutoff);
    return {
      cutoff,
      payment,
      cutoffStr: cutoff.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      paymentStr: payment.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    };
  }

  // Format number based on currency locale
  function fmtCurrency(value, currency) {
    if (!value && value !== 0) return '';
    const num = parseFloat(value);
    if (isNaN(num)) return '';
    if (currency === 'TRY') {
      return num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }

  // '' / null / unparseable → null (so an emptied BES field clears rather than
  // persisting a stray 0, which would read as a real figure on the detail tiles).
  function numOrNull(v) {
    if (v === '' || v == null) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function parseCurrencyInput(raw, currency) {
    if (!raw) return '';
    let cleaned = currency === 'TRY' ?
    raw.replace(/\./g, '').replace(',', '.') :
    raw.replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? '' : String(num);
  }

  function CurrencyInput({ value, currency, placeholder, onChange, id }) {
    const [focused, setFocused] = React.useState(false);
    const [raw, setRaw] = React.useState(value || '');
    React.useEffect(() => {if (!focused) setRaw(value || '');}, [value, focused]);
    function handleFocus() {setFocused(true);setRaw(value || '');}
    function handleChange(e) {
      setRaw(e.target.value);
      onChange(parseCurrencyInput(e.target.value, currency));
    }
    function handleBlur() {
      setFocused(false);
      const parsed = parseCurrencyInput(raw, currency);
      setRaw(parsed);
      onChange(parsed);
    }
    return (
      <input id={id} className="field-input" type="text" inputMode="decimal"
      placeholder={placeholder || (currency === 'TRY' ? '0,00' : '0.00')}
      value={focused ? raw : fmtCurrency(value, currency)}
      onFocus={handleFocus} onChange={handleChange} onBlur={handleBlur} />);

  }

  // ── Balance display ──
  function BalanceDisplay({ balance, cur, size = 'normal' }) {
    const neg = balance < 0;
    const cls = neg ? 'bal-negative' : 'bal-positive';
    const sizeClass = size === 'large' ? 'bal-lg' : '';
    return (
      <span className={'bal-display ' + cls + ' ' + sizeClass}>
        <span className="bal-sign">{neg ? '−' : ''}</span>
        <span className="bal-sym">{SYM[cur]}</span>
        <span className="bal-num">{grp(balance)}</span>
      </span>);

  }

  // ── Credit utilization bar ──
  function UtilBar({ used, limit }) {
    const pct = Math.min(100, Math.round(Math.abs(used) / limit * 100));
    const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--orange)' : 'var(--green)';
    return (
      <div className="util-wrap">
        <div className="util-bar">
          <div className="util-fill" style={{ width: pct + '%', background: color }}></div>
        </div>
        <span className="util-label">{pct}% used · {SYM.TRY}{grp(Math.abs(used))} of {SYM.TRY}{grp(limit)}</span>
      </div>);

  }

  // ── Account card ──
  function AccountCard({ account, onClick, flash }) {
    const t = ACCOUNT_TYPES[account.type];
    const isCredit = account.type === 'credit';
    const isPrepaid = isCredit && account.isPrepaid;
    return (
      <button id={'acct-card-' + account.id} className={'acct-card' + (isCredit ? ' is-credit' : '') + (flash ? ' acct-flash' : '')} onClick={() => onClick(account)}>
        <div className="acct-card-row">
          {(() => {
            const logo = instLogo(account.institution);
            return logo ? (
              <span className="acct-type-ico acct-inst-logo">
                <img src={logo} alt={account.institution} />
              </span>
            ) : (
              <span className="acct-type-ico" style={{
                color: t.color,
                background: 'color-mix(in srgb, ' + t.color + ' 13%, transparent)',
                borderColor: 'color-mix(in srgb, ' + t.color + ' 40%, transparent)'
              }}>
                <Icon name={t.icon} size={16} />
              </span>
            );
          })()}
          <div className="acct-card-meta">
            <span className="acct-card-name">{account.name}</span>
            <span className="acct-card-inst">
              {joinMeta(account.institution, displayNumber(account))}
            </span>
          </div>
          <div className="acct-card-end">
            {account.primary && <span className="acct-primary-tag"><Icon name="star" size={10} />Primary</span>}
            {isPrepaid && <span className="acct-prepaid-tag"><Icon name="wallet" size={10} />Prepaid</span>}
            <BalanceDisplay balance={account.balance} cur={account.cur} size="large" />
          </div>
        </div>
        {isCredit && !isPrepaid && account.limit > 0 && <UtilBar used={account.balance} limit={account.limit} />}
        {isCredit && !isPrepaid && (account.statementCutoff || account.paymentDue) && (() => {
          const dates = account.statementCutoff ? getCCDates(account.statementCutoff) : null;
          // Prefer the actual statement date (Son Ödeme Tarihi) when stored; else computed.
          const paymentStr = account.paymentDue ? fmtDate(account.paymentDue) : (dates ? dates.paymentStr : null);
          if (!dates && !paymentStr) return null;
          return (
            <div className="cc-dates-row">
              {dates && <span className="cc-date-item"><Icon name="calendar" size={11} /><span className="cc-date-k">Cutoff</span><span className="cc-date-v">{dates.cutoffStr}</span></span>}
              {paymentStr && <span className="cc-date-item"><Icon name="clock" size={11} /><span className="cc-date-k">Payment</span><span className="cc-date-v">{paymentStr}</span></span>}
            </div>
          );
        })()}
      </button>);

  }

  // ── Account group header ──
  // Doubles as the group's expand/collapse toggle, so it is a <button> rather
  // than a <div> — keyboard and screen readers get the affordance for free.
  function AccountGroupHeader({ typeKey, count, total, cur, collapsed, onToggle }) {
    const t = ACCOUNT_TYPES[typeKey];
    return (
      <button type="button" id={'acct-group-head-' + typeKey}
        className={'acct-group-head' + (collapsed ? ' is-collapsed' : '')}
        aria-expanded={!collapsed} onClick={onToggle}
        title={collapsed ? 'Expand group' : 'Collapse group'}>
        <Icon name="chevron-down" size={13} className="acct-group-chevron" />
        <span className="acct-group-icon" style={{ color: 'var(--text)' }}>
          <Icon name={t.icon} size={15} />
        </span>
        <span className="acct-group-label">{t.label === 'Cash' ? 'Cash' : t.label + 's'}</span>
        <span className="acct-group-count">{count}</span>
        <span className="acct-group-total">
          {total < 0 ? '−' : ''}{SYM[cur || 'TRY']}{grp(Math.abs(total))}
        </span>
      </button>);

  }

  // ── Account detail modal ──
  function AccountDetail({ account, onClose, onEdit, onDelete, onImport }) {
    const t = ACCOUNT_TYPES[account.type];
    const isCredit = account.type === 'credit';
    const isPrepaid = isCredit && account.isPrepaid;
    const isOverdraft = account.type === 'overdraft';
    const isInvest = account.type === 'invest';
    const isPension = account.type === 'pension';

    // Recent imported bank-account movements for this account (real data, across
    // all months). Credit-card activity lives on Credit Payments, not Account
    // Activity, so it's skipped here. A pension has no transaction activity of its
    // own either — its contributions arrive on a credit card and are listed by
    // PensionContributions instead. Full history is one click away via the
    // "View All" link, which deep-links into Account Activity pre-filtered to
    // this account (?account=<id>).
    const showActivity = !isInvest && !isCredit && !isPension;
    const [recentAct, setRecentAct] = React.useState([]);
    const [actLoading, setActLoading] = React.useState(showActivity);
    const [actErr, setActErr] = React.useState(null);
    React.useEffect(() => {
      if (!showActivity) return;
      let alive = true;
      setActLoading(true);
      const txApi = window.HL_ACCT_TX_API;
      if (!txApi || !txApi.listRecentForAccount) { setActLoading(false); return; }
      txApi.listRecentForAccount(account, 5)
        .then((list) => { if (alive) { setRecentAct(list); setActErr(null); } })
        .catch((e) => { if (alive) setActErr(e.message || 'Failed to load activity'); })
        .finally(() => { if (alive) setActLoading(false); });
      return () => { alive = false; };
    }, [account.id, showActivity]);
    const activityHref = 'Account Activity.html?account=' + encodeURIComponent(account.id);

    return (
      <div className="backdrop" onMouseDown={(e) => {if (e.target.classList.contains('backdrop')) onClose();}}>
        <div className="modal acct-detail-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title">
                {(() => {
                  const logo = instLogo(account.institution);
                  return logo ? (
                    <span className="acct-type-ico acct-inst-logo" style={{ width: 28, height: 28 }}>
                      <img src={logo} alt={account.institution} />
                    </span>
                  ) : (
                    <span className="acct-type-ico" style={{
                      color: t.color, width: 28, height: 28,
                      background: 'color-mix(in srgb, ' + t.color + ' 13%, transparent)',
                      borderColor: 'color-mix(in srgb, ' + t.color + ' 40%, transparent)'
                    }}>
                      <Icon name={t.icon} size={14} />
                    </span>
                  );
                })()}
                {account.name}
              </span>
              <span className="modal-sub">{joinMeta(account.institution, displayNumber(account), account.owner)}</span>
            </div>
            <button id="acct-detail-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          <div className="modal-body">
            <div className="detail-balance-hero">
              <span className="detail-bal-label">{isPrepaid ? 'Available Balance' : isCredit ? 'Outstanding Balance' : isOverdraft ? 'Overdraft Balance' : isInvest ? 'Portfolio Value' : isPension ? 'Total Savings' : 'Current Balance'}</span>
              <BalanceDisplay balance={account.balance} cur={account.cur} size="large" />
              {(isCredit || isOverdraft) && !isPrepaid && account.limit > 0 &&
              <div style={{ width: '100%', marginTop: 8 }}>
                  <UtilBar used={account.balance} limit={account.limit} />
                </div>
              }
            </div>

            <div className="detail-info-grid">
              <div className="detail-info-item">
                <span className="detail-info-k">Type</span>
                <span className="detail-info-v">{t.label}</span>
              </div>
              <div className="detail-info-item">
                <span className="detail-info-k">Currency</span>
                <span className="detail-info-v">{account.cur}</span>
              </div>
              {(isCredit || isOverdraft) && account.limit > 0 &&
              <div className="detail-info-item">
                  <span className="detail-info-k">{isOverdraft ? 'Overdraft Limit' : 'Credit Limit'}</span>
                  <span className="detail-info-v">{SYM[account.cur]}{grp(account.limit)}</span>
                </div>
              }
              {isCredit && !isPrepaid && account.statementCutoff &&
              <div className="detail-info-item">
                  <span className="detail-info-k">Statement Cutoff</span>
                  <span className="detail-info-v">{WEEK_LABELS[account.statementCutoff]}</span>
                </div>
              }
              {isCredit && !isPrepaid && account.statementCutoff && (() => {
                const dates = getCCDates(account.statementCutoff);
                if (!dates) return null;
                return (
                  <div className="detail-info-item">
                    <span className="detail-info-k">Next Cutoff Date</span>
                    <span className="detail-info-v">{dates.cutoffStr}</span>
                  </div>
                );
              })()}
              {isCredit && !isPrepaid && (account.paymentDue || account.statementCutoff) && (() => {
                // Prefer the actual statement date (Son Ödeme Tarihi) when stored; else computed.
                const paymentStr = account.paymentDue ? fmtDate(account.paymentDue)
                  : (account.statementCutoff ? (getCCDates(account.statementCutoff) || {}).paymentStr : null);
                if (!paymentStr) return null;
                return (
                  <div className="detail-info-item">
                    <span className="detail-info-k">Last Payment Date</span>
                    <span className="detail-info-v cc-payment-date">{paymentStr}</span>
                  </div>
                );
              })()}
              {account.iban &&
              <div className="detail-info-item detail-info-full">
                  <span className="detail-info-k">IBAN</span>
                  <span className="detail-info-v detail-iban">{account.iban}</span>
                </div>
              }
              {account.cur !== 'TRY' &&
              <div className="detail-info-item">
                  <span className="detail-info-k">TRY Equivalent</span>
                  <span className="detail-info-v">₺{grp(account.balance * FX[account.cur].toTRY)}</span>
                </div>
              }
            </div>

            {/* Investment accounts show their portfolio holdings instead of the
                transaction-style activity list. */}
            {isInvest && window.AccountHoldings && <window.AccountHoldings account={account} />}

            {/* Retirement plans: the BES figures, the fund split (same Investment
                rows as an invest account), then the card charges that funded it. */}
            {isPension && (
              <React.Fragment>
                {window.PensionSummary && <window.PensionSummary account={account} />}
                {window.AccountHoldings && <window.AccountHoldings account={account} />}
                {window.PensionContributions && <window.PensionContributions account={account} />}
              </React.Fragment>
            )}

            {showActivity &&
            <div className="detail-activity">
                <div className="detail-activity-head">
                  <span className="detail-section-label"><Icon name="activity" size={12} />Recent Activity</span>
                  <a id="acct-detail-activity-more" className="detail-activity-more" href={activityHref}>
                    View All<Icon name="arrow-right" size={12} />
                  </a>
                </div>
                {actLoading ?
                <div className="detail-act-loading"><Icon name="loader" size={16} className="spin" />Loading activity…</div>
                : actErr ?
                <div className="detail-empty">
                    <Icon name="alert-triangle" size={26} style={{ color: 'var(--red)' }} />
                    <span>{actErr}</span>
                  </div>
                : recentAct.length > 0 ?
                <div className="detail-activity-list">
                    {recentAct.map((a, i) => {
                      const isIn = a.direction === 'incoming';
                      return (
                        <div className="detail-act-row" key={a.id || i}>
                          <span className="act-date">{fmtDate(a.date)}</span>
                          <span className="act-desc" title={a.desc}>{a.desc}</span>
                          <span className={'act-amt ' + (isIn ? 'income' : 'expense')}>
                            {isIn ? '+' : '−'}{SYM[a.cur] || SYM.TRY}{grp(a.amt)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                :
                <div className="detail-empty">
                    <Icon name="inbox" size={28} />
                    <span>No recent activity for this account.</span>
                  </div>
                }
              </div>
            }
          </div>

          <div className="modal-foot">
            <button id="acct-detail-delete-btn" className="amb danger" style={{ marginRight: 'auto' }} onClick={() => onDelete(account)}>
              <Icon name="trash-2" size={14} />Delete
            </button>
            <button id="acct-detail-import-btn" className="amb cancel" onClick={() => onImport(account.id)}>
              <Icon name="file-down" size={14} />Import
            </button>
            <button id="acct-detail-edit-btn" className="amb ok" onClick={() => onEdit(account)}>
              <Icon name="pencil" size={14} />Edit Account
            </button>
          </div>
        </div>
      </div>);

  }

  // ── Add / Edit Account modal ──
  function AccountFormModal({ initial, accounts = [], error = null, onClearError, onClose, onSave }) {
    const editing = !!initial.id;
    const [f, setF] = React.useState({
      name: initial.name || '',
      owner: initial.owner || 'Sadun',
      type: initial.type || 'bank',
      cur: initial.cur || 'TRY',
      balance: initial.balance != null ? String(initial.balance) : '',
      number: initial.number || '',
      institution: initial.institution || '',
      primary: initial.primary || false,
      showInPaymentMethod: initial.showInPaymentMethod || false,
      limit: initial.limit != null ? String(initial.limit) : '',
      iban: cleanIban(initial.iban),   // a legacy spaced IBAN normalizes on open
      ccType: initial.ccType || 'visa',
      isPrepaid: initial.isPrepaid || false,
      debitType: initial.debitType || 'visa',
      cardName: initial.cardName || '',
      cardMedium: initial.cardMedium || 'physical',
      validityMonth: initial.validityMonth || '',
      validityYear: initial.validityYear || '',
      statementCutoff: initial.statementCutoff || (initial.paymentDue ? weekFromPaymentDate(initial.paymentDue) : ''),
      paymentDue: initial.paymentDue || '',
      linked: initial.linked || '',
      pension: initial.pension ? { ...initial.pension } : {}
    });
    const [invalid, setInvalid] = React.useState({});
    const [formErr, setFormErr] = React.useState('');
    // Any edit dismisses a previous save error — it described the values as they
    // were, and leaving it up next to changed fields reads as a live complaint.
    const set = (k, v) => { if (onClearError) onClearError(); if (formErr) { setFormErr(''); setInvalid({}); } setF((p) => ({ ...p, [k]: v })); };
    // BES fields live in a nested object (accounts.pension JSON column), so they
    // get their own setter rather than going through `set`.
    const setPen = (k, v) => setF((p) => ({ ...p, pension: { ...p.pension, [k]: v } }));
    const isCredit = f.type === 'credit';
    // Prepaid cards hold loaded funds, so their balance stays positive (available) and
    // they have no credit line to spend against.
    const isPrepaid = isCredit && f.isPrepaid;
    const isOverdraft = f.type === 'overdraft';
    // Cards keep their masked number ("4870 **** **** 1011"); every other type's
    // number is digits only.
    const isCard = isCredit || f.type === 'debit';
    const isCash = f.type === 'cash';
    const isPension = f.type === 'pension';
    // Other credit-card accounts that a supplementary/virtual card can hang off of
    // (excludes self when editing). Picked value is stored in `linked` (linked_key).
    const parentCardOptions = accounts.filter((a) => a.type === 'credit' && a.id !== initial.id);

    function submit() {
      // Cash accounts have no institution — only a name (and owner) are required.
      const vr = window.HL_FORM.checkRequired([
        { key: 'name', label: 'Name', ok: !!f.name.trim() },
        { key: 'institution', label: 'Institution', ok: isCash || !!f.institution.trim() },
      ]);
      setInvalid(vr.keys); setFormErr(vr.message);
      if (!vr.ok) return;
      const bal = parseFloat(f.balance) || 0;
      const result = {
        ...initial,
        name: f.name.trim(),
        owner: f.owner,
        type: f.type,
        cur: f.cur,
        balance: (isCredit || isOverdraft) && !isPrepaid && bal > 0 ? -bal : bal,
        number: (isCard ? cleanCardNo(f.number).trim() : cleanAccountNo(f.number)) || '–',
        institution: f.institution.trim() || '–',
        primary: f.primary,
        showInPaymentMethod: f.showInPaymentMethod,
        iban: cleanIban(f.iban) || null,
        ccType: f.ccType || 'visa',
        isPrepaid: isCredit ? !!f.isPrepaid : false,
        debitType: f.debitType || 'visa',
        cardName: (isCredit || f.type === 'debit') && f.cardName.trim() ? f.cardName.trim() : undefined,
        validityMonth: (isCredit || f.type === 'debit') && f.validityMonth ? String(f.validityMonth).padStart(2, '0') : undefined,
        validityYear: (isCredit || f.type === 'debit') && f.validityYear ? String(f.validityYear) : undefined,
        statementCutoff: isCredit && f.statementCutoff ? Number(f.statementCutoff) : undefined,
        paymentDue: isCredit && f.paymentDue ? f.paymentDue : undefined,
        linked: isCredit && f.linked ? f.linked : undefined,
        cardMedium: isCredit ? f.cardMedium : undefined,
        // Numeric BES fields come out of text inputs as strings; coerce so the
        // JSON column keeps the same shape the importer writes.
        pension: isPension ? {
          ...f.pension,
          total: bal,
          total_paid: numOrNull(f.pension.total_paid),
          state_contribution: numOrNull(f.pension.state_contribution),
          pending: numOrNull(f.pension.pending),
          next_payment_amount: numOrNull(f.pension.next_payment_amount)
        } : undefined
      };
      if (isCredit || isOverdraft) result.limit = parseFloat(f.limit) || 0;else
      delete result.limit;
      onSave(result);
    }

    return (
      <div className="backdrop" onMouseDown={(e) => {if (e.target.classList.contains('backdrop')) onClose();}}>
        <div className="modal acct-form-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title">
                <Icon name={editing ? 'pencil' : 'plus-circle'} size={16} />
                {editing ? 'Edit Account' : 'Add Account'}
              </span>
              <span className="modal-sub" data-comment-anchor="3414084801-span-275-15">{editing ? (initial.name || initial.id) : 'Create a new bank account, card, or wallet'}</span>
            </div>
            <button id="acct-form-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          <div className="modal-body">
            <div className="form-field full">
              <span className="field-label">Account Type</span>
              <div className="seg acct-type-seg">
                {Object.keys(ACCOUNT_TYPES).map((k) => {
                  const at = ACCOUNT_TYPES[k];
                  return (
                    <button key={k} id={'acct-form-type-' + k + '-btn'} className={f.type === k ? 'on-acct-type' : ''} onClick={() => set('type', k)}
                    style={f.type === k ? { background: 'color-mix(in srgb, ' + at.color + ' 16%, transparent)', color: at.color } : {}}>
                      <Icon name={at.icon} size={13} />{at.label}
                    </button>);

                })}
              </div>
            </div>

            <div className="form-grid">
              <div className={"form-field" + (invalid.name ? ' field-invalid' : '')}>
                <span className="field-label">Account Name<span className="field-required-mark">*</span></span>
                <input id="acct-form-name-input" className="field-input" placeholder="e.g. Vakıfbank Salary" value={f.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className={"form-field" + (invalid.institution ? ' field-invalid' : '')}>
                <span className="field-label">Institution{!isCash && <span className="field-required-mark">*</span>}</span>
                <StyledSelect id="acct-form-institution-input" className="field-input" value={f.institution || ''} onChange={(e) => set('institution', e.target.value)}>
                  <option value="">— Select Institution —</option>
                  {Object.keys(FINANCIAL_INSTITUTIONS || {}).map((k) => {
                    const fi = FINANCIAL_INSTITUTIONS[k];
                    const nm = instName(fi);
                    return <option key={k} value={nm}>{fi.swift ? nm + ' (' + fi.swift + ')' : nm}</option>;
                  })}
                  {/* The account carries an institution that isn't in the list (an
                      import wrote a name since renamed, or a hand-typed one). Keep it
                      selectable so nothing is lost on save, but LABEL it — an
                      unlabelled copy is indistinguishable from the real entry above
                      and the user cannot tell which one they are picking. */}
                  {f.institution && f.institution !== '–' &&
                    !Object.values(FINANCIAL_INSTITUTIONS || {}).some((fi) => instName(fi) === f.institution.trim()) &&
                    <option value={f.institution}>{f.institution + ' — Not In List'}</option>}
                </StyledSelect>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Owner</span>
                <StyledSelect id="acct-form-owner-select" className="field-input" value={f.owner} onChange={(e) => set('owner', e.target.value)}>
                  <option value="Sadun">Sadun</option>
                  <option value="Handan">Handan</option>
                  <option value="Shared">Shared</option>
                </StyledSelect>
              </div>
              <div className="form-field">
                <span className="field-label">{isCredit || f.type === 'debit' ? 'Card Number' : 'Account Number'}</span>
                <input id="acct-form-number-input" className="field-input"
                  inputMode={isCard ? 'text' : 'numeric'}
                  placeholder={isCard ? 'e.g. ****3847' : 'e.g. 300377'}
                  value={f.number}
                  onChange={(e) => set('number', isCard ? cleanCardNo(e.target.value) : cleanAccountNo(e.target.value))} />
              </div>
            </div>

            {(isCredit || f.type === 'debit') &&
            <div className="form-grid">
              {isCredit &&
              <div className="form-field">
                  <span className="field-label">CC Type</span>
                  <StyledSelect id="acct-form-cctype-select" className="field-input" value={f.ccType} onChange={(e) => set('ccType', e.target.value)}>
                    <option value="visa">Visa</option>
                    <option value="mastercard">MasterCard</option>
                    <option value="troy">Troy</option>
                  </StyledSelect>
                </div>
              }
              {f.type === 'debit' &&
              <div className="form-field">
                  <span className="field-label">Card Type</span>
                  <StyledSelect id="acct-form-debittype-select" className="field-input" value={f.debitType} onChange={(e) => set('debitType', e.target.value)}>
                    <option value="electron">Visa Electron</option>
                    <option value="maestro">Maestro</option>
                    <option value="troy">Troy</option>
                  </StyledSelect>
                </div>
              }
              {(isCredit || f.type === 'debit') &&
              <div className="form-field">
                <span className="field-label">Currency</span>
                <StyledSelect id="acct-form-currency-select" className="field-input" value={f.cur} onChange={(e) => set('cur', e.target.value)}>
                  <option value="TRY">TRY (₺)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </StyledSelect>
              </div>
              }
            </div>
            }

            {isCredit &&
            <div className="form-field full">
                <span className="field-label">Card Medium</span>
                <div className="seg acct-medium-seg">
                  {[{ k: 'physical', label: 'Physical', icon: 'credit-card' }, { k: 'virtual', label: 'Virtual', icon: 'smartphone' }].map((m) =>
                  <button key={m.k} id={'acct-form-medium-' + m.k + '-btn'} className={f.cardMedium === m.k ? 'on-acct-medium' : ''} onClick={() => set('cardMedium', m.k)}>
                      <Icon name={m.icon} size={13} />{m.label}
                    </button>
                  )}
                </div>
              </div>
            }

            {isCredit &&
            <div className="form-field full">
                <label className="acct-check-label muted">
                  <input id="acct-form-prepaid-checkbox" type="checkbox" checked={f.isPrepaid} onChange={(e) => set('isPrepaid', e.target.checked)} />
                  <Icon name="wallet" size={12} />Prepaid Card
                </label>
              </div>
            }

            {isPrepaid &&
            <div className="form-field full">
                <span className="field-label">Available Balance</span>
                <CurrencyInput id="acct-form-prepaid-balance-input" value={f.balance} currency={f.cur} onChange={(v) => set('balance', v)} />
              </div>
            }

            {/* Retirement plan (BES). These write into the nested `pension` object
                (accounts.pension JSON column) and mirror what the BES statement
                import fills in, so a hand-made account and an imported one carry
                the same shape. Investment return is derived on the detail view. */}
            {isPension &&
            <React.Fragment>
              <div className="form-field full">
                <span className="field-label">Total Savings</span>
                <CurrencyInput id="acct-form-pension-balance-input" value={f.balance} currency={f.cur} onChange={(v) => set('balance', v)} />
              </div>
              <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Contract No</span>
                  {/* BES sözleşme no — an account number by another name, so it
                      follows the same digits-only rule. */}
                  <input id="acct-form-pension-contract-input" className="field-input" inputMode="numeric" placeholder="e.g. 17943452"
                    value={f.pension.contract_no || ''} onChange={(e) => setPen('contract_no', cleanAccountNo(e.target.value))} />
                </div>
                <div className="form-field">
                  <span className="field-label">Plan</span>
                  <input id="acct-form-pension-plan-input" className="field-input" placeholder="e.g. DİJİBES PLUS PLAN"
                    value={f.pension.plan || ''} onChange={(e) => setPen('plan', e.target.value)} />
                </div>
              </div>
              <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Paid In <span className="field-opt">(total)</span></span>
                  <CurrencyInput id="acct-form-pension-paid-input" value={f.pension.total_paid != null ? String(f.pension.total_paid) : ''}
                    currency={f.cur} onChange={(v) => setPen('total_paid', v)} />
                </div>
                <div className="form-field">
                  <span className="field-label">State Contribution</span>
                  <CurrencyInput id="acct-form-pension-state-input" value={f.pension.state_contribution != null ? String(f.pension.state_contribution) : ''}
                    currency={f.cur} onChange={(v) => setPen('state_contribution', v)} />
                </div>
              </div>
              <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Next Payment Date</span>
                  <DateInput id="acct-form-pension-nextdate-input" className="field-input"
                    value={f.pension.next_payment_date || ''} onChange={(e) => setPen('next_payment_date', e.target.value)} />
                </div>
                <div className="form-field">
                  <span className="field-label">Next Payment Amount</span>
                  <CurrencyInput id="acct-form-pension-nextamt-input" value={f.pension.next_payment_amount != null ? String(f.pension.next_payment_amount) : ''}
                    currency={f.cur} onChange={(v) => setPen('next_payment_amount', v)} />
                </div>
              </div>
              <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Contract Start</span>
                  <DateInput id="acct-form-pension-start-input" className="field-input"
                    value={f.pension.start_date || ''} onChange={(e) => setPen('start_date', e.target.value)} />
                </div>
                <div className="form-field">
                  <span className="field-label">Pending <span className="field-opt">(provision)</span></span>
                  <CurrencyInput id="acct-form-pension-pending-input" value={f.pension.pending != null ? String(f.pension.pending) : ''}
                    currency={f.cur} onChange={(v) => setPen('pending', v)} />
                </div>
              </div>
              <span className="acct-pension-hint"><Icon name="info" size={11} />Importing a BES Birikim Özeti fills these in and refreshes the fund split.</span>
            </React.Fragment>
            }

            {isCredit && !isPrepaid &&
            <div className="form-field full">
                <span className="field-label">Parent Credit Card</span>
                <StyledSelect id="acct-form-parent-card-select" className="field-input" value={f.linked} onChange={(e) => {
                  const id = e.target.value;
                  const parent = parentCardOptions.find((a) => a.id === id);
                  // A supplementary/virtual card shares its parent's billing cycle —
                  // inherit the statement cutoff (Calculated Dates derive from it).
                  setF((p) => ({ ...p, linked: id, statementCutoff: parent && parent.statementCutoff != null ? parent.statementCutoff : p.statementCutoff }));
                }}>
                  <option value="">None — main card</option>
                  {parentCardOptions.map((a) =>
                  <option key={a.id} value={a.id}>{joinMeta(a.name, maskCardNumber(a.number))}</option>
                  )}
                </StyledSelect>
              </div>
            }

            {(isCredit || f.type === 'debit') &&
            <div className="form-field full">
                <span className="field-label">Name On Card</span>
                <input id="acct-form-cardname-input" className="field-input" placeholder="e.g. SADUN AYDIN" value={f.cardName}
              onChange={(e) => set('cardName', e.target.value)} />
              </div>
            }

            {(isCredit || f.type === 'debit') &&
            <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Validity Month</span>
                  <input id="acct-form-validity-month-input" className="field-input" type="number" min="1" max="12" placeholder="MM" value={f.validityMonth}
                onChange={(e) => set('validityMonth', e.target.value)} />
                </div>
                <div className="form-field">
                  <span className="field-label">Validity Year</span>
                  <input id="acct-form-validity-year-input" className="field-input" type="number" min="2026" max="2099" placeholder="YYYY" value={f.validityYear}
                onChange={(e) => set('validityYear', e.target.value)} />
                </div>
              </div>
            }

            {isCredit && !isPrepaid &&
            <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Statement Cutoff Week</span>
                  <StyledSelect id="acct-form-cutoff-select" className="field-input" value={f.statementCutoff} disabled={!!f.linked}
                    onChange={(e) => set('statementCutoff', e.target.value ? Number(e.target.value) : '')}>
                    <option value="">— Select Week —</option>
                    <option value="1">1st Week (Days 1–7)</option>
                    <option value="2">2nd Week (Days 8–14)</option>
                    <option value="3">3rd Week (Days 15–21)</option>
                    <option value="4">4th Week (Days 22–28)</option>
                  </StyledSelect>
                  {f.linked && <span className="field-hint"><Icon name="link" size={11} /> Inherited from parent card</span>}
                </div>
                <div className="form-field">
                  <span className="field-label">Calculated Dates</span>
                  {f.statementCutoff ? (() => {
                    const dates = getCCDates(f.statementCutoff);
                    return dates ? (
                      <div className="cc-calc-dates">
                        <span className="cc-calc-row"><Icon name="calendar" size={12} /><span className="cc-calc-k">Cutoff:</span> {dates.cutoffStr}</span>
                        <span className="cc-calc-row"><Icon name="clock" size={12} /><span className="cc-calc-k">Payment:</span> {dates.paymentStr}</span>
                      </div>
                    ) : <span className="field-hint">Select a week to calculate</span>;
                  })() : <span className="field-hint" style={{padding:'10px 0',color:'var(--muted)'}}>Select a cutoff week to see dates</span>}
                </div>
              </div>
            }

            {/* Half-width, exactly like the "Add Spending" modal's Date field: a plain
                .form-field inside a .form-grid. Both modals are the same 520px .modal
                with a 20px .modal-body, so the two pickers come out identical. The
                hint takes .full so it spans the grid on its own row instead of being
                squeezed into one column. */}
            {isCredit && !isPrepaid &&
            <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Last Payment Date</span>
                  <DateInput id="acct-form-payment-due-input" className="field-input" value={f.paymentDue}
                    onChange={(e) => {
                      const v = e.target.value;
                      // Derive the cutoff week from the payment date (unless inherited from a parent card).
                      setF((p) => ({ ...p, paymentDue: v, statementCutoff: v && !p.linked ? weekFromPaymentDate(v) : p.statementCutoff }));
                    }} />
                </div>
                <div className="form-field full">
                  <span className="acct-field-hint"><Icon name="info" size={12} />Auto-filled from imported statements (Son Ödeme Tarihi); sets the Statement Cutoff Week.</span>
                </div>
              </div>
            }

            {f.type === 'overdraft' && (
            <React.Fragment>
              <div className="form-field full">
                <span className="field-label">IBAN</span>
                {/* No maxLength: it would clip a PASTED spaced IBAN at 26 raw
                    characters (spaces included) before the strip runs, silently
                    dropping digits. cleanIban() caps at 26 after despacing. */}
                <input id="acct-form-iban-input" className="field-input" placeholder="e.g. TR000000000000000000000000" value={f.iban} onChange={(e) => set('iban', cleanIban(e.target.value))} />
              </div>
              <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Current Balance</span>
                  <CurrencyInput id="acct-form-balance-input" value={f.balance} currency={f.cur} onChange={(v) => set('balance', v)} />
                </div>
                <div className="form-field">
                  <span className="field-label">Overdraft Limit</span>
                  <CurrencyInput id="acct-form-limit-input" value={f.limit} currency={f.cur} placeholder={f.cur === 'TRY' ? 'örn. 50.000,00' : 'e.g. 50,000.00'} onChange={(v) => set('limit', v)} />
                </div>
              </div>
            </React.Fragment>
            )}

            {f.type === 'bank' &&
            <React.Fragment>
              <div className="form-field full">
                <span className="field-label">IBAN</span>
                {/* No maxLength: it would clip a PASTED spaced IBAN at 26 raw
                    characters (spaces included) before the strip runs, silently
                    dropping digits. cleanIban() caps at 26 after despacing. */}
                <input id="acct-form-iban-input" className="field-input" placeholder="e.g. TR000000000000000000000000" value={f.iban} onChange={(e) => set('iban', cleanIban(e.target.value))} />
              </div>
              <div className="form-field full">
                <span className="field-label">Current Balance</span>
                <CurrencyInput id="acct-form-balance-input" value={f.balance} currency={f.cur} onChange={(v) => set('balance', v)} />
              </div>
              <div className="form-field full">
                <label className="acct-check-label">
                  <input id="acct-form-primary-checkbox" type="checkbox" checked={f.primary} onChange={(e) => set('primary', e.target.checked)} />
                  <Icon name="star" size={12} />Mark As Primary Account
                </label>
              </div>
              <div className="form-field full">
                <label className="acct-check-label">
                  <input id="acct-form-show-payment-method-checkbox" type="checkbox" checked={f.showInPaymentMethod} onChange={(e) => set('showInPaymentMethod', e.target.checked)} />
                  <Icon name="wallet" size={12} />Show On Payment Method
                </label>
              </div>
            </React.Fragment>
            }

            {isCash &&
            <div className="form-field full">
              <span className="field-label">Current Balance</span>
              <CurrencyInput id="acct-form-balance-input" value={f.balance} currency={f.cur} onChange={(v) => set('balance', v)} />
            </div>
            }
          </div>

          {/* A rejected save (most often the per-type unique IBAN / card number)
              names the account already holding it, so show it where the user is
              looking instead of closing the form. */}
          {error &&
          <div id="acct-form-error" className="acct-form-error">
            <Icon name="alert-triangle" size={14} />{error}
          </div>}

          <window.HL_FORM.FormError message={formErr} id="acct-form-required-error" />

          <div className="modal-foot">
            <button id="acct-form-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            <button id="acct-form-save-btn" className="amb ok" onClick={submit}><Icon name="save" size={14} />{editing ? 'Save Changes' : 'Add Account'}</button>
          </div>
        </div>
      </div>);

  }

  // ── Delete confirm ──
  // Deleting an account cascades: its transactions, credit-card statements and
  // holdings go with it (nothing references an account by foreign key, so the
  // backend matches on payment_method / account_key / platform). The dialog asks
  // the API what that amounts to and lists it, so the cascade is never a surprise.
  function DeleteAccountConfirm({ account, onClose, onConfirm }) {
    const meta = joinMeta(account.institution, displayNumber(account));
    const [related, setRelated] = React.useState(null);
    const [relErr, setRelErr] = React.useState(null);

    React.useEffect(() => {
      let alive = true;
      if (account._dbId == null) { setRelated({}); return undefined; }
      window.HL_ACCOUNTS_API.related(account._dbId)
        .then(r => { if (alive) setRelated(r); })
        .catch(e => { if (alive) { setRelated({}); setRelErr(e.message || 'Could not check related records'); } });
      return () => { alive = false; };
    }, [account._dbId]);

    const tx = (related && related.transactions) || {};
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const items = [];
    if (tx.count) {
      const span = tx.earliest && tx.latest && tx.earliest !== tx.latest
        ? ` (${tx.earliest} → ${tx.latest})` : (tx.earliest ? ` (${tx.earliest})` : '');
      items.push({ icon: 'receipt', text: plural(tx.count, 'transaction', 'transactions') + span });
    }
    if (related && related.credit_payments) {
      items.push({ icon: 'credit-card', text: plural(related.credit_payments, 'credit payment', 'credit payments') });
    }
    if (related && related.statements) {
      items.push({ icon: 'files', text: plural(related.statements, 'statement', 'statements') });
    }
    if (related && related.investments) {
      items.push({ icon: 'trending-up', text: plural(related.investments, 'holding', 'holdings') });
    }
    const linked = (related && related.linked_accounts) || [];

    return (
      <div className="backdrop">
        <div className="modal confirm-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name="trash-2" size={16} />Delete Account</span>
            </div>
            <button id="acct-delete-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>
          <div className="confirm-body">
            <div className="confirm-ico"><Icon name="alert-triangle" size={20} /></div>
            <div className="confirm-text">
              Delete <b>{account.name}</b>{meta ? ` (${meta})` : ''}?
              {related === null && <span className="acct-del-checking" id="acct-delete-checking">Checking related records…</span>}
              {relErr && <span className="warn" id="acct-delete-related-error">{relErr}</span>}
              {related !== null && items.length > 0 && (
                <span className="acct-del-related" id="acct-delete-related">
                  <span className="acct-del-related-head">This also deletes:</span>
                  {items.map(it => (
                    <span className="acct-del-related-item" key={it.icon}>
                      <Icon name={it.icon} size={12} />{it.text}
                    </span>
                  ))}
                </span>
              )}
              {related !== null && items.length === 0 && !relErr && (
                <span className="acct-del-related" id="acct-delete-related">
                  <span className="acct-del-related-item"><Icon name="check" size={12} />No related records</span>
                </span>
              )}
              {linked.length > 0 && (
                <span className="acct-del-related-note" id="acct-delete-unlink-note">
                  {plural(linked.length, 'account stays', 'accounts stay')} but {linked.length === 1 ? 'loses its' : 'lose their'} link: {linked.join(', ')}
                </span>
              )}
              <span className="warn">⚠ This cannot be undone.</span>
            </div>
          </div>
          <div className="modal-foot">
            <button id="acct-delete-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            <button id="acct-delete-confirm-btn" className="amb danger" onClick={onConfirm}><Icon name="trash-2" size={14} />Delete</button>
          </div>
        </div>
      </div>);

  }

  // ── Summary strip ──
  function AccountsSummary({ accounts }) {
    let assets = 0,liabilities = 0;
    accounts.forEach((a) => {
      const tryV = a.balance * (FX[a.cur] ? FX[a.cur].toTRY : 1);
      if (tryV >= 0) assets += tryV;else liabilities += Math.abs(tryV);
    });
    const net = assets - liabilities;
    const cards = [
    { label: 'Total Assets', icon: 'arrow-down-left', cls: 'income', val: '₺' + grp(assets), sub: 'All positive balances' },
    { label: 'Liabilities', icon: 'arrow-up-right', cls: 'expense', val: '₺' + grp(liabilities), sub: 'Credit cards' },
    { label: 'Net Worth', icon: 'scale', cls: 'net', val: (net < 0 ? '−₺' : '₺') + grp(Math.abs(net)), sub: 'Assets − liabilities' },
    { label: 'Accounts', icon: 'wallet', cls: 'count', val: String(accounts.length), sub: 'Active' }];

    return (
      <div className="summary-row">
        {cards.map((c) =>
        <div className="summary-card" key={c.label}>
            <span className="summary-label"><Icon name={c.icon} size={13} />{c.label}</span>
            <span className={'summary-value ' + c.cls}>{c.val}</span>
            <span className="summary-sub">{c.sub}</span>
          </div>
        )}
      </div>);

  }

  Object.assign(window, {
    AccountCard, AccountGroupHeader, AccountDetail, AccountsSummary,
    AccountFormModal, DeleteAccountConfirm, BalanceDisplay
  });
})();