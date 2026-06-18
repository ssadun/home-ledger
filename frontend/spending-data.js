// spending-data.js — Spending page API client.
// Talks to the backend /api/transactions endpoints and maps between the backend
// row shape and the frontend transaction shape used across the Spending UI.
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);

  // Backend row → frontend transaction object.
  function fromApi(row) {
    return {
      id: row.id,
      date: row.date,                              // 'YYYY-MM-DD'
      payer: row.payer || 'Sadun',
      payingFor: row.paying_for || '–',       // '–' = N/A
      cat: row.category_key || 'shopping',
      desc: row.description || '',
      type: row.type,                              // 'income' | 'expense'
      cur: row.currency,
      amt: row.amount,
      paymentMethod: row.payment_method || '',
      tryV: row.amount_try != null ? row.amount_try : null,
      usdV: row.amount_usd != null ? row.amount_usd : null,
    };
  }

  // Frontend transaction object → backend create/update payload.
  function toApi(tx) {
    return {
      date: tx.date,
      payer: tx.payer,
      paying_for: tx.payingFor,
      category_key: tx.cat,
      description: tx.desc,
      type: tx.type,
      currency: tx.cur,
      amount: tx.amt,
      payment_method: tx.paymentMethod,
      amount_try: tx.tryV,
      amount_usd: tx.usdV,
    };
  }

  async function list() {
    const res = await api()('/api/transactions/?limit=200', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load transactions (' + res.status + ')');
    const data = await res.json();
    return data.map(fromApi);
  }

  async function create(tx) {
    const res = await api()('/api/transactions/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(tx)),
    });
    if (!res.ok) throw new Error('Failed to create transaction (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function update(id, tx) {
    const res = await api()('/api/transactions/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(tx)),
    });
    if (!res.ok) throw new Error('Failed to update transaction (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function remove(id) {
    const res = await api()('/api/transactions/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete transaction (' + res.status + ')');
    return true;
  }

  window.HL_SPENDING_API = { list, create, update, remove, fromApi, toApi };
})();
