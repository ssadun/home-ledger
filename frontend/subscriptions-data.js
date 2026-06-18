// subscriptions-data.js — Subscriptions API client (reuses the recurring backend, kind=subscription).
// Replaces the former static sample list. Subscriptions reuse the same backend
// table via the `kind` discriminator (see subscriptions-data.js).
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);
  const FX = () => (window.LEDGER && window.LEDGER.FX) || null;

  function withConverted(item) {
    const fx = FX();
    if (fx && fx[item.cur]) {
      item.tryAmount = +(item.amount * fx[item.cur].toTRY).toFixed(2);
      item.usdAmount = +(item.amount * fx[item.cur].toUSD).toFixed(2);
    }
    return item;
  }

  function fromApi(row) {
    return withConverted({
      id: row.id,
      name: row.name,
      cat: row.category_key || 'subscriptions',
      status: row.status || 'active',
      frequency: row.frequency || 'monthly',
      paymentDay: row.day_of_month,
      weekendRule: row.weekend_rule || 'none',
      startDate: row.start_date || null,
      endDate: row.end_date || null,
      payer: row.payer || '',
      payingFor: row.paying_for || '',
      cur: row.currency,
      amount: row.amount,
      paymentMethod: row.payment_method || '',
      desc: row.description || '',
      lastPaid: row.last_paid || null,
      nextDue: row.next_due || null,
      history: row.history || [],
      kind: row.kind || 'bill',
    });
  }

  function toApi(item, kind) {
    return {
      name: item.name,
      category_key: item.cat,
      status: item.status || 'active',
      frequency: item.frequency || 'monthly',
      day_of_month: item.paymentDay != null ? item.paymentDay : null,
      weekend_rule: item.weekendRule || 'none',
      start_date: item.startDate || null,
      end_date: item.endDate || null,
      payer: item.payer || null,
      paying_for: item.payingFor || null,
      currency: item.cur,
      amount: Number(item.amount) || 0,
      payment_method: item.paymentMethod || null,
      description: item.desc || null,
      last_paid: item.lastPaid || null,
      next_due: item.nextDue || null,
      history: item.history || [],
      kind: kind || item.kind || 'bill',
    };
  }

  // Build a client factory bound to a `kind` so Recurring (bill) and
  // Subscriptions (subscription) share this code with the right filter/default.
  function makeApi(kind) {
    async function list() {
      const res = await api()('/api/recurring/?kind=' + encodeURIComponent(kind), { method: 'GET' });
      if (!res.ok) throw new Error('Failed to load recurring (' + res.status + ')');
      return (await res.json()).map(fromApi);
    }
    async function create(item) {
      const res = await api()('/api/recurring/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toApi(item, kind)),
      });
      if (!res.ok) throw new Error('Failed to create recurring (' + res.status + ')');
      return fromApi(await res.json());
    }
    async function update(id, item) {
      const res = await api()('/api/recurring/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toApi(item, kind)),
      });
      if (!res.ok) throw new Error('Failed to update recurring (' + res.status + ')');
      return fromApi(await res.json());
    }
    async function remove(id) {
      const res = await api()('/api/recurring/' + id, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error('Failed to delete recurring (' + res.status + ')');
      return true;
    }
    return { list, create, update, remove };
  }

  // Empty placeholders so the many guarded `window.RECURRING_DATA?.…` reads across
  // pages keep working; the page hydrates RECURRING via the API on mount.
  window.RECURRING_DATA = { RECURRING: [], REC_TX_MAP: {}, TX_REC_MAP: {} };
  window.HL_RECURRING_API = makeApi('bill');
  window.HL_SUBSCRIPTIONS_API = makeApi('subscription');
})();
