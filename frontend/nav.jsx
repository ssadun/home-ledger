// nav.jsx — SINGLE SOURCE OF TRUTH for the Home Ledger sidebar.
// ─────────────────────────────────────────────────────────────────────────────
// Every page renders the sidebar from here:
//     const { Sidebar } = window.HL_NAV;
//     <Sidebar active="budgets" />
//
// `active` is the id of the current page. Valid ids:
//   Top level : dashboard | transactions | accounts | budgets | configuration
//   Tx sub    : spending | credit-payments | subscriptions | recurring
//   Accts sub : accounts | account-activity | statements
//   Config sub: members | categories | currencies | cc-types | debit-types | account-types | financial-institutions | statement-mappings | backup-export
//
// A NAV entry with a `parent` key renders as a collapsible group whose items come
// from SUBMENUS[id] — add a submenu by adding the array and the map entry, nothing
// in Sidebar() needs to change.
//
// To change a menu item's COLOR / LABEL / ICON / ORDER, edit the arrays below — once.
(function () {
  const Icon = window.Icon;

  // App version shown in the sidebar footer (below Log Out).
  // Bump APP_BUILD by hand when you want the displayed version to move. This was
  // once automated by a ./push.sh that sed-matched the `build:auto` marker; that
  // script is gone, so the marker is kept only as a stable anchor if the bump is
  // ever scripted again.
  const APP_BUILD = 5; // build:auto
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
    { id: 'accounts',      icon: 'wallet',           label: 'Accounts',      color: '#8b5cf6',       parent: 'acct' },
    { id: 'budgets',       icon: 'target',           label: 'Budgets',       color: 'var(--yellow)', href: 'Budgets.html' },
    { id: 'configuration', icon: 'settings-2',       label: 'Configuration', color: 'var(--red)',    parent: 'cfg' },
  ];

  // ── Transactions submenu ───────────────────────────────────────────────────
  const NAV_TX_SUB = [
    { id: 'spending',         icon: 'shopping-bag', label: 'Spending',         color: '#22c55e', href: 'Spending.html' },
    { id: 'credit-payments',  icon: 'credit-card',  label: 'Credit Payments',  color: '#ef4444', href: 'Credit Payments.html' },
    { id: 'subscriptions',    icon: 'repeat-2',     label: 'Subscriptions',    color: 'var(--coral)', href: 'Subscriptions.html' },
    { id: 'recurring',        icon: 'repeat',       label: 'Recurring',        color: '#d946ef',      href: 'Recurring.html' },
  ];

  // ── Accounts submenu ───────────────────────────────────────────────────────
  // The list page keeps id 'accounts' — same id as its parent — so landing on
  // Accounts.html lights up both the group and its first item.
  const NAV_ACCT_SUB = [
    { id: 'accounts',         icon: 'wallet',   label: 'Accounts',         color: '#8b5cf6', href: 'Accounts.html' },
    { id: 'account-activity', icon: 'landmark', label: 'Account Activity', color: '#4f8ef7', href: 'Account Activity.html' },
    { id: 'statements',       icon: 'files',    label: 'Statements',       color: 'var(--yellow)', href: 'Statements.html' },
  ];

  // ── Configuration submenu (sectionId === CONFIG_SECTION === active id) ──────
  const NAV_CFG_SUB = [
    { id: 'members',       sectionId: 'members',       icon: 'users',              label: 'Members',       color: '#22c55e', href: 'Members.html' },
    { id: 'categories',    sectionId: 'categories',    icon: 'tag',                label: 'Categories',    color: '#8b5cf6', href: 'Categories.html' },
    { id: 'currencies',    sectionId: 'currencies',    icon: 'circle-dollar-sign', label: 'Currencies',    color: '#fbbf24', href: 'Currencies.html' },
    { id: 'cc-types',      sectionId: 'cc-types',      icon: 'credit-card',        label: 'Credit Cards',  color: '#bef264', href: 'Credit Cards.html' },
    { id: 'debit-types',   sectionId: 'debit-types',   icon: 'wallet-cards',       label: 'Debit Cards',   color: '#38bdf8', href: 'Debit Cards.html' },
    { id: 'account-types', sectionId: 'account-types', icon: 'landmark',           label: 'Account Types', color: '#4f8ef7', href: 'Account Types.html' },
    { id: 'financial-institutions', sectionId: 'financial-institutions', icon: 'building-2', label: 'Financial Institutions', color: '#94a3b8', href: 'Financial Institutions.html' },
    { id: 'statement-mappings', sectionId: 'statement-mappings', icon: 'file-symlink', label: 'Statement Value Mapping', color: '#38bdf8', href: 'Statement Value Mapping.html' },
    { id: 'notifications',  sectionId: 'notifications',  icon: 'bell',               label: 'Notifications',  color: '#fbbf24', href: 'Notifications.html' },
    { id: 'backup-export', sectionId: 'backup-export', icon: 'database-backup',    label: 'Backup & Export', color: '#34d399', href: 'Backup & Export.html' },
  ];

  const NAV_BOTTOM = [
    { id: 'logout', icon: 'log-out', label: 'Log Out', color: '#ef4444', idle: '#ef4444' },
  ];

  // Every collapsible group, keyed by its NAV id. Config subitems carry their own
  // `sectionId` as the page id, everything else is keyed on `id`.
  const SUBMENUS = {
    transactions: NAV_TX_SUB,
    accounts: NAV_ACCT_SUB,
    configuration: NAV_CFG_SUB,
  };
  const subKey = (n) => n.sectionId || n.id;

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
      <button id={'sidebar-item-' + item.id + '-btn'} className={'sidebar-item' + (item.active ? ' active' : '')} title={item.label} style={style} onClick={onClick}>{inner}</button>
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
    return <button id={'sidebar-subitem-' + item.id + '-btn'} className={'sidebar-subitem' + (item.active ? ' active' : '')} title={item.label} style={{ '--item-color': item.color }}>{inner}</button>;
  }

  // Declared at module scope, NOT inside Sidebar(). A component defined inside a
  // render is a brand-new type on every render, so React unmounts and rebuilds the
  // whole group instead of just toggling its class — which detaches the very node
  // a tap is still bubbling from, and menu.js's `sidebar.contains(e.target)`
  // outside-tap guard then reads that detached node as "tapped outside" and closes
  // the popup it just opened. That was the mobile submenu never expanding.
  function ParentGroup({ item, open, active, onToggle }) {
    const style = { '--sidebar-active-color': item.color, '--sidebar-idle-color': '#6b7fa3', '--sidebar-active-bg': rgba(item.color, 0.12) };
    const inGroup = active === item.id || (SUBMENUS[item.id] || []).some(s => subKey(s) === active);
    return (
      <div className={'sidebar-parent' + (open ? ' open' : '')} id={item.id + '-parent'}>
        <button id={'nav-' + item.id + '-toggle-btn'} className={'sidebar-item' + (inGroup ? ' active' : '')} title={item.label} style={style} onClick={() => onToggle(item.id)}>
          <span className="sidebar-item-icon"><Icon name={item.icon} size={20} color="currentColor" /></span>
          <span className="sidebar-item-text">{item.label}</span>
          <span className="sidebar-item-chevron" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(item.id); }}><Icon name="chevron-down" size={14} /></span>
        </button>
        <div className={'sidebar-submenu' + (open ? '' : ' closed')} id={item.id + '-submenu'}>
          {(SUBMENUS[item.id] || []).map(n => <SbSubItem key={n.id} item={{ ...n, active: subKey(n) === active }} />)}
        </div>
      </div>
    );
  }

  function Sidebar({ active }) {
    // "Is the current page inside this group?" — true for the parent's own id too.
    const isIn = (n) => active === n.id || (SUBMENUS[n.id] || []).some(s => subKey(s) === active);

    // On mobile the sidebar is a bottom tab bar and an open parent renders its
    // submenu as a floating popup. Don't auto-open it on page load there — it
    // would pop over the content every time you land on a sub-page. On desktop
    // the open submenu is a useful "you are here" cue, so keep it.
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 660;
    // Only one group is ever open; null = all closed.
    const [openId, setOpenId] = React.useState(() => {
      const cur = NAV.find(n => n.parent && isIn(n));
      return cur && !isMobile ? cur.id : null;
    });
    React.useEffect(() => { window.updateSidebarToggleLabel && window.updateSidebarToggleLabel(); }, []);

    const toggle = (id) => setOpenId(o => (o === id ? null : id));

    const top = (n) => ({ ...n, active: n.id === active });

    return (
      <nav className="sidebar" id="sidebar">
        <button id="sidebar-toggle-btn" className="sidebar-toggle" onClick={() => window.toggleSidebar()} title="Toggle sidebar">
          <span className="sidebar-toggle-icon"><Icon name="pyramid" size={76} color="var(--accent)" /></span>
          <span className="sidebar-toggle-text">
            <span className="sidebar-toggle-name"><span className="bw">Hyper</span><span className="bl">Ledger</span></span>
          </span>
        </button>
        <button className="sidebar-float-btn" id="sidebar-toggle-label" onClick={() => window.toggleSidebar()} title="Toggle sidebar" aria-label="Toggle sidebar">&gt;</button>
        <div className="sidebar-nav">
          <div className="sidebar-section">
            {NAV.map(n => n.parent
              ? <ParentGroup key={n.id} item={n} open={openId === n.id} active={active} onToggle={toggle} />
              : <SbItem key={n.id} item={top(n)} />)}
          </div>
          <div className="sidebar-section bottom">
            {NAV_BOTTOM.map(n => <SbItem key={n.id} item={n} />)}
            <div className="sidebar-version" id="sidebar-version" title={'Home Ledger ' + APP_VERSION}><span className="sidebar-version-name">Home Ledger </span>{APP_VERSION}</div>
          </div>
        </div>
        <div className="sidebar-resizer" id="sidebar-resizer" title="Drag to resize" />
      </nav>
    );
  }

  window.HL_NAV = { Sidebar, SbItem, SbSubItem, rgba, NAV, NAV_TX_SUB, NAV_ACCT_SUB, NAV_CFG_SUB, NAV_BOTTOM, SUBMENUS, usePersistentView };
})();
