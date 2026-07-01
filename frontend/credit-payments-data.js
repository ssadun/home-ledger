// credit-payments-data.js — Credit Payments API client.
// Talks to /api/credit-payments and maps between the backend row shape and the
// frontend record shape used across the Credit Payments UI. Credit-card accounts
// for the picker are pulled from /api/accounts (type === 'credit').
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);

  // Backend row → frontend record object.
  function fromApi(row) {
    return {
      id: row.id,
      accountId: row.account_id != null ? row.account_id : null,
      accountKey: row.account_key || null,
      name: row.name || '',
      year: row.period_year != null ? row.period_year : null,
      month: row.period_month != null ? row.period_month : null,
      cutoverDate: row.cutover_date || '',
      paymentDate: row.payment_date || '',
      total: row.total_amount != null ? row.total_amount : 0,
      minimum: row.minimum_amount != null ? row.minimum_amount : 0,
      cur: row.currency || 'TRY',
      statementFilename: row.statement_filename || null,
      linkedCount: row.linked_count != null ? row.linked_count : 0,
    };
  }

  // Frontend record object → backend create/update payload.
  function toApi(item) {
    return {
      account_id: item.accountId != null ? Number(item.accountId) : null,
      period_year: item.year != null ? Number(item.year) : null,
      period_month: item.month != null ? Number(item.month) : null,
      cutover_date: item.cutoverDate || null,
      payment_date: item.paymentDate || null,
      total_amount: item.total != null ? Number(item.total) : 0,
      minimum_amount: item.minimum != null ? Number(item.minimum) : 0,
      currency: item.cur || 'TRY',
    };
  }

  async function list() {
    const res = await api()('/api/credit-payments/', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load credit payments (' + res.status + ')');
    return (await res.json()).map(fromApi);
  }

  async function create(item) {
    const res = await api()('/api/credit-payments/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error('Failed to create credit payment (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function update(id, item) {
    const res = await api()('/api/credit-payments/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error('Failed to update credit payment (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function remove(id) {
    const res = await api()('/api/credit-payments/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete credit payment (' + res.status + ')');
    return true;
  }

  // Upload a statement file → store as attachment + return parsed preview rows.
  async function previewStatement(id, file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await api()('/api/credit-payments/' + id + '/statement/preview', {
      method: 'POST', body: fd,   // let the browser set the multipart boundary
    });
    if (!res.ok) throw new Error('Failed to parse statement (' + res.status + ')');
    return res.json();
  }

  // Confirm reviewed rows → saved as spendings tagged to this record + card.
  async function confirmStatement(id, rows, skipDuplicates = true) {
    const res = await api()('/api/credit-payments/' + id + '/statement/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, skip_duplicates: skipDuplicates }),
    });
    if (!res.ok) throw new Error('Failed to import statement rows (' + res.status + ')');
    return res.json();
  }

  // Download the stored statement (Bearer-auth → blob → trigger save).
  async function downloadStatement(id, filename) {
    const res = await api()('/api/credit-payments/' + id + '/statement', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to download statement (' + res.status + ')');
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

  // Credit-card accounts for the picker (reuse the Accounts API client).
  async function creditCards() {
    if (!window.HL_ACCOUNTS_API) return [];
    const all = await window.HL_ACCOUNTS_API.list();
    return all.filter(a => a.type === 'credit');
  }

  window.HL_CREDIT_PAYMENTS_API = {
    list, create, update, remove,
    previewStatement, confirmStatement, downloadStatement, creditCards,
    fromApi, toApi,
  };
  // Populated by the page after list() so the dashboard calendar can read it.
  window.CREDIT_PAYMENTS_DATA = { RECORDS: [] };
})();
