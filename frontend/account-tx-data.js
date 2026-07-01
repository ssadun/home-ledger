// account-tx-data.js — Home Ledger sample account-sourced transactions.
// These represent records imported from bank/card statements.
(function () {
  const { FX } = window.LEDGER;
  const { ACCOUNTS } = window.ACCOUNTS_DATA;

  // Transaction types for account records
  const ACCT_TX_TYPES = {
    eft:        { label: 'EFT',             icon: 'send',          color: 'var(--sky)' },
    swift:      { label: 'SWIFT',           icon: 'globe',         color: 'var(--accent)' },
    havale:     { label: 'Havale',          icon: 'arrow-right-left', color: 'var(--lavender)' },
    deposit:    { label: 'Deposit',         icon: 'arrow-down-left', color: 'var(--green)' },
    withdrawal: { label: 'Withdrawal',      icon: 'arrow-up-right', color: 'var(--coral)' },
    fee:        { label: 'Bank Fee',        icon: 'receipt',       color: 'var(--red)' },
    interest:   { label: 'Interest',        icon: 'trending-up',   color: 'var(--mint)' },
    payment:    { label: 'Card Payment',    icon: 'credit-card',   color: 'var(--orange)' },
    refund:     { label: 'Refund',          icon: 'rotate-ccw',    color: 'var(--emerald)' },
    salary:     { label: 'Salary',          icon: 'banknote',      color: 'var(--green)' },
    transfer:   { label: 'Internal Transfer', icon: 'repeat',      color: 'var(--steel)' },
  };

  // Raw account transaction records
  const raw = [
  ];

  const ACCT_TX = raw.map((r, i) => {
    const [date, accountId, txType, direction, desc, amt, cur, counterpartyAcct, status] = r;
    const account = ACCOUNTS.find(a => a.id === accountId) || {};
    const counterparty = counterpartyAcct ? ACCOUNTS.find(a => a.id === counterpartyAcct) : null;
    const tryV = +(amt * (FX[cur] || FX.TRY).toTRY).toFixed(2);
    return {
      id: 'atx-' + (1000 + i),
      date, accountId, txType, direction, desc, amt, cur,
      counterpartyAcct, counterpartyName: counterparty ? counterparty.name : null,
      status,
      accountName: account.name || '—',
      accountInstitution: account.institution || '—',
      accountOwner: account.owner || '—',
      tryV,
    };
  });

  window.ACCT_TX_DATA = { ACCT_TX, ACCT_TX_TYPES };
})();
