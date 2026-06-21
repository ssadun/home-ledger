// components.jsx — Home Ledger presentational components.
(function () {
  const Icon = window.Icon;
  const { CATS } = window.LEDGER;

  // ── Formatting helpers ─────────────────────────────────────────────────
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function fmtDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }
  function dowOf(iso) {
    const dt = new Date(iso + 'T00:00:00');
    return DOW[dt.getDay()];
  }
  function grp(v, dec = 2) {
    return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  const SYM = { TRY: '₺', USD: '$', EUR: '€' };
  window.LEDGER_FMT = { fmtDate, dowOf, grp, SYM, MONTHS };

  // ── Payer badge ────────────────────────────────────────────────────────
  function PayerBadge({ name }) {
    const cls = name === 'Sadun' ? 'payer-sadun' : 'payer-handan';
    return (
      <span className={'payer-badge ' + cls}>
        <span className="avatar">{name[0]}</span>{name}
      </span>
    );
  }

  // ── Paying-for cell (beneficiary) ───────────────────────────────────────
  function PayingForCell({ value }) {
    if (!value || value === '–') return <span className="for-na"></span>;
    if (value === 'Shared') {
      return (
        <span className="for-plain">
          <Icon name="users" size={13} style={{ color: 'var(--slate)' }} />Shared
        </span>
      );
    }
    const col = value === 'Handan' ? 'var(--lavender)' : 'var(--accent)';
    return (
      <span className="for-plain">
        <Icon name="user" size={13} style={{ color: col }} />{value}
      </span>
    );
  }

  // ── Category cell ──────────────────────────────────────────────────────
  function CategoryCell({ cat }) {
    const c = CATS[cat] || CATS.shopping;
    return (
      <span className="cat-cell">
        <span className="cat-ico" style={{ color: c.color }}>
          <Icon name={c.icon} size={13} />
        </span>
        {c.label}
      </span>
    );
  }

  // ── Amount cell (original currency + badge) ────────────────────────────
  function AmountCell({ tx }) {
    const income = tx.type === 'income';
    return (
      <span className="amount-cell">
        <span className={'amount-val ' + (income ? 'income' : 'expense')}>
          <span className="sign">{income ? '+' : '−'}</span>{grp(tx.amt)}<span className="cur-sym suffix">{SYM[tx.cur]}</span>
        </span>
      </span>
    );
  }

  // ── Converted cell ─────────────────────────────────────────────────────
  function ConvCell({ value, cur }) {
    return (
      <span className="conv">
        {grp(value)}<span className="unit suffix">{SYM[cur]}</span>
      </span>
    );
  }

  // ── Payment method badge ───────────────────────────────────────────────
  const PM_MAP = {
    'credit-card': { label: 'Credit',  icon: 'credit-card', color: 'var(--accent)' },
    'debit-card':  { label: 'Debit',   icon: 'landmark',    color: 'var(--green)'  },
    'cash':        { label: 'Cash',    icon: 'banknote',    color: 'var(--gold)'   },
  };
  // Resolve the card number per payer + method from accounts-data.js (accounts.number).
  const CARD_NUMBERS = (function () {
    const map = {};
    const accts = (window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.ACCOUNTS) || [];
    accts.forEach(a => {
      if (a.type !== 'credit' && a.type !== 'debit') return;
      const key = a.owner + '|' + a.type;
      if (!map[key]) map[key] = a.number;   // first card of that type for the owner
    });
    return map;
  })();
  function cardNumberFor(value, payer) {
    const type = value === 'credit-card' ? 'credit' : value === 'debit-card' ? 'debit' : null;
    if (!type || !payer) return null;
    return CARD_NUMBERS[payer + '|' + type] || null;
  }
  // Resolve an account id (e.g. "acc-1") to its hydrated account record. Built at
  // render time so it reads ACCOUNTS after the page hydrates them from the backend.
  function accountById(value) {
    const accts = (window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.ACCOUNTS) || [];
    return accts.find(a => a.id === value) || null;
  }
  function PaymentMethodCell({ value, payer }) {
    const TYPES = (window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.ACCOUNT_TYPES) || {};
    const acct = !PM_MAP[value] ? accountById(value) : null;
    let pm, num;
    if (acct) {
      const t = TYPES[acct.type] || {};
      pm = { label: acct.name, icon: t.icon || 'circle', color: t.color || 'var(--slate)' };
      num = acct.number && acct.number !== '–' ? acct.number : null;
    } else {
      pm = PM_MAP[value] || { label: value || '–', icon: 'circle', color: 'var(--slate)' };
      num = cardNumberFor(value, payer);
    }
    return (
      <span className="pm-plain">
        <Icon name={pm.icon} size={13} style={{ color: pm.color }} />{pm.label}
        {num && <span className="pm-num">{num}</span>}
      </span>
    );
  }

  // ── Transaction row ────────────────────────────────────────────────────
  // Cell renderers keyed by column key — lets the table render cells in whatever
  // order the user has dragged the columns into (see TX_DEFAULT_ORDER).
  const TX_CELLS = {
    date: (tx) => (
      <td key="date" data-label="Date">
        <span className="td-date">{fmtDate(tx.date)}<span className="dow">{dowOf(tx.date)}</span></span>
      </td>
    ),
    desc: (tx, rec) => (
      <td key="desc" data-label="Description">
        <span className="td-desc" title={tx.desc}>
          {tx.desc}
          {rec && <span className="recurring-badge" title={'Recurring: ' + rec.name}><Icon name="repeat" size={11} /></span>}
        </span>
      </td>
    ),
    cat: (tx) => <td key="cat" data-label="Category"><CategoryCell cat={tx.cat} /></td>,
    payingFor: (tx) => <td key="payingFor" data-label="Paying For"><PayingForCell value={tx.payingFor} /></td>,
    paymentMethod: (tx) => <td key="paymentMethod" data-label="Payment"><PaymentMethodCell value={tx.paymentMethod} payer={tx.payer} /></td>,
    amt: (tx) => <td key="amt" className="num" data-label="Amount"><AmountCell tx={tx} /></td>,
  };
  const TX_DEFAULT_ORDER = ['date', 'desc', 'cat', 'payingFor', 'paymentMethod', 'amt'];

  function TxRow({ tx, flash, onEdit, extraClass, order }) {
    const c = CATS[tx.cat] || CATS.shopping;
    const recMap = window.RECURRING_DATA && window.RECURRING_DATA.TX_REC_MAP;
    const rec = recMap && recMap[tx.id];
    const keys = order && order.length ? order : TX_DEFAULT_ORDER;
    return (
      <tr className={'tx-row' + (flash ? ' row-flash' : '') + (extraClass ? ' ' + extraClass : '')} onClick={() => onEdit(tx)} title="Edit transaction">
        {keys.map(k => TX_CELLS[k] && TX_CELLS[k](tx, rec))}
        <td className="td-meta-mobile" data-label="Meta">
          <span className="meta-date">{fmtDate(tx.date)} {dowOf(tx.date)}</span>
          <span className="meta-sep">·</span>
          <span className="pm-badge"><Icon name={c.icon} size={11} style={{color: c.color}} />{c.label}</span>
          <span className="meta-sep">·</span>
          <PayingForCell value={tx.payingFor} />
        </td>
      </tr>
    );
  }

  Object.assign(window, { PayerBadge, PayingForCell, CategoryCell, AmountCell, ConvCell, PaymentMethodCell, TxRow });
})();
