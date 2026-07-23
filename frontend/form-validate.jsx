// Shared required-field validation for every data-entry form.
// One home so the "why did Save do nothing?" warning looks and behaves the same
// on Spending, Accounts, Budgets, Credit Payments, Recurring, Subscriptions and
// Statements. Configuration forms already do their own thing (config-app.jsx).
(function () {
  // specs: [{ key, label, ok }] — `ok` is truthy when the field is filled.
  // Returns { ok, keys, labels, message }; `keys` is a lookup ({fieldKey:true})
  // the form uses to red-outline the offending fields, `message` the line shown
  // above the footer.
  function checkRequired(specs) {
    const missing = specs.filter((s) => !s.ok);
    const keys = {};
    missing.forEach((s) => { keys[s.key] = true; });
    const labels = missing.map((s) => s.label);
    let message = '';
    if (labels.length === 1) message = labels[0] + ' is required.';
    else if (labels.length > 1) message = 'Please fill in the required fields: ' + labels.join(', ') + '.';
    return { ok: missing.length === 0, keys, labels, message };
  }

  function FormError({ message, id }) {
    const Icon = window.Icon;
    if (!message) return null;
    return (
      <div className="form-error" id={id}>
        <Icon name="alert-triangle" size={13} />{message}
      </div>
    );
  }

  window.HL_FORM = { checkRequired, FormError };
})();
