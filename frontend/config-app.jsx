// config-app.jsx — Home Ledger Configuration Screen
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;

  // "Credit Card Types" section icon follows the user's Account Types → Credit
  // Card colour, not a hardcoded orange. Falls back to orange when unset.
  const CREDIT_COLOR = (window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.ACCOUNT_TYPES
    && window.ACCOUNTS_DATA.ACCOUNT_TYPES.credit && window.ACCOUNTS_DATA.ACCOUNT_TYPES.credit.color) || 'var(--orange)';

  // Project rule: every date field renders through the shared DateInput (never a
  // raw <input type="date">), so calendar styling and .date-input-wrap markup stay
  // identical everywhere. The one implementation lives in date-input.jsx, which
  // this page must load first — do NOT paste a local copy back in here.
  const DateInput = window.DateInput;

  const TWEAK_DEFAULTS = { accent: '#4f8ef7' };

  const { Sidebar, NAV_CFG_SUB } = window.HL_NAV;
  const CFG_SECTION = window.CONFIG_SECTION || null;
  const SYM = (window.LEDGER_FMT && window.LEDGER_FMT.SYM) || { TRY: '₺', USD: '$', EUR: '€' };

  // ── Rate source (TCMB = Central Bank of Turkey official bulletin, vs. a manual / market rate) ──
  const SOURCE_OPTIONS = [
    { value: 'TCMB',   label: 'TCMB — Central Bank Of Turkey' },
    { value: 'Market', label: 'Market — Manual / Market Rate' },
  ];
  // Latest official TCMB Döviz Satış (sell) bulletin we can "retrieve". 1 unit → TRY.
  const TCMB_BULLETIN = '2026/108 (15.06.2026)';
  const TCMB_RATES = {
    USD: 46.2765, EUR: 53.7123, GBP: 62.8410, CHF: 57.4820,
    JPY: 0.3192,  CAD: 33.8910, AUD: 30.1240, SAR: 12.3380,
  };
  const todayYMD = () => {
    const t = (window.LEDGER && window.LEDGER.TODAY) || new Date();
    const p = n => String(n).padStart(2, '0');
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  };

  // Source pill — gold landmark for TCMB, sky trend glyph for a market/manual rate.
  function SourceBadge({ source }) {
    if (!source) return <span style={{ color: 'var(--muted)' }}>—</span>;
    const tcmb = source === 'TCMB';
    return (
      <span className={'cfg-src-badge ' + (tcmb ? 'src-tcmb' : 'src-market')}>
        <Icon name={tcmb ? 'landmark' : 'trending-up'} size={11} />{source}
      </span>
    );
  }

  // ── Color palette ────────────────────────────────────────────────────────
  const COLOR_OPTIONS = [
    { var: 'var(--accent)',   hex: '#4f8ef7', label: 'Blue' },
    { var: 'var(--green)',    hex: '#22c55e', label: 'Green' },
    { var: 'var(--emerald)',  hex: '#34d399', label: 'Emerald' },
    { var: 'var(--mint)',     hex: '#4ade80', label: 'Mint' },
    { var: 'var(--lime)',     hex: '#bef264', label: 'Lime' },
    { var: 'var(--yellow)',   hex: '#eab308', label: 'Yellow' },
    { var: 'var(--orange)',   hex: '#f97316', label: 'Orange' },
    { var: 'var(--coral)',    hex: '#fb7185', label: 'Coral' },
    { var: 'var(--red)',      hex: '#ef4444', label: 'Red' },
    { var: 'var(--pink)',     hex: '#ec4899', label: 'Pink' },
    { var: 'var(--rose)',     hex: '#f472b6', label: 'Rose' },
    { var: 'var(--fuchsia)',  hex: '#d946ef', label: 'Fuchsia' },
    { var: 'var(--lavender)', hex: '#8b5cf6', label: 'Lavender' },
    { var: 'var(--sky)',      hex: '#38bdf8', label: 'Sky' },
    { var: 'var(--steel)',    hex: '#94a3b8', label: 'Steel' },
    { var: 'var(--gold)',     hex: '#fbbf24', label: 'Gold' },
  ];

  // ── Icon palette (Lucide names) for the category icon picker ─────────────
  const ICON_OPTIONS = [
    'utensils', 'coffee', 'wine', 'pizza', 'shopping-cart', 'shopping-bag', 'gift', 'shirt',
    'car', 'fuel', 'bus', 'plane', 'train-front', 'map-pin', 'ticket', 'luggage',
    'home', 'building-2', 'bed', 'lightbulb', 'plug', 'wifi', 'flame', 'droplet',
    'phone', 'smartphone', 'laptop', 'monitor', 'tv', 'gamepad-2', 'music', 'clapperboard',
    'book', 'graduation-cap', 'briefcase', 'dumbbell', 'heart-pulse', 'stethoscope', 'pill', 'baby',
    'dog', 'leaf', 'wrench', 'hammer', 'paintbrush', 'scissors', 'tag', 'receipt',
    'credit-card', 'wallet', 'banknote', 'piggy-bank', 'landmark', 'coins', 'trending-up', 'percent',
  ];

  // ── Sample currency rate history ────────────────────────────────────────
  const CURRENCY_SAMPLE_HISTORY = {
    USD: [
      { date: '2026-06-14', toTRY: 46.1020, toUSD: 1.00, source: 'Market', note: 'Manual entry (market close)' },
      { date: '2026-06-06', toTRY: 39.20,   toUSD: 1.00, source: 'TCMB',   note: 'TCMB 2026/101' },
      { date: '2026-05-01', toTRY: 38.50,   toUSD: 1.00, source: 'TCMB',   note: 'TCMB 2026/82' },
      { date: '2026-04-01', toTRY: 37.80,   toUSD: 1.00, source: 'TCMB',   note: 'TCMB 2026/63' },
      { date: '2026-03-01', toTRY: 36.90,   toUSD: 1.00, source: 'TCMB',   note: 'TCMB 2026/41' },
    ],
    EUR: [
      { date: '2026-06-15', toTRY: 53.7123, toUSD: 1.16, source: 'TCMB',   note: 'TCMB 2026/108 (Döviz Satış)' },
      { date: '2026-06-06', toTRY: 42.60,   toUSD: 1.09, source: 'TCMB',   note: 'TCMB 2026/101' },
      { date: '2026-05-01', toTRY: 41.80,   toUSD: 1.09, source: 'TCMB',   note: 'TCMB 2026/82' },
      { date: '2026-04-01', toTRY: 40.95,   toUSD: 1.08, source: 'TCMB',   note: 'TCMB 2026/63' },
    ],
  };

  // ── Currency history modal ───────────────────────────────────────────────
  function CurrencyHistoryModal({ currency, onSave, onClose }) {
    const { grp } = window.LEDGER_FMT || { grp: (v) => v };
    const [date, setDate] = React.useState(todayYMD());
    const [toTRY, setToTRY] = React.useState('');
    const [toUSD, setToUSD] = React.useState('');
    const [source, setSource] = React.useState('TCMB');
    const [note, setNote] = React.useState('');
    const [err, setErr] = React.useState('');

    const sorted = [...(currency.history || [])].sort((a, b) => b.date.localeCompare(a.date));

    function submit(e) {
      e.preventDefault();
      if (!date) { setErr('Date is required.'); return; }
      if (!toTRY || isNaN(parseFloat(toTRY))) { setErr('TRY rate is required.'); return; }
      setErr('');
      const entry = { date, toTRY: parseFloat(toTRY), toUSD: toUSD ? parseFloat(toUSD) : currency.toUSD, source, note };
      const newHistory = [...(currency.history || []).filter(h => h.date !== date), entry]
        .sort((a, b) => b.date.localeCompare(a.date));
      const latest = newHistory[0];
      onSave({ ...currency, history: newHistory, toTRY: latest.toTRY, toUSD: latest.toUSD, asOf: latest.date, source: latest.source });
      setToTRY(''); setToUSD(''); setNote(''); setSource('TCMB'); setDate(new Date().toISOString().slice(0, 10));
    }

    return (
      <div className="backdrop" onMouseDown={e => { if (e.target.classList.contains('backdrop')) onClose(); }}>
        <div className="modal cfg-modal cfg-hist-modal">
          <div className="modal-head">
            <span className="modal-title">
              <Icon name="clock" size={15} color="var(--gold)" />
              Exchange Rate History — {currency.code}
            </span>
            <button id="currency-history-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={16} /></button>
          </div>
          <div className="cfg-hist-body">
            {/* Add new rate form */}
            <form onSubmit={submit} className="cfg-hist-form">
              <span className="cfg-hist-form-title"><Icon name="plus-circle" size={13} />Add New Rate</span>
              <div className="cfg-hist-fields">
                <div className="form-field">
                  <span className="field-label">Currency Code</span>
                  <input id="currency-history-code-input" className="field-input" type="text" value={currency.code} readOnly
                    data-table="currency_rates" data-col="currency_code" />
                </div>
                <div className="form-field">
                  <span className="field-label">Date</span>
                  <input id="currency-history-date-input" className="field-input" type="text" value={date} readOnly
                    title="New rates are always recorded with today's date"
                    data-table="currency_rates" data-col="date" />
                </div>
                <div className="form-field">
                  <span className="field-label">Rate → TRY *</span>
                  <input id="currency-history-totry-input" className="field-input" type="text" inputMode="decimal" placeholder="e.g. 39.50"
                    value={toTRY} onChange={e => setToTRY(e.target.value)}
                    data-table="currency_rates" data-col="rate_try" />
                </div>
                <div className="form-field">
                  <span className="field-label">Rate → USD</span>
                  <input id="currency-history-tousd-input" className="field-input" type="text" inputMode="decimal" placeholder="e.g. 1.09"
                    value={toUSD} onChange={e => setToUSD(e.target.value)}
                    data-table="currency_rates" data-col="rate_usd" />
                </div>
                <div className="form-field">
                  <span className="field-label">Source</span>
                  <StyledSelect id="currency-history-source-select" className="field-input" value={source} onChange={e => setSource(e.target.value)}>
                    <option value="TCMB">TCMB</option>
                    <option value="Market">Market</option>
                  </StyledSelect>
                </div>
                <div className="form-field">
                  <span className="field-label">Note</span>
                  <input id="currency-history-note-input" className="field-input" type="text" placeholder="Optional note"
                    value={note} onChange={e => setNote(e.target.value)}
                    data-table="currency_rates" data-col="note" />
                </div>
              </div>
              {err && <span className="cfg-hist-err"><Icon name="alert-triangle" size={12} />{err}</span>}
              <div className="cfg-hist-form-foot">
                <button type="submit" id="currency-history-add-btn" className="amb ok"><Icon name="plus" size={14} />Add Rate</button>
              </div>
            </form>
            {/* History table */}
            <div className="cfg-hist-table-wrap">
              <span className="cfg-hist-section-title"><Icon name="history" size={13} />Rate History</span>
              {sorted.length === 0 ? (
                <div className="cfg-empty" style={{ padding: '20px 0' }}>
                  <Icon name="inbox" size={24} color="var(--muted)" />
                  <span>No history yet.</span>
                </div>
              ) : (
                <table className="ledger-table cfg-table cfg-hist-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Rate → TRY</th>
                      <th>Rate → USD</th>
                      <th>Source</th>
                      <th>Note</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((h, i) => (
                      <tr key={h.date} className={'cfg-row' + (i === 0 ? ' cfg-hist-current' : '')}>
                        <td data-label="Date">{h.date}</td>
                        <td data-label="Rate → TRY"><b>{h.toTRY}</b></td>
                        <td data-label="Rate → USD">{h.toUSD ?? '—'}</td>
                        <td data-label="Source"><SourceBadge source={h.source} /></td>
                        <td data-label="Note" style={{ color: 'var(--muted)' }}>{h.note || '—'}</td>
                        <td>
                          {i === 0 && <span className="cfg-badge cfg-badge-income" style={{ fontSize: '10px' }}>Current</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div className="modal-foot">
            <button id="currency-history-close-foot-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Close</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Retrieve from TCMB modal ───────────────────────────────────────────────
  //    Simulates pulling the latest official TCMB bulletin, previews the diff vs.
  //    the stored rates, and on Apply stamps each currency source=TCMB + today's date
  //    and appends a history entry.
  function TcmbRetrieveModal({ currencies, onApply, onClose }) {
    const today = todayYMD();
    const rows = (currencies || [])
      .filter(c => c.code !== 'TRY')
      .map(c => {
        const off = TCMB_RATES[c.code];
        const available = off != null;
        const newTRY = available ? off : c.toTRY;
        const delta = available ? +(newTRY - (c.toTRY || 0)).toFixed(4) : 0;
        return { code: c.code, sym: SYM[c.code] || c.code, available, curTRY: c.toTRY, newTRY, delta, src: c.source };
      });
    const matched = rows.filter(r => r.available);
    const changed = matched.filter(r => Math.abs(r.delta) > 0.00005).length;

    function apply() {
      const updated = (currencies || []).map(c => {
        if (c.code === 'TRY') return c;
        const off = TCMB_RATES[c.code];
        if (off == null) return c; // not on this bulletin — leave untouched
        const newUSD = +(off / TCMB_RATES.USD).toFixed(4);
        const entry = { date: today, toTRY: off, toUSD: newUSD, source: 'TCMB', note: 'TCMB bulletin ' + TCMB_BULLETIN };
        const newHistory = [...(c.history || []).filter(h => h.date !== today), entry]
          .sort((a, b) => b.date.localeCompare(a.date));
        return { ...c, toTRY: off, toUSD: newUSD, asOf: today, source: 'TCMB', history: newHistory };
      });
      onApply(updated);
    }

    return (
      <div className="backdrop" onMouseDown={e => { if (e.target.classList.contains('backdrop')) onClose(); }}>
        <div className="modal cfg-modal cfg-tcmb-modal">
          <div className="modal-head">
            <span className="modal-title">
              <Icon name="refresh-cw" size={15} color="var(--gold)" />
              Retrieve From TCMB
            </span>
            <button id="tcmb-retrieve-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={16} /></button>
          </div>
          <div className="cfg-tcmb-body">
            <div className="cfg-tcmb-banner">
              <Icon name="landmark" size={15} />
              <div className="cfg-tcmb-banner-txt">
                <span className="cfg-tcmb-banner-title">TCMB Döviz Satış · Bulletin {TCMB_BULLETIN}</span>
                <span className="cfg-tcmb-banner-sub">{matched.length} currencies matched · {changed} will change · effective {today}</span>
              </div>
            </div>
            <table className="ledger-table cfg-table cfg-hist-table cfg-tcmb-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th className="num">Current → TRY</th>
                  <th className="num">TCMB → TRY</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.code} className="cfg-row">
                    <td data-label="Code"><span className="cur-sym" style={{ fontSize: '14px', marginRight: '6px' }}>{r.sym}</span>{r.code}</td>
                    <td data-label="Current → TRY" className="num">₺{String(r.curTRY)}</td>
                    <td data-label="TCMB → TRY" className="num">{r.available ? '₺' + String(r.newTRY) : <span style={{ color: 'var(--muted)' }}>Not on bulletin</span>}</td>
                    <td data-label="Change" className="num">
                      {!r.available ? <span style={{ color: 'var(--muted)' }}>—</span>
                        : Math.abs(r.delta) < 0.00005 ? <span className="cfg-tcmb-delta flat">No change</span>
                        : <span className={'cfg-tcmb-delta ' + (r.delta > 0 ? 'up' : 'down')}>{r.delta > 0 ? '↑ +' : '↓ '}{String(Math.abs(r.delta))}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <span className="cfg-tcmb-foot-note"><Icon name="info" size={12} />Applying overwrites the current rate, marks the source as TCMB, and records a history entry dated {today}.</span>
          </div>
          <div className="modal-foot">
            <button id="tcmb-retrieve-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            <button id="tcmb-retrieve-apply-btn" className="amb ok" onClick={apply} disabled={matched.length === 0}><Icon name="file-input" size={14} />Apply Rates</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Initial data loader ──────────────────────────────────────────────────
  function getInitialData(sectionId) {
    const L = window.LEDGER || {};
    const A = window.ACCOUNTS_DATA || {};
    switch (sectionId) {
      case 'categories': {
        const cats = L.CATS || {};
        return Object.entries(cats).map(([key, v]) => ({ id: key, key, label: v.label, icon: v.icon, color: v.color, kind: v.kind }));
      }
      case 'members':
        return (L.PAYERS || []).map((name, i) => ({
          id: 'p-' + i, name,
          username: name.toLowerCase(),
          password: 'pass1234',
          role: i === 0 ? 'admin' : 'user',
          active: true,
          showAsPayer: true,
        }));
      case 'currencies': {
        const fx = L.FX || {};
        return Object.entries(fx).map(([code, v]) => {
          const hist = CURRENCY_SAMPLE_HISTORY[code] ||
            [{ date: todayYMD(), toTRY: v.toTRY, toUSD: v.toUSD, source: 'TCMB', note: 'Initial rate' }];
          const latest = [...hist].sort((a, b) => b.date.localeCompare(a.date))[0];
          const isBase = code === 'TRY';
          return {
            id: code, code,
            toTRY: isBase ? 1 : latest.toTRY,
            toUSD: isBase ? v.toUSD : (latest.toUSD ?? v.toUSD),
            asOf:   isBase ? null : latest.date,
            source: isBase ? null : latest.source,
            history: hist,
          };
        });
      }
      case 'cc-types': {
        const cc = A.CC_TYPES || {};
        return Object.entries(cc).map(([key, v]) => ({ id: key, key, label: v.label, icon: v.icon }));
      }
      case 'debit-types': {
        const dc = A.DEBIT_TYPES || {};
        return Object.entries(dc).map(([key, v]) => ({ id: key, key, label: v.label, icon: v.icon }));
      }
      case 'account-types': {
        const at = A.ACCOUNT_TYPES || {};
        return Object.entries(at).map(([key, v]) => ({ id: key, key, label: v.label, icon: v.icon, color: v.color }));
      }
      case 'financial-institutions':
        return []; // loaded from the backend on mount (see effect in App)
      case 'statement-mappings':
        return []; // loaded from the backend on mount (see effect in App)
      default: return [];
    }
  }

  // Sections with no backend table: their edits persist to localStorage so they
  // survive reload (accounts-data.js reads these overrides on load). Serialize the
  // row list back to the { key: {…rest} } map shape those maps use.
  // 'financial-institutions' is NOT here any more — it persists to the backend
  // financial_institutions table (logos included), like categories/currencies.
  const CLIENT_PERSIST_SECTIONS = ['account-types', 'cc-types', 'debit-types'];
  function persistClientSection(sectionId, rows) {
    if (!CLIENT_PERSIST_SECTIONS.includes(sectionId)) return;
    const map = {};
    rows.forEach(({ id, key, ...rest }) => { if (key) map[key] = rest; });
    try { localStorage.setItem('hl-cfg-' + sectionId + '-data', JSON.stringify(map)); } catch (e) { /* quota/unavailable */ }
  }

  // Statement Value Mapping option lists (built from the static category seed;
  // DB-hydrated categories share the same keys so the picker stays valid).
  const LANG_OPTIONS = [
    { value: 'tr', label: 'Turkish (tr)' },
    { value: 'en', label: 'English (en)' },
  ];
  const CATEGORY_OPTIONS = Object.entries((window.LEDGER && window.LEDGER.CATS) || {})
    .map(([key, v]) => ({ value: key, label: v.label || key }));

  // ── Sections definition ──────────────────────────────────────────────────
  const SECTIONS = [
    {
      id: 'members', label: 'Members', icon: 'users', color: 'var(--green)', addLabel: 'Add Member',
      desc: 'Users and their access roles',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'username', label: 'Username' },
        { key: 'password', label: 'Password', render: v => <span className="cfg-pw-mask">••••••••</span> },
        { key: 'role', label: 'Role', render: v => <span className={'cfg-badge cfg-badge-' + (v || 'user')}>{v === 'admin' ? 'Admin' : 'User'}</span> },
        { key: 'active', label: 'Status', render: v => { const on = v !== false; return <span className={'cfg-status cfg-status-' + (on ? 'active' : 'inactive')}><span className="cfg-status-dot" />{on ? 'Active' : 'Inactive'}</span>; } },
        { key: 'showAsPayer', label: 'Payer Visibility', render: v => { const on = v !== false; return <span className={'cfg-status cfg-status-' + (on ? 'active' : 'inactive')}><span className="cfg-status-dot" />{on ? 'Visible' : 'Hidden'}</span>; } },
      ],
      fields: [
        { key: 'name',     label: 'Full Name', type: 'text', required: true, placeholder: 'e.g. Alex' },
        { key: 'username', label: 'Username',  type: 'text', required: true, placeholder: 'e.g. alex', hint: 'Login identifier, no spaces' },
        { key: 'password', label: 'Password',  type: 'password', requiredOnCreate: true, placeholder: 'Enter password', editHint: 'Leave blank to keep the current password' },
        { key: 'role',     label: 'Role',       type: 'select', required: true, options: [{ value: 'admin', label: 'Admin — Full access including Configuration' }, { value: 'user', label: 'User — Standard access, no Configuration' }] },
        { key: 'active',   label: 'Status',     type: 'checkbox', default: true, checkboxLabel: 'Active - Can Log In', hint: 'Inactive members are kept on file but cannot sign in' },
        { key: 'showAsPayer', label: 'Payer Visibility', type: 'checkbox', default: true, checkboxLabel: 'Show as Payer / Paying For option', hint: 'Uncheck to hide this member from the Payer and Paying For dropdowns, independent of login access' },
      ],
    },
    {
      id: 'categories', label: 'Transaction Categories', icon: 'tag', color: 'var(--lavender)', addLabel: 'Add Category',
      desc: 'Classify income and expenses',
      columns: [
        { key: 'icon',  label: 'Icon',  render: (v, row) => <span className="cfg-icon-preview"><Icon name={v} size={14} color={row.color} /></span> },
        { key: 'label', label: 'Label' },
        { key: 'kind',  label: 'Kind',  render: v => <span className={'cfg-badge cfg-badge-' + v}>{v}</span> },
        { key: 'color', label: 'Color', render: v => <span className="cfg-color-dot" style={{ background: v }} /> },
      ],
      fields: [
        { key: 'label', label: 'Label',  type: 'text',   required: true, placeholder: 'e.g. Dining' },
        { key: 'key',   label: 'Key',    type: 'text',   required: true, placeholder: 'e.g. dining', hint: 'Lowercase identifier, no spaces' },
        { key: 'icon',  label: 'Icon',   type: 'icon',   placeholder: 'Lucide icon name, e.g. utensils' },
        { key: 'color', label: 'Color',  type: 'color' },
        { key: 'kind',  label: 'Kind',   type: 'select', options: [{ value: 'income', label: 'Income' }, { value: 'expense', label: 'Expense' }] },
      ],
    },
    {
      id: 'currencies', label: 'Currencies', icon: 'circle-dollar-sign', color: 'var(--gold)', addLabel: 'Add Currency',
      extraRowAction: (item, { onHistory }) => (
        <button className="cfg-act-btn history" title="Rate History" onClick={() => onHistory(item)}>
          <Icon name="clock" size={13} />History
        </button>
      ),
      desc: 'Currencies and FX rates vs TRY',
      columns: [
        { key: 'asOf',  label: 'Date', render: v => v ? <span style={{whiteSpace:'nowrap'}}>{v}</span> : <span style={{color:'var(--muted)'}}>—</span> },
        { key: 'source', label: 'Source', render: v => <SourceBadge source={v} /> },
        { key: 'toTRY', label: 'Rate → TRY', render: v => v === 1 ? <span style={{color:'var(--muted)'}}>Base</span> : <span>₺{String(v)}</span> },
        { key: 'toUSD', label: 'Rate → USD', render: v => v === 1 ? <span style={{color:'var(--muted)'}}>Base</span> : <span>${Number(v).toFixed(4)}</span> },
        { key: 'code',  label: 'Code', render: v => <span className="amount-cell" style={{justifyContent:'flex-start'}}><span className={'cur-sym cur-' + v} style={{fontSize:'15px'}}>{SYM[v] || v}</span></span> },
      ],
      fields: [
        { key: 'code',  label: 'Currency Code', type: 'text',   required: true, placeholder: 'e.g. GBP', hint: '3-letter ISO code' },
        { key: 'asOf',  label: 'Date',          type: 'date',   lockToday: true, hint: 'Defaults to today — change if backdating a rate' },
        { key: 'toTRY', label: 'Rate → TRY',    type: 'number', placeholder: 'e.g. 50.40', hint: '1 unit of this currency = ? TRY' },
        { key: 'toUSD', label: 'Rate → USD',    type: 'number', placeholder: 'e.g. 1.28',  hint: '1 unit of this currency = ? USD' },
        { key: 'source',label: 'Source',         type: 'select', options: SOURCE_OPTIONS, hint: 'Where this rate came from' },
      ],
    },
    {
      id: 'cc-types', label: 'Credit Card Types', icon: 'credit-card', color: CREDIT_COLOR, addLabel: 'Add Credit Card Type',
      desc: 'Card networks for credit cards',
      columns: [
        { key: 'icon',  label: 'Icon',  render: v => <span className="cfg-icon-preview"><Icon name={v} size={14} /></span> },
        { key: 'label', label: 'Label' },
      ],
      fields: [
        { key: 'label', label: 'Label', type: 'text', required: true, placeholder: 'e.g. Amex' },
        { key: 'key',   label: 'Key',   type: 'text', required: true, placeholder: 'e.g. amex', hint: 'Lowercase identifier' },
        { key: 'icon',  label: 'Icon',  type: 'icon', placeholder: 'e.g. credit-card' },
      ],
    },
    {
      id: 'debit-types', label: 'Debit Card Types', icon: 'wallet-cards', color: 'var(--sky)', addLabel: 'Add Debit Card Type',
      desc: 'Card networks for debit cards',
      columns: [
        { key: 'icon',  label: 'Icon',  render: v => <span className="cfg-icon-preview"><Icon name={v} size={14} /></span> },
        { key: 'label', label: 'Label' },
      ],
      fields: [
        { key: 'label', label: 'Label', type: 'text', required: true, placeholder: 'e.g. Visa Debit' },
        { key: 'key',   label: 'Key',   type: 'text', required: true, placeholder: 'e.g. visa-debit', hint: 'Lowercase identifier' },
        { key: 'icon',  label: 'Icon',  type: 'icon', placeholder: 'e.g. wallet-cards' },
      ],
    },
    {
      id: 'account-types', label: 'Account Types', icon: 'landmark', color: 'var(--accent)', addLabel: 'Add Account Type',
      desc: 'Financial account types',
      columns: [
        { key: 'icon',  label: 'Icon',  render: (v, row) => <span className="cfg-icon-preview"><Icon name={v} size={14} color={row.color} /></span> },
        { key: 'label', label: 'Label' },
        { key: 'color', label: 'Color', render: v => <span className="cfg-color-dot" style={{ background: v }} /> },
      ],
      fields: [
        { key: 'label', label: 'Label', type: 'text',  required: true, placeholder: 'e.g. Savings Account' },
        { key: 'key',   label: 'Key',   type: 'text',  required: true, placeholder: 'e.g. savings', hint: 'Lowercase identifier' },
        { key: 'icon',  label: 'Icon',  type: 'icon',  placeholder: 'e.g. landmark' },
        { key: 'color', label: 'Color', type: 'color' },
      ],
    },
    {
      id: 'financial-institutions', label: 'Financial Institutions', icon: 'building-2', color: 'var(--steel)', addLabel: 'Add Institution',
      desc: 'Banks and providers for the account picker',
      columns: [
        { key: 'logo',  label: 'Logo', render: v => v ? <span className="cfg-logo-cell"><img src={v} alt="" /></span> : <span className="cfg-logo-cell cfg-logo-empty"><Icon name="building-2" size={14} /></span> },
        { key: 'name',  label: 'Name' },
        { key: 'shortName', label: 'Short Name' },
        { key: 'swift', label: 'SWIFT / BIC', render: v => v ? <span className="cfg-mono">{v}</span> : <span style={{ color: 'var(--muted)' }}>—</span> },
      ],
      fields: [
        { key: 'name',  label: 'Name',       type: 'text', required: true, placeholder: 'e.g. Garanti BBVA' },
        { key: 'shortName', label: 'Short Name', type: 'text', required: true, placeholder: 'e.g. Garanti' },
        { key: 'key',   label: 'Key',        type: 'text', required: true, placeholder: 'e.g. garanti', hint: 'Lowercase identifier' },
        { key: 'swift', label: 'SWIFT / BIC', type: 'text', placeholder: 'e.g. TGBATRIS', hint: '8 or 11-character bank code' },
        { key: 'logo',  label: 'Logo',        type: 'image', placeholder: 'Paste image URL (https://…)', hint: 'Paste an internet image URL or upload one from your computer' },
      ],
    },
    {
      id: 'statement-mappings', label: 'Statement Value Mapping', icon: 'file-symlink', color: 'var(--sky)', addLabel: 'Add Mapping',
      desc: 'Map bank-statement tags (Etiket) to categories on import',
      columns: [
        { key: 'lang',   label: 'Lang', render: v => <span className={'cfg-badge'}>{String(v || 'tr').toUpperCase()}</span> },
        { key: 'etiket', label: 'Statement Tag' },
        { key: 'category_key', label: 'Category', render: v => {
            const c = ((window.LEDGER && window.LEDGER.CATS) || {})[v];
            return c ? c.label : v;
          } },
      ],
      fields: [
        { key: 'lang',   label: 'Language', type: 'select', required: true, options: LANG_OPTIONS, hint: 'Language of the statement this tag comes from' },
        { key: 'etiket', label: 'Statement Tag (Etiket)', type: 'text', required: true, placeholder: 'e.g. Para Transferi', hint: 'The tag exactly as printed on the statement — spacing and diacritics are ignored when matching' },
        { key: 'category_key', label: 'Category', type: 'select', required: true, options: CATEGORY_OPTIONS, hint: 'Matching statement lines are booked to this category' },
      ],
    },
  ];

  // ── Sidebar ──────────────────────────────────────────────────────────────
  // Sidebar is provided by the shared single-source module (nav.jsx → window.HL_NAV).

  // Read an image File, downscale it to a small logo, and return a PNG data URL.
  // Institutions are a client-persist (localStorage) section, so logos must stay
  // tiny — cap the longest edge at 96px to keep the serialized map well under quota.
  function fileToLogoDataURL(file, max = 96) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('invalid image'));
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ── Item Modal ───────────────────────────────────────────────────────────
  function ItemModal({ section, item, onSave, onDelete, onHistory, onClose }) {
    const FormError = window.HL_FORM && window.HL_FORM.FormError;
    const editing = !!item;
    const blank = {};
    section.fields.forEach(f => { blank[f.key] = f.type === 'checkbox' ? (f.default ?? false) : ''; });
    const initial = editing ? { ...item } : blank;
    // Date fields flagged lockToday default to today's date for new entries, but stay editable.
    if (!editing) section.fields.forEach(fd => { if (fd.lockToday) initial[fd.key] = todayYMD(); });
    const [f, setF] = React.useState(initial);
    const [err, setErr] = React.useState('');
    const [invalid, setInvalid] = React.useState({});
    const set = (k, v) => {
      setF(p => ({ ...p, [k]: v }));
      if (invalid[k]) setInvalid(p => ({ ...p, [k]: false }));
      if (err) setErr('');
    };

    function submit(e) {
      e.preventDefault();
      const required = section.fields
        .filter(x => x.required || (x.requiredOnCreate && !editing))
        .map(fd => ({
          key: fd.key,
          label: fd.label,
          ok: f[fd.key] !== undefined && f[fd.key] !== null && String(f[fd.key]).trim(),
        }));
      const result = window.HL_FORM && window.HL_FORM.checkRequired
        ? window.HL_FORM.checkRequired(required)
        : (() => {
          const missing = required.filter(s => !s.ok);
          const keys = {};
          missing.forEach(s => { keys[s.key] = true; });
          return { ok: !missing.length, keys, message: missing.length ? 'Please fill in the required fields.' : '' };
        })();
      if (!result.ok) {
        setInvalid(result.keys);
        setErr(result.message);
        return;
      }
      setInvalid({});
      setErr('');
      const newId = editing ? item.id : (f.key || f.code || f.name || String(Date.now()));
      onSave({ ...f, id: newId });
    }

    return (
      <div className="backdrop" onMouseDown={e => { if (e.target.classList.contains('backdrop')) onClose(); }}>
        <div className="modal cfg-modal">
          <div className="modal-head">
            <span className="modal-title">
              <Icon name={section.icon} size={15} color={section.color} />
              {editing ? 'Edit' : 'Add'} — {section.label}
            </span>
            <button id="cfg-item-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={16} /></button>
          </div>
          <form onSubmit={submit}>
            <div className="cfg-modal-body">
              {section.fields.map(fd => (
                fd.type === 'checkbox' ? (
                  <div key={fd.key} className={'form-field full' + (invalid[fd.key] ? ' field-invalid' : '')}>
                    <label className="acct-check-label">
                      <input type="checkbox"
                        id={'cfg-field-' + fd.key}
                        data-table="members" data-col={fd.key}
                        checked={f[fd.key] !== false}
                        onChange={e => set(fd.key, e.target.checked)} />
                      {fd.checkboxLabel || fd.label}
                    </label>
                    {fd.hint && <span className="field-hint">{fd.hint}</span>}
                  </div>
                ) : (
                <div key={fd.key} className={'form-field full' + (invalid[fd.key] ? ' field-invalid' : '')}>
                  <span className="field-label">
                    {fd.label}{(fd.required || (fd.requiredOnCreate && !editing)) && <span className="field-required-mark">*</span>}
                  </span>
                  {(editing && fd.editHint ? fd.editHint : fd.hint) && <span className="field-hint">{editing && fd.editHint ? fd.editHint : fd.hint}</span>}
                  {fd.type === 'select' ? (
                    <StyledSelect className="field-input" id={'cfg-field-' + fd.key} value={f[fd.key] || ''}
                      onChange={e => set(fd.key, e.target.value)}>
                      <option value="">— Select —</option>
                      {fd.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </StyledSelect>
                  ) : fd.type === 'color' ? (
                    <div className="cfg-color-grid">
                      {COLOR_OPTIONS.map(c => (
                        <button key={c.var} type="button"
                          id={'cfg-field-' + fd.key + '-swatch-' + c.label.toLowerCase()}
                          className={'cfg-color-swatch' + (f[fd.key] === c.var ? ' selected' : '')}
                          style={{ background: c.hex }} title={c.label}
                          onClick={() => set(fd.key, c.var)} />
                      ))}
                    </div>
                  ) : fd.type === 'icon' ? (
                    <div className="cfg-icon-picker">
                      <div className="cfg-icon-grid">
                        {ICON_OPTIONS.map(name => (
                          <button key={name} type="button"
                            id={'cfg-field-' + fd.key + '-icon-' + name}
                            className={'cfg-icon-swatch' + (f[fd.key] === name ? ' selected' : '')}
                            title={name}
                            onClick={() => set(fd.key, name)}>
                            <Icon name={name} size={18} />
                          </button>
                        ))}
                      </div>
                      <div className="cfg-icon-field">
                        <input className="field-input" id={'cfg-field-' + fd.key} type="text"
                          placeholder={fd.placeholder || 'or type any Lucide icon name'}
                          value={f[fd.key] || ''} onChange={e => set(fd.key, e.target.value)} />
                        {f[fd.key] && <span className="cfg-icon-field-preview"><Icon name={f[fd.key]} size={18} color="var(--accent)" /></span>}
                      </div>
                    </div>
                  ) : fd.type === 'image' ? (
                    <div className="cfg-image-field">
                      <span className="cfg-image-preview">
                        {f[fd.key]
                          ? <img src={f[fd.key]} alt="Logo preview" />
                          : <Icon name="image" size={20} />}
                      </span>
                      <div className="cfg-image-controls">
                        <input className="field-input" id={'cfg-field-' + fd.key} type="text"
                          placeholder={fd.placeholder || 'Paste image URL (https://…)'}
                          value={f[fd.key] || ''} onChange={e => set(fd.key, e.target.value)} />
                        <div className="cfg-image-btns">
                          <label id={'cfg-field-' + fd.key + '-upload-btn'} className="list-btn blue cfg-image-upload" htmlFor={'cfg-field-' + fd.key + '-file'}>
                            <Icon name="upload" size={12} />Upload
                          </label>
                          <input id={'cfg-field-' + fd.key + '-file'} type="file" accept="image/*" className="cfg-image-file"
                            onChange={async e => {
                              const file = e.target.files && e.target.files[0];
                              if (file) {
                                try { set(fd.key, await fileToLogoDataURL(file)); }
                                catch (err) { alert('Could not read image: ' + err.message); }
                              }
                              e.target.value = '';
                            }} />
                          {f[fd.key] && (
                            <button type="button" id={'cfg-field-' + fd.key + '-remove-btn'} className="list-btn red" onClick={() => set(fd.key, '')}>
                              <Icon name="x" size={12} />Remove
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : fd.type === 'date' ? (
                    <DateInput
                      id={'cfg-field-' + fd.key}
                      dataTable={section.id} dataCol={fd.key}
                      value={f[fd.key] || ''} onChange={e => set(fd.key, e.target.value)} />
                  ) : fd.type === 'password' ? (
                    <input className="field-input" id={'cfg-field-' + fd.key} type="password"
                      placeholder={fd.placeholder || ''} value={f[fd.key] || ''}
                      autoComplete="new-password"
                      onChange={e => set(fd.key, e.target.value)} />
                  ) : (
                    <input className="field-input" id={'cfg-field-' + fd.key} type="text"
                      inputMode={fd.type === 'number' ? 'decimal' : 'text'}
                      data-table={section.id} data-col={fd.key}
                      placeholder={fd.placeholder || ''} value={f[fd.key] || ''}
                      onChange={e => set(fd.key, e.target.value)} />
                  )}
                </div>
                )
              ))}
            </div>
            {FormError ? (
              <FormError id="cfg-form-error" message={err} />
            ) : (
              err ? <div className="form-error" id="cfg-form-error">{err}</div> : null
            )}
            <div className="modal-foot">
              {editing && (
                <div className="cfg-modal-foot-left">
                  {section.extraRowAction && (
                    <button type="button" id="cfg-item-history-btn" className="amb history"
                      onClick={() => { onClose(); onHistory && onHistory(item); }}>
                      <Icon name="clock" size={14} />History
                    </button>
                  )}
                  <button type="button" id="cfg-item-delete-btn" className="amb danger"
                    onClick={() => onDelete(item)}>
                    <Icon name="trash-2" size={14} />Delete
                  </button>
                </div>
              )}
              <button type="button" id="cfg-item-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
              <button type="submit" id="cfg-item-save-btn" className="amb ok"><Icon name="check" size={14} />Save</button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ── Filter bar (mirrors the Spending filter bar) — search + a Filters popover
  //    for facet selects, with the shared More menu beside it. ──
  function CfgFilterBar({ table, search, setSearch, facets, setFacet, facetCols, searchCols, moreNode, popActions }) {
    const [open, setOpen] = React.useState(false);
    const anchorRef = React.useRef(null);
    React.useEffect(() => {
      if (!open) return;
      // Don't close on clicks inside a portaled StyledSelect dropdown (rendered to
      // <body>), or picking a filter option would unmount the popover mid-click.
      const onDoc = (e) => { if (anchorRef.current && !anchorRef.current.contains(e.target) && !e.target.closest('.ss-dropdown')) setOpen(false); };
      const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
      return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const facetLabel = (fc, v) => { const o = fc.options.find(o => o.value === v); return o ? o.label : v; };
    const active = facetCols.filter(fc => facets[fc.key]).map(fc => ({
      key: fc.key, label: fc.label, val: facetLabel(fc, facets[fc.key]), clear: () => setFacet(fc.key, 'all'),
    }));
    const clearAll = () => facetCols.forEach(fc => setFacet(fc.key, 'all'));

    return (
      <div className="filter-wrap cfg-filter-wrap">
        <div className="filter-bar">
          <div className="filter-field ff-search">
            <span className="filter-label"><Icon name="search" size={11} />Search</span>
            <div className="search-wrap">
              <Icon name="search" size={13} />
              <input id="cfg-filter-search-input" className="search-input" placeholder="Search…" value={search}
                data-table={table} data-cols={searchCols.join(',')}
                onChange={(e) => setSearch(e.target.value)} />
              {search && <button id="cfg-filter-search-clear-btn" className="search-clear" onClick={() => setSearch('')} title="Clear search"><Icon name="x" size={13} /></button>}
            </div>
          </div>

          {moreNode}

          <div className="filter-field ff-filters">
            <span className="filter-label"><Icon name="sliders-horizontal" size={11} />Filters</span>
            <div className="filters-anchor" ref={anchorRef}>
              <button id="cfg-filter-toggle-btn" className={'filters-btn' + (active.length ? ' has' : '') + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
                <Icon name="sliders-horizontal" size={14} /><span className="filters-text">Filters</span>
                {active.length > 0 && <span className="filters-count">{active.length}</span>}
                <svg className="filters-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {open && (
                <div className="filters-pop">
                  {popActions && <div className="fp-actions"><div className="filters-pop-head"><span>More Actions</span></div>{popActions}</div>}
                  <div className="filters-pop-head">
                    <span>Filter By Column</span>
                    {active.length > 0 && <button id="cfg-filter-clear-all-btn" className="fp-clear" onClick={clearAll}><Icon name="x" size={12} />Clear All</button>}
                  </div>
                  {facetCols.map(fc => (
                    <div className="filter-field" key={fc.key}>
                      <span className="filter-label">{fc.label}</span>
                      <div className="select-wrap">
                        <StyledSelect className="sel" id={'cfg-filter-' + fc.key + '-select'} value={facets[fc.key] || 'all'}
                          onChange={(e) => setFacet(fc.key, e.target.value)}>
                          <option value="all">All</option>
                          {fc.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </StyledSelect>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {active.length > 0 && (
          <div className="active-chips">
            <span className="chips-lead"><Icon name="filter" size={12} />Active</span>
            {active.map(a => (
              <button key={a.key} id={'cfg-filter-chip-' + a.key} className="chip" onClick={a.clear} title={'Clear ' + a.label + ' filter'}>
                <span className="chip-k">{a.label}:</span><span className="chip-v">{a.val}</span><Icon name="x" size={11} />
              </button>
            ))}
            <button id="cfg-filter-chips-clear-btn" className="chip chip-clear" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>
    );
  }

  // ── Detail section table — sortable, resizable, drag-reorderable; rows open the editor ──
  function CfgSectionTable({ section, items, onEdit, onAdd, onTcmb, onBatchDelete }) {
    const { useResizableColumns, ColResizer, FitColumnsButton, ResetOrderButton, ExportData } = window;
    // Map the section's columns to the resizable hook's descriptor shape.
    const cols = React.useMemo(() => section.columns.map(c => ({
      key: c.key, label: c.label, render: c.render, num: c.num,
      size: c.size || 180, minSize: c.minSize || 90, maxSize: c.maxSize || 520,
    })), [section]);
    const rz = useResizableColumns({ columns: cols, storageKey: 'hl-cfg-' + section.id + '-colcfg' });

    // ── Search + facet filters (mirrors the Spending filter bar) ──
    // Facet selects are derived from the section's own `select` fields, so each
    // section gets a sensible "Filter By Column" set (e.g. Members → Role).
    const facetCols = React.useMemo(() => section.columns.map(c => {
      const fld = (section.fields || []).find(f => f.key === c.key && f.type === 'select' && Array.isArray(f.options));
      if (!fld) return null;
      return {
        key: c.key, label: c.label,
        options: fld.options.map(o => ({ value: o.value, label: (String(o.label).split('—')[0] || o.value).trim() })),
      };
    }).filter(Boolean), [section]);
    // Columns worth searching (skip masked / non-text render columns).
    const searchCols = React.useMemo(
      () => section.columns.map(c => c.key).filter(k => !['password', 'icon', 'color'].includes(k)),
      [section]);
    // CSV export columns: section's own columns minus sensitive/non-text ones.
    const exportCols = React.useMemo(
      () => section.columns.filter(c => c.key !== 'password').map(c => ({ key: c.key, label: c.label })),
      [section]);
    const [search, setSearch] = React.useState('');
    const [facets, setFacets] = React.useState({});
    const setFacet = (k, v) => setFacets(p => { const n = { ...p }; if (!v || v === 'all') delete n[k]; else n[k] = v; return n; });
    const filteredItems = React.useMemo(() => {
      const q = search.trim().toLowerCase();
      return items.filter(it => {
        for (const k in facets) { if (String(it[k]) !== facets[k]) return false; }
        if (q) {
          const hay = searchCols.map(k => String(it[k] ?? '')).join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
    }, [items, facets, search, searchCols]);

    // ── Sorting — click a header to sort by that column (raw value, natural order) ──
    const [sort, setSort] = React.useState({ col: null, dir: 'asc' });
    function toggleSort(col) {
      if (rz.isResizing || rz.wasResizingRef.current) return;   // never sort from a resize/reorder gesture
      setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
    }
    const sortedItems = React.useMemo(() => {
      if (!sort.col) return filteredItems;
      const arr = filteredItems.slice();
      arr.sort((a, b) => {
        const av = a[sort.col], bv = b[sort.col];
        let r;
        if (typeof av === 'number' && typeof bv === 'number') r = av - bv;
        else r = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true, sensitivity: 'base' });
        return sort.dir === 'asc' ? r : -r;
      });
      return arr;
    }, [filteredItems, sort]);

    // ── Mass-delete: checkbox selection over the visible (filtered) rows ──
    const [selected, setSelected] = React.useState(() => new Set());
    const [batchDel, setBatchDel] = React.useState(false);
    const toggleSelect = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    // Clear the selection when the visible set changes via search/facets.
    React.useEffect(() => { setSelected(new Set()); }, [search, facets]);
    const selectedItems = React.useMemo(() => items.filter(it => selected.has(it.id)), [items, selected]);
    const visibleIds = sortedItems.map(it => it.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
    const someSelected = !allSelected && visibleIds.some(id => selected.has(id));
    const toggleSelectAll = () => setSelected(s => {
      const n = new Set(s);
      if (allSelected) visibleIds.forEach(id => n.delete(id));
      else visibleIds.forEach(id => n.add(id));
      return n;
    });
    async function runBatchDelete() {
      await onBatchDelete(selectedItems);
      setSelected(new Set());
      setBatchDel(false);
    }

    // On first mount the sidebar may not have applied its width offset yet, so the
    // hook's initial auto-fit can measure a too-wide container. If the user has no
    // saved widths for this section, re-fit once after layout settles.
    React.useEffect(() => {
      let saved = false;
      try { saved = Object.keys(JSON.parse(localStorage.getItem(rz.storageKey || ('hl-cfg-' + section.id + '-colcfg')) || '{}')).length > 0; } catch (e) {}
      if (saved) return;
      const id = requestAnimationFrame(() => requestAnimationFrame(() => rz.resetSizes()));
      return () => cancelAnimationFrame(id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const headTopRef = React.useRef(null);
    const headLeftRef = React.useRef(null);
    const addBtnRef = React.useRef(null);
    const tcmbBtnRef = React.useRef(null);
    const [addInMore, setAddInMore] = React.useState(false);
    React.useLayoutEffect(() => {
      let raf = 0;
      const measure = () => {
        if (!window.matchMedia('(max-width: 660px)').matches) {
          setAddInMore(false);
          return;
        }
        if (section.id === 'currencies') {
          setAddInMore(true);
          return;
        }
        const head = headTopRef.current;
        const left = headLeftRef.current;
        const add = addBtnRef.current;
        if (!head || !left || !add) return;
        const headWidth = head.getBoundingClientRect().width;
        const leftWidth = Math.ceil(left.scrollWidth || left.getBoundingClientRect().width);
        const addWidth = Math.ceil(add.getBoundingClientRect().width);
        const tcmbWidth = tcmbBtnRef.current ? Math.ceil(tcmbBtnRef.current.getBoundingClientRect().width) : 0;
        const needed = leftWidth + addWidth + tcmbWidth + (tcmbWidth ? 18 : 10);
        setAddInMore(needed > headWidth);
      };
      const schedule = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(measure);
      };
      schedule();
      window.addEventListener('resize', schedule);
      let ro = null;
      if (typeof ResizeObserver !== 'undefined' && headTopRef.current) {
        ro = new ResizeObserver(schedule);
        [headTopRef.current, headLeftRef.current, addBtnRef.current, tcmbBtnRef.current].filter(Boolean).forEach(el => ro.observe(el));
      }
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', schedule);
        if (ro) ro.disconnect();
      };
    }, [section.id, section.label, section.addLabel]);

    const popActions = addInMore
      ? <button id="cfg-add-item-fp-btn" className="action-modal-btn ok" onClick={onAdd}><Icon name="plus" size={14} />{section.addLabel || 'Add Item'}</button>
      : null;

    return (
      <React.Fragment>
        <header className="page-head">
          <div className="page-head-top" ref={headTopRef}>
            <div className="cfg-detail-head-left" ref={headLeftRef}>
              <div className="page-title-wrap cfg-detail-title-wrap">
                <div className="cfg-title-col">
                  <h1 className="page-title">{section.label}</h1>
                  {section.desc && <p className="page-subtitle">{section.desc}</p>}
                </div>
              </div>
            </div>
            <div className="head-actions cfg-head-actions">
              {section.id === 'currencies' && (
                <button id="cfg-tcmb-retrieve-btn" ref={tcmbBtnRef} className="action-modal-btn tcmb cfg-tcmb-btn" onClick={onTcmb}>
                  <Icon name="refresh-cw" size={14} />Retrieve From TCMB
                </button>
              )}
              <button id="cfg-add-item-btn" ref={addBtnRef} className={'action-modal-btn ok cfg-add-btn ha-overflow' + (addInMore ? ' cfg-add-overflowed' : '')} onClick={onAdd} aria-hidden={addInMore} tabIndex={addInMore ? -1 : undefined}>
                <Icon name="plus" size={14} />{section.addLabel || 'Add Item'}
              </button>
            </div>
          </div>
          <CfgFilterBar
            table={section.id}
            search={search} setSearch={setSearch}
            facets={facets} setFacet={setFacet} facetCols={facetCols} searchCols={searchCols}
            moreNode={<ExportData entity={section.id} entityLabel={section.label}
              columns={exportCols} rows={sortedItems} allRows={items} inline
              tableTools={<React.Fragment>
                <window.ColumnVisibilityButton columns={rz.allColumns} hiddenColumns={rz.hiddenColumns} onChange={rz.setColumnVisible} />
                <FitColumnsButton onClick={rz.resetSizes} />
                <ResetOrderButton onClick={rz.resetOrder} disabled={rz.isDefaultOrder} />
              </React.Fragment>} />}
            popActions={popActions} />
        </header>

        <div className="table-card">
          {selectedItems.length > 0 && (
            <div className="bulk-bar" id="cfg-bulk-bar">
              <button id="cfg-bulk-selectall-btn" type="button" className="bulk-count bulk-check" onClick={toggleSelectAll} title={allSelected ? 'Clear all' : 'Select all'} aria-label={allSelected ? 'Clear all' : 'Select all'} aria-pressed={allSelected}><Icon name={allSelected ? 'check-square' : 'minus-square'} size={14} />{selectedItems.length} selected</button>
              <div className="bulk-actions">
                <button id="cfg-bulk-clear-btn" className="list-btn blue" onClick={() => setSelected(new Set())}><Icon name="x" size={12} />Clear</button>
                <button id="cfg-bulk-delete-btn" className="list-btn red" onClick={() => setBatchDel(true)}><Icon name="trash-2" size={12} />Delete Selected</button>
              </div>
            </div>
          )}
          <div className="table-scroll">
            <table ref={rz.tableRef} className="ledger-table cfg-table resizable zebra selectable" style={rz.colSizeVars}>
              <colgroup>
                <col className="col-select" />
                {rz.orderedColumns.map(c => <col key={c.key} style={{ width: 'var(--rz-' + c.key + ')' }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th className="th-select" title="Select all">
                    <input id="cfg-select-all" type="checkbox" className="row-select-box" checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected; }}
                      onChange={toggleSelectAll} aria-label="Select all rows" />
                  </th>
                  {rz.orderedColumns.map(c => (
                    <th key={c.key} className={(c.num ? 'num ' : '') + (sort.col === c.key ? 'sorted' : '')}
                      title="Drag To Reorder · Click To Sort"
                      {...rz.getReorderProps(c.key)}
                      onClick={() => toggleSort(c.key)}>
                      <span className="th-inner">
                        <span className="th-label">{c.label}</span>
                        <span className="sort-arrow">{sort.col === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                      </span>
                      <ColResizer header={rz.headersById[c.key]} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedItems.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={rz.orderedColumns.length + 1}>
                      <div className="cfg-empty">
                        <Icon name="inbox" size={32} color="var(--muted)" />
                        <span>No items yet — click Add to create one.</span>
                      </div>
                    </td>
                  </tr>
                ) : sortedItems.map(item => (
                  <tr key={item.id} className={'cfg-row' + (selected.has(item.id) ? ' row-selected' : '')} onClick={() => onEdit(item)}
                    title={'Edit ' + (item.label || item.name || item.code || 'item')}>
                    <td className="td-select" onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}>
                      <input id={'cfg-row-select-' + item.id} type="checkbox" className="row-select-box" checked={selected.has(item.id)}
                        onChange={() => {}} aria-label="Select row" />
                    </td>
                    {rz.orderedColumns.map(c => (
                      <td key={c.key} data-label={c.label} className={c.num ? 'num' : ''}>
                        {c.render ? c.render(item[c.key], item) : (item[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {batchDel && (
          <div className="backdrop" onMouseDown={e => { if (e.target.classList.contains('backdrop')) setBatchDel(false); }}>
            <div className="modal cfg-confirm">
              <div className="modal-head">
                <span className="modal-title"><Icon name="alert-triangle" size={15} color="var(--red)" />Delete Selected</span>
                <button id="cfg-batch-del-close-btn" className="m-close" onClick={() => setBatchDel(false)}><Icon name="x" size={16} /></button>
              </div>
              <div className="cfg-confirm-body">
                Delete <b>{selectedItems.length}</b> selected {selectedItems.length === 1 ? 'item' : 'items'} from {section.label}? This cannot be undone.
              </div>
              <div className="modal-foot">
                <button id="cfg-batch-del-cancel-btn" className="amb cancel" onClick={() => setBatchDel(false)}><Icon name="x" size={14} />Cancel</button>
                <button id="cfg-batch-del-confirm-btn" className="amb danger" onClick={runBatchDelete}><Icon name="trash-2" size={14} />Delete</button>
              </div>
            </div>
          </div>
        )}
      </React.Fragment>
    );
  }

  // ── App ──────────────────────────────────────────────────────────────────
  function App() {
    const { useTweaks, TweaksPanel, TweakSection, TweakColor } = window;
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

    const [view, setView] = React.useState(CFG_SECTION); // reads from window.CONFIG_SECTION or null = home grid
    const [sectionData, setSectionData] = React.useState(() => {
      const d = {};
      SECTIONS.forEach(s => { d[s.id] = getInitialData(s.id); });
      return d;
    });
    const [modal, setModal] = React.useState(null);
    const [confirmDel, setConfirmDel] = React.useState(null);
    const [histCurrency, setHistCurrency] = React.useState(null);
    const [tcmbOpen, setTcmbOpen] = React.useState(false);

    // Categories are persisted to the backend; load them on mount (the other
    // config sections still use their static seed for now).
    React.useEffect(() => {
      if (!window.HL_CATEGORIES_API) return;
      let alive = true;
      window.HL_CATEGORIES_API.list()
        .then(cats => { if (alive) setSectionData(prev => ({ ...prev, categories: cats })); })
        .catch(() => {});
      return () => { alive = false; };
    }, []);

    // Members are the backend Users table; load them on mount (only on the
    // Members config page, which is the only one that includes members-data.js).
    React.useEffect(() => {
      if (!window.HL_MEMBERS_API) return;
      let alive = true;
      window.HL_MEMBERS_API.list()
        .then(members => { if (alive) setSectionData(prev => ({ ...prev, members })); })
        .catch(() => {});
      return () => { alive = false; };
    }, []);

    // Currencies persist to the backend currency_rates table; load on mount
    // (only on the Currencies config page, which includes currencies-data.js).
    React.useEffect(() => {
      if (!window.HL_CURRENCIES_API) return;
      let alive = true;
      window.HL_CURRENCIES_API.list()
        .then(currencies => { if (alive) setSectionData(prev => ({ ...prev, currencies })); })
        .catch(() => {});
      return () => { alive = false; };
    }, []);

    // Statement value mappings persist to the backend statement_mappings table;
    // load on mount (only on the Statement Value Mapping page, which includes
    // statement-mappings-data.js).
    React.useEffect(() => {
      if (!window.HL_STATEMENT_MAPPINGS_API) return;
      let alive = true;
      window.HL_STATEMENT_MAPPINGS_API.list()
        .then(maps => { if (alive) setSectionData(prev => ({ ...prev, 'statement-mappings': maps })); })
        .catch(() => {});
      return () => { alive = false; };
    }, []);

    // Financial institutions (and their logos) persist to the backend
    // financial_institutions table; hydrate() also runs the one-time migration of
    // logos left in this browser's localStorage from before that move.
    React.useEffect(() => {
      if (!window.HL_INSTITUTIONS_API) return;
      let alive = true;
      window.HL_INSTITUTIONS_API.hydrate()
        .then(rows => { if (alive) setSectionData(prev => ({ ...prev, 'financial-institutions': rows })); })
        .catch(() => {});
      return () => { alive = false; };
    }, []);

    const section = view ? SECTIONS.find(s => s.id === view) : null;
    const items = view ? (sectionData[view] || []) : [];

    async function saveItem(item) {
      // Categories persist to the DB; detect create vs update by existing id.
      if (view === 'categories' && window.HL_CATEGORIES_API) {
        try {
          const exists = (sectionData.categories || []).some(x => x.id === item.id);
          const saved = exists
            ? await window.HL_CATEGORIES_API.update(item.id, item)
            : await window.HL_CATEGORIES_API.create(item);
          setSectionData(prev => {
            const list = prev.categories || [];
            const idx = list.findIndex(x => x.id === saved.id);
            const next = idx >= 0 ? list.map((x, i) => i === idx ? saved : x) : [...list, saved];
            return { ...prev, categories: next };
          });
          setModal(null);
        } catch (err) {
          alert('Could not save category: ' + (err.message || err));
        }
        return;
      }
      // Members persist to the Users table; detect create vs update by existing id.
      if (view === 'members' && window.HL_MEMBERS_API) {
        try {
          const exists = (sectionData.members || []).some(x => x.id === item.id);
          const saved = exists
            ? await window.HL_MEMBERS_API.update(item.id, item)
            : await window.HL_MEMBERS_API.create(item);
          setSectionData(prev => {
            const list = prev.members || [];
            const idx = list.findIndex(x => x.id === saved.id);
            const next = idx >= 0 ? list.map((x, i) => i === idx ? saved : x) : [...list, saved];
            return { ...prev, members: next };
          });
          setModal(null);
        } catch (err) {
          alert('Could not save member: ' + (err.message || err));
        }
        return;
      }
      // Currencies persist to the currency_rates table; detect create vs update by existing id.
      if (view === 'currencies' && window.HL_CURRENCIES_API) {
        try {
          const exists = (sectionData.currencies || []).some(x => x.id === item.id);
          const saved = exists
            ? await window.HL_CURRENCIES_API.update(item.id, item)
            : await window.HL_CURRENCIES_API.create(item);
          setSectionData(prev => {
            const list = prev.currencies || [];
            const idx = list.findIndex(x => x.id === saved.id);
            const next = idx >= 0 ? list.map((x, i) => i === idx ? saved : x) : [...list, saved];
            return { ...prev, currencies: next };
          });
          setModal(null);
        } catch (err) {
          alert('Could not save currency: ' + (err.message || err));
        }
        return;
      }
      // Statement value mappings persist to the statement_mappings table.
      if (view === 'statement-mappings' && window.HL_STATEMENT_MAPPINGS_API) {
        try {
          const exists = (sectionData['statement-mappings'] || []).some(x => x.id === item.id);
          const saved = exists
            ? await window.HL_STATEMENT_MAPPINGS_API.update(item.id, item)
            : await window.HL_STATEMENT_MAPPINGS_API.create(item);
          setSectionData(prev => {
            const list = prev['statement-mappings'] || [];
            const idx = list.findIndex(x => x.id === saved.id);
            const next = idx >= 0 ? list.map((x, i) => i === idx ? saved : x) : [...list, saved];
            return { ...prev, 'statement-mappings': next };
          });
          setModal(null);
        } catch (err) {
          alert('Could not save mapping: ' + (err.message || err));
        }
        return;
      }
      // Financial institutions persist to the financial_institutions table.
      if (view === 'financial-institutions' && window.HL_INSTITUTIONS_API) {
        try {
          const exists = (sectionData['financial-institutions'] || []).some(x => x.id === item.id);
          const before = (sectionData['financial-institutions'] || []).find(x => x.id === item.id);
          const saved = exists
            ? await window.HL_INSTITUTIONS_API.update(item.id, item)
            : await window.HL_INSTITUTIONS_API.create(item);
          setSectionData(prev => {
            const list = prev['financial-institutions'] || [];
            const idx = list.findIndex(x => x.id === saved.id);
            const next = idx >= 0 ? list.map((x, i) => i === idx ? saved : x) : [...list, saved];
            return { ...prev, 'financial-institutions': next };
          });
          // Keep the shared Accounts map in step so pickers/logos update without a reload.
          const map = window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.FINANCIAL_INSTITUTIONS;
          if (map) {
            if (before && before.key && before.key !== saved.key) delete map[before.key];
            map[saved.key] = { name: saved.name, shortName: saved.shortName, swift: saved.swift, logo: saved.logo || undefined };
          }
          setModal(null);
        } catch (err) {
          alert('Could not save institution: ' + (err.message || err));
        }
        return;
      }
      setSectionData(prev => {
        const list = prev[view];
        const idx = list.findIndex(x => x.id === item.id);
        const next = idx >= 0 ? list.map((x, i) => i === idx ? item : x) : [...list, item];
        persistClientSection(view, next);
        return { ...prev, [view]: next };
      });
      setModal(null);
    }

    async function deleteItem(item) {
      if (view === 'categories' && window.HL_CATEGORIES_API) {
        try {
          await window.HL_CATEGORIES_API.remove(item.id);
          setSectionData(prev => ({ ...prev, categories: prev.categories.filter(x => x.id !== item.id) }));
          setModal(null);
          setConfirmDel(null);
        } catch (err) {
          alert('Could not delete category: ' + (err.message || err));
        }
        return;
      }
      if (view === 'members' && window.HL_MEMBERS_API) {
        try {
          await window.HL_MEMBERS_API.remove(item.id);
          setSectionData(prev => ({ ...prev, members: prev.members.filter(x => x.id !== item.id) }));
          setModal(null);
          setConfirmDel(null);
        } catch (err) {
          alert('Could not delete member: ' + (err.message || err));
        }
        return;
      }
      if (view === 'currencies' && window.HL_CURRENCIES_API) {
        try {
          await window.HL_CURRENCIES_API.remove(item.id);
          setSectionData(prev => ({ ...prev, currencies: prev.currencies.filter(x => x.id !== item.id) }));
          setModal(null);
          setConfirmDel(null);
        } catch (err) {
          alert('Could not delete currency: ' + (err.message || err));
        }
        return;
      }
      if (view === 'statement-mappings' && window.HL_STATEMENT_MAPPINGS_API) {
        try {
          await window.HL_STATEMENT_MAPPINGS_API.remove(item.id);
          setSectionData(prev => ({ ...prev, 'statement-mappings': prev['statement-mappings'].filter(x => x.id !== item.id) }));
          setModal(null);
          setConfirmDel(null);
        } catch (err) {
          alert('Could not delete mapping: ' + (err.message || err));
        }
        return;
      }
      if (view === 'financial-institutions' && window.HL_INSTITUTIONS_API) {
        try {
          await window.HL_INSTITUTIONS_API.remove(item.id);
          setSectionData(prev => ({ ...prev, 'financial-institutions': prev['financial-institutions'].filter(x => x.id !== item.id) }));
          const map = window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.FINANCIAL_INSTITUTIONS;
          if (map && item.key) delete map[item.key];
          setModal(null);
          setConfirmDel(null);
        } catch (err) {
          alert('Could not delete institution: ' + (err.message || err));
        }
        return;
      }
      setSectionData(prev => {
        const next = prev[view].filter(x => x.id !== item.id);
        persistClientSection(view, next);
        return { ...prev, [view]: next };
      });
      setModal(null);
      setConfirmDel(null);
    }

    // Mass delete — loops the per-row API (backend-backed sections) or updates the
    // client-persisted store once; keeps rows that failed and reports the count.
    async function deleteMany(itemsToDelete) {
      const ids = itemsToDelete.map(i => i.id);
      if (!ids.length) return;
      const api = view === 'categories' ? window.HL_CATEGORIES_API
        : view === 'members' ? window.HL_MEMBERS_API
        : view === 'currencies' ? window.HL_CURRENCIES_API
        : view === 'statement-mappings' ? window.HL_STATEMENT_MAPPINGS_API
        : view === 'financial-institutions' ? window.HL_INSTITUTIONS_API : null;
      if (api) {
        const results = await Promise.allSettled(ids.map(id => api.remove(id)));
        const okIds = new Set(ids.filter((id, i) => results[i].status === 'fulfilled'));
        setSectionData(prev => ({ ...prev, [view]: prev[view].filter(x => !okIds.has(x.id)) }));
        const failed = ids.length - okIds.size;
        if (failed) alert(failed + (failed === 1 ? ' item' : ' items') + ' could not be deleted.');
      } else {
        const idSet = new Set(ids);
        setSectionData(prev => {
          const next = prev[view].filter(x => !idSet.has(x.id));
          persistClientSection(view, next);
          return { ...prev, [view]: next };
        });
      }
    }

    return (
      <div className="app" style={{ '--accent': t.accent }}>
        <Sidebar active={CFG_SECTION || 'configuration'} />
        <div className="main">
          {/* ── Detail: dedicated section page ── */}
          {view && section && (
            <CfgSectionTable key={view} section={section} items={items}
              onEdit={(it) => setModal({ item: it })}
              onAdd={() => setModal({ item: null })}
              onBatchDelete={deleteMany}
              onTcmb={() => setTcmbOpen(true)} />
          )}

          {tcmbOpen && (
            <TcmbRetrieveModal
              currencies={sectionData.currencies || []}
              onApply={async (updated) => {
                // Persist only the rows TCMB actually changed (compare vs current state).
                const prevList = sectionData.currencies || [];
                const changed = updated.filter(u => {
                  const before = prevList.find(c => c.id === u.id);
                  return before && (before.toTRY !== u.toTRY || before.source !== u.source || before.asOf !== u.asOf);
                });
                if (window.HL_CURRENCIES_API && changed.length) {
                  try {
                    await Promise.all(changed.map(c => window.HL_CURRENCIES_API.update(c.id, c)));
                  } catch (err) {
                    alert('Could not apply TCMB rates: ' + (err.message || err));
                    return;
                  }
                }
                setSectionData(prev => ({ ...prev, currencies: updated }));
                setTcmbOpen(false);
              }}
              onClose={() => setTcmbOpen(false)} />
          )}

          {histCurrency && (
            <CurrencyHistoryModal
              currency={histCurrency}
              onSave={async (updated) => {
                if (window.HL_CURRENCIES_API) {
                  try {
                    const saved = await window.HL_CURRENCIES_API.update(updated.id, updated);
                    setSectionData(prev => ({ ...prev, currencies: prev.currencies.map(c => c.id === saved.id ? saved : c) }));
                    setHistCurrency(saved);
                    return;
                  } catch (err) {
                    alert('Could not save rate history: ' + (err.message || err));
                    return;
                  }
                }
                setSectionData(prev => ({ ...prev, currencies: prev.currencies.map(c => c.id === updated.id ? updated : c) }));
                setHistCurrency(updated);
              }}
              onClose={() => setHistCurrency(null)}
            />
          )}

          {modal && section && (
            <ItemModal section={section} item={modal.item}
              onSave={saveItem} onDelete={(it) => { setModal(null); setConfirmDel(it); }} onHistory={setHistCurrency} onClose={() => setModal(null)} />
          )}

          {confirmDel && section && (
            <div className="backdrop" onMouseDown={e => { if (e.target.classList.contains('backdrop')) setConfirmDel(null); }}>
              <div className="modal cfg-confirm">
                <div className="modal-head">
                  <span className="modal-title"><Icon name="alert-triangle" size={15} color="var(--red)" />Delete Item</span>
                  <button id="cfg-delete-close-btn" className="m-close" onClick={() => setConfirmDel(null)}><Icon name="x" size={16} /></button>
                </div>
                <div className="cfg-confirm-body">
                  Delete <b>{confirmDel.label || confirmDel.name || confirmDel.code || confirmDel.etiket}</b> from {section.label}? This cannot be undone.
                </div>
                <div className="modal-foot">
                  <button id="cfg-delete-cancel-btn" className="amb cancel" onClick={() => setConfirmDel(null)}><Icon name="x" size={14} />Cancel</button>
                  <button id="cfg-delete-confirm-btn" className="amb danger" onClick={() => deleteItem(confirmDel)}><Icon name="trash-2" size={14} />Delete</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <TweaksPanel title="Tweaks">
          <TweakSection label="Appearance" />
          <TweakColor label="Accent" value={t.accent}
            options={['#4f8ef7', '#8b5cf6', '#22c55e', '#f97316', '#ec4899']}
            onChange={v => setTweak('accent', v)} />
        </TweaksPanel>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
