// nav.jsx — SINGLE SOURCE OF TRUTH for the Hyper Ledger sidebar.
// ─────────────────────────────────────────────────────────────────────────────
// Every page renders the sidebar from here:
//     const { Sidebar } = window.HL_NAV;
//     <Sidebar active="budgets" />
//
// `active` is the id of the current page. Valid ids:
//   Top level : dashboard | transactions | recurring | accounts | budgets | configuration
//   Tx sub    : spending | account-activity | subscriptions
//   Config sub: members | categories | currencies | cc-types | debit-types | account-types | backup-export
//
// To change a menu item's COLOR / LABEL / ICON / ORDER, edit the arrays below — once.
(function () {
  const Icon = window.Icon;

  // App version shown in the sidebar footer (below Log Out).
  // APP_BUILD is bumped automatically by ./push.sh on each push to GitHub —
  // do NOT edit it by hand (the marker line below is matched by sed).
  const APP_BUILD = 3; // build:auto
  const APP_VERSION = 'v1.0.' + APP_BUILD;

  // ── Persistent grid/list "View" selection, shared across the whole app ──────
  // Remembers the user's grid vs list choice in localStorage so it survives
  // reloads AND carries between pages (Accounts ⇄ Budgets ⇄ …).
  const VIEW_KEY = 'hl-view-layout';
  function getStoredView() {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return (v === 'grid' || v === 'list') ? v : null;
    } catch (e) { return null; }
  }
  function usePersistentView(fallback = 'list') {
    const [view, setView] = React.useState(() => getStoredView() || fallback);
    React.useEffect(() => {
      try { localStorage.setItem(VIEW_KEY, view); } catch (e) {}
    }, [view]);
    // Live-sync if another open tab/page changes the selection.
    React.useEffect(() => {
      const onStorage = (e) => {
        if (e.key === VIEW_KEY && (e.newValue === 'grid' || e.newValue === 'list')) setView(e.newValue);
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    }, []);
    return [view, setView];
  }

  // ── Top-level menu ─────────────────────────────────────────────────────────
  const NAV = [
    { id: 'dashboard',     icon: 'layout-dashboard', label: 'Dashboard',     color: 'var(--white)',  href: 'Dashboard.html' },
    { id: 'transactions',  icon: 'arrow-left-right', label: 'Transactions',  color: '#22c55e',       parent: 'tx' },
    { id: 'recurring',     icon: 'repeat',           label: 'Recurring',     color: '#d946ef',       href: 'Recurring.html' },
    { id: 'accounts',      icon: 'wallet',           label: 'Accounts',      color: '#8b5cf6',       href: 'Accounts.html' },
    { id: 'budgets',       icon: 'target',           label: 'Budgets',       color: 'var(--yellow)', href: 'Budgets.html' },
    { id: 'configuration', icon: 'settings-2',       label: 'Configuration', color: 'var(--red)',    parent: 'cfg' },
  ];

  // ── Transactions submenu ───────────────────────────────────────────────────
  const NAV_TX_SUB = [
    { id: 'spending',         icon: 'shopping-bag', label: 'Spending',         color: '#22c55e', href: 'Spending.html' },
    { id: 'account-activity', icon: 'landmark',     label: 'Account Activity', color: '#4f8ef7', href: 'Account Activity.html' },
    { id: 'subscriptions',    icon: 'repeat-2',     label: 'Subscriptions',    color: 'var(--coral)', href: 'Subscriptions.html' },
  ];

  // ── Configuration submenu (sectionId === CONFIG_SECTION === active id) ──────
  const NAV_CFG_SUB = [
    { id: 'members',       sectionId: 'members',       icon: 'users',              label: 'Members',       color: '#22c55e', href: 'Members.html' },
    { id: 'categories',    sectionId: 'categories',    icon: 'tag',                label: 'Categories',    color: '#8b5cf6', href: 'Categories.html' },
    { id: 'currencies',    sectionId: 'currencies',    icon: 'circle-dollar-sign', label: 'Currencies',    color: '#fbbf24', href: 'Currencies.html' },
    { id: 'cc-types',      sectionId: 'cc-types',      icon: 'credit-card',        label: 'Credit Cards',  color: '#f97316', href: 'Credit Cards.html' },
    { id: 'debit-types',   sectionId: 'debit-types',   icon: 'wallet-cards',       label: 'Debit Cards',   color: '#38bdf8', href: 'Debit Cards.html' },
    { id: 'account-types', sectionId: 'account-types', icon: 'landmark',           label: 'Account Types', color: '#4f8ef7', href: 'Account Types.html' },
    { id: 'backup-export', sectionId: 'backup-export', icon: 'database-backup',    label: 'Backup & Export', color: '#34d399', href: 'Backup & Export.html' },
  ];

  const NAV_BOTTOM = [
    { id: 'logout', icon: 'log-out', label: 'Log Out', color: '#ef4444', idle: '#ef4444' },
  ];

  // CSS-variable / non-hex colors (e.g. var(--white), var(--red)) can't be bit-parsed —
  // mix them so the hover/active tint tracks the icon color just like the hex items do.
  function rgba(hex, a) {
    if (typeof hex !== 'string' || hex[0] !== '#') return `color-mix(in srgb, ${hex} ${a * 100}%, transparent)`;
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function SbItem({ item }) {
    const idle = item.idle || '#6b7fa3';
    const inner = (
      <React.Fragment>
        <span className="sidebar-item-icon"><Icon name={item.icon} size={20} color="currentColor" /></span>
        <span className="sidebar-item-text">{item.label}</span>
      </React.Fragment>
    );
    const style = { '--sidebar-active-color': item.color, '--sidebar-idle-color': idle, '--sidebar-active-bg': rgba(item.color, 0.12) };
    if (item.href) {
      return (
        <a className={'sidebar-item' + (item.active ? ' active' : '')} title={item.label} href={item.href}
          style={{ ...style, textDecoration: 'none' }}>{inner}</a>
      );
    }
    const onClick = item.id === 'logout'
      ? () => window.HL_AUTH && window.HL_AUTH.logout()
      : undefined;
    return (
      <button className={'sidebar-item' + (item.active ? ' active' : '')} title={item.label} style={style} onClick={onClick}>{inner}</button>
    );
  }

  function SbSubItem({ item }) {
    const inner = (
      <React.Fragment>
        <span className="subitem-icon"><Icon name={item.icon} size={15} /></span>
        <span className="subitem-text">{item.label}</span>
      </React.Fragment>
    );
    if (item.href) {
      return <a className={'sidebar-subitem' + (item.active ? ' active' : '')} href={item.href} title={item.label} style={{ '--item-color': item.color, textDecoration: 'none' }}>{inner}</a>;
    }
    return <button className={'sidebar-subitem' + (item.active ? ' active' : '')} title={item.label} style={{ '--item-color': item.color }}>{inner}</button>;
  }

  function Sidebar({ active }) {
    const inTx = active === 'transactions' || NAV_TX_SUB.some(n => n.id === active);
    const inCfg = active === 'configuration' || NAV_CFG_SUB.some(n => n.sectionId === active);

    const [txOpen, setTxOpen] = React.useState(inTx);
    const [cfgOpen, setCfgOpen] = React.useState(inCfg);
    React.useEffect(() => { window.updateSidebarToggleLabel && window.updateSidebarToggleLabel(); }, []);

    const txIdx = NAV.findIndex(n => n.id === 'transactions');
    const cfgIdx = NAV.findIndex(n => n.id === 'configuration');
    const txItem = NAV[txIdx];
    const cfgItem = NAV[cfgIdx];
    const txStyle = { '--sidebar-active-color': txItem.color, '--sidebar-idle-color': '#6b7fa3', '--sidebar-active-bg': rgba(txItem.color, 0.12) };
    const cfgStyle = { '--sidebar-active-color': cfgItem.color, '--sidebar-idle-color': '#6b7fa3', '--sidebar-active-bg': rgba(cfgItem.color, 0.12) };

    const toggleTx = () => {
      setTxOpen(o => !o); setCfgOpen(false);
    };
    const toggleCfg = () => {
      setCfgOpen(o => !o); setTxOpen(false);
    };

    const top = (n) => ({ ...n, active: n.id === active });

    return (
      <nav className="sidebar" id="sidebar">
        <button className="sidebar-toggle" onClick={() => window.toggleSidebar()} title="Toggle sidebar">
          <span className="sidebar-toggle-icon"><Icon name="pyramid" size={76} color="var(--accent)" /></span>
          <span className="sidebar-toggle-text">
            <span className="sidebar-toggle-name"><span className="bw">Hyper</span><span className="bl">Ledger</span></span>
          </span>
        </button>
        <button className="sidebar-float-btn" id="sidebar-toggle-label" onClick={() => window.toggleSidebar()} title="Toggle sidebar" aria-label="Toggle sidebar">&gt;</button>
        <div className="sidebar-nav">
          <div className="sidebar-section">
            {NAV.slice(0, txIdx).map(n => <SbItem key={n.id} item={top(n)} />)}
            <div className={'sidebar-parent' + (txOpen ? ' open' : '')} id="transactions-parent">
              <button className={'sidebar-item' + (inTx ? ' active' : '')} title="Transactions" style={txStyle} onClick={toggleTx}>
                <span className="sidebar-item-icon"><Icon name="arrow-left-right" size={20} color="currentColor" /></span>
                <span className="sidebar-item-text">Transactions</span>
                <span className="sidebar-item-chevron" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTxOpen(o => !o); setCfgOpen(false); }}><Icon name="chevron-down" size={14} /></span>
              </button>
              <div className={'sidebar-submenu' + (txOpen ? '' : ' closed')} id="transactions-submenu">
                {NAV_TX_SUB.map(n => <SbSubItem key={n.id} item={{ ...n, active: n.id === active }} />)}
              </div>
            </div>
            {NAV.slice(txIdx + 1, cfgIdx).map(n => <SbItem key={n.id} item={top(n)} />)}
            <div className={'sidebar-parent' + (cfgOpen ? ' open' : '')} id="configuration-parent">
              <button className={'sidebar-item' + (inCfg ? ' active' : '')} title="Configuration" style={cfgStyle} onClick={toggleCfg}>
                <span className="sidebar-item-icon"><Icon name="settings-2" size={20} color="currentColor" /></span>
                <span className="sidebar-item-text">Configuration</span>
                <span className="sidebar-item-chevron" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCfgOpen(o => !o); setTxOpen(false); }}><Icon name="chevron-down" size={14} /></span>
              </button>
              <div className={'sidebar-submenu' + (cfgOpen ? '' : ' closed')} id="configuration-submenu">
                {NAV_CFG_SUB.map(n => <SbSubItem key={n.id} item={{ ...n, active: n.sectionId === active }} />)}
              </div>
            </div>
          </div>
          <div className="sidebar-section bottom">
            {NAV_BOTTOM.map(n => <SbItem key={n.id} item={n} />)}
            <div className="sidebar-version" id="sidebar-version" title={'Hyper Ledger ' + APP_VERSION}><span className="sidebar-version-name">Hyper Ledger </span>{APP_VERSION}</div>
          </div>
        </div>
      </nav>
    );
  }

  window.HL_NAV = { Sidebar, SbItem, SbSubItem, rgba, NAV, NAV_TX_SUB, NAV_CFG_SUB, NAV_BOTTOM, usePersistentView };
})();
