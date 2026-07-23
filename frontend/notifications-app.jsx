// notifications-app.jsx — Home Ledger "Notifications" configuration sub-page.
// ─────────────────────────────────────────────────────────────────────────────
// Enable/disable Web Push and pick how many days ahead of a recurring bill's
// or credit card payment's due date the reminder fires. Same HL_PUSH client
// module (push.js) that backs the sidebar bell — this page is the place both
// desktop and mobile can always reach it from (the sidebar bell itself is
// hidden on mobile, where the bottom tab bar has no room for a 7th tab).
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { Sidebar } = window.HL_NAV;

  const LEAD_OPTIONS = [
    { value: '0', label: 'Same day' },
    { value: '1', label: '1 day before' },
    { value: '2', label: '2 days before' },
    { value: '3', label: '3 days before' },
    { value: '7', label: '7 days before' },
  ];

  function App() {
    const supported = window.HL_PUSH && window.HL_PUSH.isSupported();
    const [enabled, setEnabled] = React.useState(false);
    const [leadDays, setLeadDays] = React.useState(0);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [toast, setToast] = React.useState('');
    const toastTimer = React.useRef(null);

    const flash = (msg) => {
      setToast(msg);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(''), 3200);
    };

    React.useEffect(() => {
      if (!supported) return;
      window.HL_PUSH.getPrefs().then((p) => {
        setEnabled(!!p.subscribed);
        setLeadDays(p.notify_lead_days || 0);
      }).catch(() => {});
    }, [supported]);

    const toggle = async () => {
      if (busy) return;
      setBusy(true);
      setError('');
      try {
        if (enabled) {
          await window.HL_PUSH.disable();
          setEnabled(false);
        } else {
          await window.HL_PUSH.enable();
          setEnabled(true);
        }
      } catch (err) {
        setError(err.message || 'Something went wrong.');
      }
      setBusy(false);
    };

    const saveLead = async (v) => {
      setLeadDays(v);
      try { await window.HL_PUSH.setLeadDays(v); } catch (e) {}
    };

    const test = async () => {
      setBusy(true);
      setError('');
      try {
        await window.HL_PUSH.sendTest();
        flash('Test notification sent.');
      } catch (err) {
        setError(err.message || 'Could not send test notification.');
      }
      setBusy(false);
    };

    return (
      <div className="app">
        <Sidebar active="notifications" />
        <div className="main">
          <header className="page-head">
            <div className="page-head-top">
              <div className="cfg-detail-head-left">
                <div className="page-title-wrap cfg-detail-title-wrap">
                  <div className="cfg-title-col">
                    <h1 className="page-title">Notifications</h1>
                    <p className="page-subtitle">Get a reminder before recurring bills and credit card payments are due</p>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <div className="notif-scroll">
            <div className="notif-inner">
              {!supported ? (
                <section className="notif-panel">
                  <span className="notif-panel-title">Push Notifications</span>
                  <p className="notif-unsupported">
                    This browser or connection doesn't support push notifications. Push requires a
                    secure (HTTPS) connection and a modern browser — try opening the app over HTTPS.
                  </p>
                </section>
              ) : (
                <React.Fragment>
                  <section className="notif-panel">
                    <span className="notif-panel-title">Push Notifications</span>
                    <div className="notif-row">
                      <div className="notif-row-txt">
                        <span className="notif-row-label">Due-date reminders</span>
                        <span className="notif-row-desc">Recurring bills/subscriptions and credit card statement payments</span>
                      </div>
                      <span className={'notif-status ' + (enabled ? 'on' : 'off')}>
                        <Icon name={enabled ? 'bell' : 'bell-off'} size={13} />
                        {enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="notif-row">
                      <button type="button" className="action-modal-btn ok" disabled={busy} onClick={toggle}>
                        {enabled ? 'Disable Notifications' : 'Enable Notifications'}
                      </button>
                      {enabled && (
                        <button type="button" className="action-modal-btn secondary" disabled={busy} onClick={test}>
                          Send Test Notification
                        </button>
                      )}
                    </div>
                    {error && <p className="notif-unsupported" style={{ color: 'var(--red)' }}>{error}</p>}
                    {toast && <p className="notif-unsupported" style={{ color: 'var(--green)' }}>{toast}</p>}
                  </section>

                  {enabled && (
                    <section className="notif-panel">
                      <span className="notif-panel-title">Reminder Timing</span>
                      <div className="notif-row">
                        <div className="notif-row-txt">
                          <span className="notif-row-label">Notify me</span>
                          <span className="notif-row-desc">How far ahead of the due date to send the reminder</span>
                        </div>
                        <div className="notif-lead-field">
                          <StyledSelect value={String(leadDays)} onChange={(e) => saveLead(Number(e.target.value))}>
                            {LEAD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </StyledSelect>
                        </div>
                      </div>
                    </section>
                  )}
                </React.Fragment>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
