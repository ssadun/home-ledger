// accounts-components.jsx — Home Ledger Accounts page components.
(function () {
  const Icon = window.Icon;
  const { ACCOUNT_TYPES, ACCOUNT_ACTIVITY, FINANCIAL_INSTITUTIONS, FX } = window.ACCOUNTS_DATA;

  function grp(v, dec = 2) {
    return Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  const SYM = { TRY: '₺', USD: '$', EUR: '€' };
  const fmtDate = (iso) => {const [y, m, d] = iso.split('-');return `${d}.${m}.${y}`;};

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

  function OwnerBadge({ name }) {
    if (name === 'Shared') {
      return (
        <span className="for-badge for-shared">
          <Icon name="users" size={11} />Shared
        </span>);

    }
    const cls = name === 'Sadun' ? 'payer-sadun' : 'payer-handan';
    return (
      <span className={'payer-badge ' + cls}>
        <span className="avatar">{name[0]}</span>{name}
      </span>);

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
    return (
      <button id={'acct-card-' + account.id} className={'acct-card' + (isCredit ? ' is-credit' : '') + (flash ? ' acct-flash' : '')} onClick={() => onClick(account)}>
        <div className="acct-card-row">
          <span className="acct-type-ico" style={{
            color: t.color,
            background: 'color-mix(in srgb, ' + t.color + ' 13%, transparent)',
            borderColor: 'color-mix(in srgb, ' + t.color + ' 40%, transparent)'
          }}>
            <Icon name={t.icon} size={16} />
          </span>
          <div className="acct-card-meta">
            <span className="acct-card-name">{account.name}</span>
            <span className="acct-card-inst">
              {account.institution !== '–' ? account.institution : ''}{account.number !== '–' ? ' · ' + account.number : ''}
            </span>
          </div>
          <div className="acct-card-end">
            {account.primary && <span className="acct-primary-tag"><Icon name="star" size={10} />Primary</span>}
            <OwnerBadge name={account.owner} />
            <BalanceDisplay balance={account.balance} cur={account.cur} size="large" />
          </div>
        </div>
        {isCredit && account.limit && <UtilBar used={account.balance} limit={account.limit} />}
        {isCredit && account.statementCutoff && (() => {
          const dates = getCCDates(account.statementCutoff);
          if (!dates) return null;
          return (
            <div className="cc-dates-row">
              <span className="cc-date-item"><Icon name="calendar" size={11} /><span className="cc-date-k">Cutoff</span><span className="cc-date-v">{dates.cutoffStr}</span></span>
              <span className="cc-date-item"><Icon name="clock" size={11} /><span className="cc-date-k">Payment</span><span className="cc-date-v">{dates.paymentStr}</span></span>
            </div>
          );
        })()}
      </button>);

  }

  // ── Account group header ──
  function AccountGroupHeader({ typeKey, count, total, cur }) {
    const t = ACCOUNT_TYPES[typeKey];
    return (
      <div className="acct-group-head">
        <span className="acct-group-icon" style={{ color: t.color }}>
          <Icon name={t.icon} size={15} />
        </span>
        <span className="acct-group-label">{t.label === 'Cash' ? 'Cash' : t.label + 's'}</span>
        <span className="acct-group-count">{count}</span>
        <span className="acct-group-total">
          {total < 0 ? '−' : ''}{SYM[cur || 'TRY']}{grp(Math.abs(total))}
        </span>
      </div>);

  }

  // ── Account detail modal ──
  function AccountDetail({ account, onClose, onEdit, onDelete, onImport }) {
    const t = ACCOUNT_TYPES[account.type];
    const activity = ACCOUNT_ACTIVITY[account.id] || [];
    const isCredit = account.type === 'credit';
    const isOverdraft = account.type === 'overdraft';

    return (
      <div className="backdrop" onMouseDown={(e) => {if (e.target.classList.contains('backdrop')) onClose();}}>
        <div className="modal acct-detail-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title">
                <span className="acct-type-ico" style={{
                  color: t.color, width: 28, height: 28,
                  background: 'color-mix(in srgb, ' + t.color + ' 13%, transparent)',
                  borderColor: 'color-mix(in srgb, ' + t.color + ' 40%, transparent)'
                }}>
                  <Icon name={t.icon} size={14} />
                </span>
                {account.name}
              </span>
              <span className="modal-sub">{account.institution} · {account.number} · {account.owner}</span>
            </div>
            <button id="acct-detail-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          <div className="modal-body">
            <div className="detail-balance-hero">
              <span className="detail-bal-label">{isCredit ? 'Outstanding Balance' : isOverdraft ? 'Overdraft Balance' : 'Current Balance'}</span>
              <BalanceDisplay balance={account.balance} cur={account.cur} size="large" />
              {(isCredit || isOverdraft) && account.limit &&
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
              <div className="detail-info-item">
                <span className="detail-info-k">Owner</span>
                <span className="detail-info-v"><OwnerBadge name={account.owner} /></span>
              </div>
              {(isCredit || isOverdraft) && account.limit &&
              <div className="detail-info-item">
                  <span className="detail-info-k">{isOverdraft ? 'Overdraft Limit' : 'Credit Limit'}</span>
                  <span className="detail-info-v">{SYM[account.cur]}{grp(account.limit)}</span>
                </div>
              }
              {isCredit && account.statementCutoff &&
              <div className="detail-info-item">
                  <span className="detail-info-k">Statement Cutoff</span>
                  <span className="detail-info-v">{WEEK_LABELS[account.statementCutoff]}</span>
                </div>
              }
              {isCredit && account.statementCutoff && (() => {
                const dates = getCCDates(account.statementCutoff);
                if (!dates) return null;
                return (
                  <React.Fragment>
                    <div className="detail-info-item">
                      <span className="detail-info-k">Next Cutoff Date</span>
                      <span className="detail-info-v">{dates.cutoffStr}</span>
                    </div>
                    <div className="detail-info-item">
                      <span className="detail-info-k">Last Payment Date</span>
                      <span className="detail-info-v cc-payment-date">{dates.paymentStr}</span>
                    </div>
                  </React.Fragment>
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

            {activity.length > 0 &&
            <div className="detail-activity">
                <span className="detail-section-label"><Icon name="activity" size={12} />Recent Activity</span>
                <div className="detail-activity-list">
                  {activity.map((a, i) =>
                <div className="detail-act-row" key={i}>
                      <span className="act-date">{fmtDate(a.date)}</span>
                      <span className="act-desc">{a.desc}</span>
                      <span className={'act-amt ' + (a.amt > 0 ? 'income' : 'expense')}>
                        {a.amt > 0 ? '+' : '−'}{SYM.TRY}{grp(Math.abs(a.amt))}
                      </span>
                    </div>
                )}
                </div>
              </div>
            }

            {activity.length === 0 &&
            <div className="detail-empty">
                <Icon name="inbox" size={28} />
                <span>No recent activity for this account.</span>
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
  function AccountFormModal({ initial, onClose, onSave }) {
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
      limit: initial.limit != null ? String(initial.limit) : '',
      iban: initial.iban || '',
      ccType: initial.ccType || 'visa',
      debitType: initial.debitType || 'visa',
      cardName: initial.cardName || '',
      validityMonth: initial.validityMonth || '',
      validityYear: initial.validityYear || '',
      statementCutoff: initial.statementCutoff || ''
    });
    const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
    const isCredit = f.type === 'credit';
    const isOverdraft = f.type === 'overdraft';

    function submit() {
      if (!f.name.trim() || !f.institution.trim()) return;
      const bal = parseFloat(f.balance) || 0;
      const result = {
        ...initial,
        name: f.name.trim(),
        owner: f.owner,
        type: f.type,
        cur: f.cur,
        balance: (isCredit || isOverdraft) && bal > 0 ? -bal : bal,
        number: f.number.trim() || '–',
        institution: f.institution.trim(),
        primary: f.primary,
        iban: f.iban.trim() || null,
        ccType: f.ccType || 'visa',
        debitType: f.debitType || 'visa',
        cardName: (isCredit || f.type === 'debit') && f.cardName.trim() ? f.cardName.trim() : undefined,
        validityMonth: (isCredit || f.type === 'debit') && f.validityMonth ? String(f.validityMonth).padStart(2, '0') : undefined,
        validityYear: (isCredit || f.type === 'debit') && f.validityYear ? String(f.validityYear) : undefined,
        statementCutoff: isCredit && f.statementCutoff ? Number(f.statementCutoff) : undefined
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
              <div className="form-field">
                <span className="field-label">Account Name</span>
                <input id="acct-form-name-input" className="field-input" placeholder="e.g. Vakıfbank Salary" value={f.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="form-field">
                <span className="field-label">Institution</span>
                <select id="acct-form-institution-input" className="field-input" value={f.institution || ''} onChange={(e) => set('institution', e.target.value)}>
                  <option value="">— Select Institution —</option>
                  {Object.keys(FINANCIAL_INSTITUTIONS || {}).map((k) => {
                    const fi = FINANCIAL_INSTITUTIONS[k];
                    return <option key={k} value={fi.name}>{fi.swift ? fi.name + ' (' + fi.swift + ')' : fi.name}</option>;
                  })}
                  {f.institution && f.institution !== '–' &&
                    !Object.values(FINANCIAL_INSTITUTIONS || {}).some((fi) => fi.name === f.institution) &&
                    <option value={f.institution}>{f.institution}</option>}
                </select>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Owner</span>
                <select id="acct-form-owner-select" className="field-input" value={f.owner} onChange={(e) => set('owner', e.target.value)}>
                  <option value="Sadun">Sadun</option>
                  <option value="Handan">Handan</option>
                  <option value="Shared">Shared</option>
                </select>
              </div>
              <div className="form-field">
                <span className="field-label">{isCredit || f.type === 'debit' ? 'Card Number' : 'Account Number'}</span>
                <input id="acct-form-number-input" className="field-input" placeholder="e.g. ****3847" value={f.number} onChange={(e) => set('number', e.target.value)} />
              </div>
            </div>

            {(isCredit || f.type === 'debit') &&
            <div className="form-grid">
              {isCredit &&
              <div className="form-field">
                  <span className="field-label">CC Type</span>
                  <select id="acct-form-cctype-select" className="field-input" value={f.ccType} onChange={(e) => set('ccType', e.target.value)}>
                    <option value="visa">Visa</option>
                    <option value="mastercard">MasterCard</option>
                    <option value="troy">Troy</option>
                  </select>
                </div>
              }
              {f.type === 'debit' &&
              <div className="form-field">
                  <span className="field-label">Card Type</span>
                  <select id="acct-form-debittype-select" className="field-input" value={f.debitType} onChange={(e) => set('debitType', e.target.value)}>
                    <option value="electron">Visa Electron</option>
                    <option value="maestro">Maestro</option>
                    <option value="troy">Troy</option>
                  </select>
                </div>
              }
              {(isCredit || f.type === 'debit') &&
              <div className="form-field">
                <span className="field-label">Currency</span>
                <select id="acct-form-currency-select" className="field-input" value={f.cur} onChange={(e) => set('cur', e.target.value)}>
                  <option value="TRY">TRY (₺)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
              }
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

            {isCredit &&
            <div className="form-grid">
                <div className="form-field">
                  <span className="field-label">Statement Cutoff Week</span>
                  <select id="acct-form-cutoff-select" className="field-input" value={f.statementCutoff} onChange={(e) => set('statementCutoff', e.target.value ? Number(e.target.value) : '')}>
                    <option value="">— Select Week —</option>
                    <option value="1">1st Week (Days 1–7)</option>
                    <option value="2">2nd Week (Days 8–14)</option>
                    <option value="3">3rd Week (Days 15–21)</option>
                    <option value="4">4th Week (Days 22–28)</option>
                  </select>
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

            {f.type === 'overdraft' && (
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
            )}

            {f.type === 'bank' &&
            <React.Fragment>
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
            </React.Fragment>
            }
          </div>

          <div className="modal-foot">
            <button id="acct-form-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            <button id="acct-form-save-btn" className="amb ok" onClick={submit}><Icon name="save" size={14} />{editing ? 'Save Changes' : 'Add Account'}</button>
          </div>
        </div>
      </div>);

  }

  // ── Delete confirm ──
  function DeleteAccountConfirm({ account, onClose, onConfirm }) {
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
              Delete <b>{account.name}</b> ({account.institution} · {account.number})?
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
    AccountFormModal, DeleteAccountConfirm, OwnerBadge, BalanceDisplay
  });
})();