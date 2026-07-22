// statements-data.js — Account Statements API client.
// Talks to /api/statements and maps between the backend row shape and the frontend
// record shape used across the Statements UI. This is the BANK-ACCOUNT statement
// archive; a credit-card ekstre is archived as a Credit Payment instead, so the
// account picker here excludes card accounts.
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);

  // Account types whose statements live on this page. Credit/debit cards belong to
  // Credit Payments; invest/pension accounts import holdings, not movements.
  const STATEMENT_TYPES = ['bank', 'overdraft', 'wallet', 'cash'];

  // Backend row → frontend record object.
  function fromApi(row) {
    return {
      id: row.id,
      accountId: row.account_id != null ? row.account_id : null,
      accountKey: row.account_key || null,
      name: row.name || '',
      year: row.period_year != null ? row.period_year : null,
      month: row.period_month != null ? row.period_month : null,
      from: row.period_from || '',
      to: row.period_to || '',
      cur: row.currency || 'TRY',
      moneyIn: row.money_in != null ? row.money_in : 0,
      moneyOut: row.money_out != null ? row.money_out : 0,
      closingBalance: row.closing_balance != null ? row.closing_balance : null,
      bank: row.bank_detected || null,
      fileName: row.file_filename || null,
      linkedCount: row.linked_count != null ? row.linked_count : 0,
    };
  }

  // Frontend record object → backend create/update payload.
  function toApi(item) {
    return {
      account_id: item.accountId != null ? Number(item.accountId) : null,
      period_year: item.year != null ? Number(item.year) : null,
      period_month: item.month != null ? Number(item.month) : null,
      period_from: item.from || null,
      period_to: item.to || null,
      currency: item.cur || 'TRY',
      money_in: item.moneyIn != null ? Number(item.moneyIn) : 0,
      money_out: item.moneyOut != null ? Number(item.moneyOut) : 0,
      closing_balance: item.closingBalance != null ? Number(item.closingBalance) : null,
      bank_detected: item.bank || null,
    };
  }

  async function list() {
    const res = await api()('/api/statements/', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load statements (' + res.status + ')');
    return (await res.json()).map(fromApi);
  }

  async function create(item) {
    const res = await api()('/api/statements/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error('Failed to create statement (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function update(id, item) {
    const res = await api()('/api/statements/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error('Failed to update statement (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function remove(id) {
    const res = await api()('/api/statements/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete statement (' + res.status + ')');
    return true;
  }

  // Attach (or replace) the record's document. Nothing is imported — the wizard has
  // already written the rows; this only archives the original file.
  async function attachFile(id, file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await api()('/api/statements/' + id + '/file', {
      method: 'POST', body: fd,   // let the browser set the multipart boundary
    });
    if (!res.ok) throw new Error('Failed to upload the document (' + res.status + ')');
    return fromApi(await res.json());
  }

  // Download the stored document (Bearer-auth → blob → trigger save).
  async function downloadFile(id, filename) {
    const res = await api()('/api/statements/' + id + '/file', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to download the document (' + res.status + ')');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || ('statement-' + id);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Accounts eligible for a statement record (reuse the Accounts API client).
  async function statementAccounts() {
    if (!window.HL_ACCOUNTS_API) return [];
    const all = await window.HL_ACCOUNTS_API.list();
    return all.filter(a => STATEMENT_TYPES.indexOf(a.type) !== -1);
  }

  window.HL_STATEMENTS_API = {
    list, create, update, remove,
    attachFile, downloadFile, statementAccounts,
    fromApi, toApi, STATEMENT_TYPES,
  };
})();
