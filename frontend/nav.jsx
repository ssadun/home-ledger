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
    { id: 'transactions',  icon: 'arrow-left-right', label: 'Transactions',  color: 'var(--green)',       parent: 'tx' },
    { id: 'accounts',      icon: 'wallet',           label: 'Accounts',      color: 'var(--lavender)',       parent: 'acct' },
    { id: 'budgets',       icon: 'target',           label: 'Budgets',       color: 'var(--yellow)', href: 'Budgets.html' },
    { id: 'configuration', icon: 'settings-2',       label: 'Configuration', color: 'var(--red)',    parent: 'cfg' },
  ];

  // ── Transactions submenu ───────────────────────────────────────────────────
  const NAV_TX_SUB = [
    { id: 'spending',         icon: 'shopping-bag', label: 'Spending',         color: 'var(--green)', href: 'Spending.html' },
    { id: 'credit-payments',  icon: 'credit-card',  label: 'Credit Payments',  color: 'var(--red)', href: 'Credit Payments.html' },
    { id: 'subscriptions',    icon: 'repeat-2',     label: 'Subscriptions',    color: 'var(--coral)', href: 'Subscriptions.html' },
    { id: 'recurring',        icon: 'repeat',       label: 'Recurring',        color: 'var(--fuchsia)',      href: 'Recurring.html' },
  ];

  // ── Accounts submenu ───────────────────────────────────────────────────────
  // The list page keeps id 'accounts' — same id as its parent — so landing on
  // Accounts.html lights up both the group and its first item.
  const NAV_ACCT_SUB = [
    { id: 'accounts',         icon: 'wallet',   label: 'Accounts',         color: 'var(--lavender)', href: 'Accounts.html' },
    { id: 'account-activity', icon: 'landmark', label: 'Account Activity', color: 'var(--accent)', href: 'Account Activity.html' },
    { id: 'statements',       icon: 'files',    label: 'Statements',       color: 'var(--yellow)', href: 'Statements.html' },
  ];

  // ── Configuration submenu (sectionId === CONFIG_SECTION === active id) ──────
  const NAV_CFG_SUB = [
    { id: 'members',       sectionId: 'members',       icon: 'users',              label: 'Members',       color: 'var(--green)', href: 'Members.html' },
    { id: 'categories',    sectionId: 'categories',    icon: 'tag',                label: 'Categories',    color: 'var(--lavender)', href: 'Categories.html' },
    { id: 'currencies',    sectionId: 'currencies',    icon: 'circle-dollar-sign', label: 'Currencies',    color: 'var(--gold)', href: 'Currencies.html' },
    { id: 'cc-types',      sectionId: 'cc-types',      icon: 'credit-card',        label: 'Credit Cards',  color: 'var(--lime)', href: 'Credit Cards.html' },
    { id: 'debit-types',   sectionId: 'debit-types',   icon: 'wallet-cards',       label: 'Debit Cards',   color: 'var(--sky)', href: 'Debit Cards.html' },
    { id: 'account-types', sectionId: 'account-types', icon: 'landmark',           label: 'Account Types', color: 'var(--accent)', href: 'Account Types.html' },
    { id: 'financial-institutions', sectionId: 'financial-institutions', icon: 'building-2', label: 'Financial Institutions', color: 'var(--steel)', href: 'Financial Institutions.html' },
    { id: 'statement-mappings', sectionId: 'statement-mappings', icon: 'file-symlink', label: 'Statement Value Mapping', color: 'var(--sky)', href: 'Statement Value Mapping.html' },
    { id: 'notifications',  sectionId: 'notifications',  icon: 'bell',               label: 'Notifications',  color: 'var(--gold)', href: 'Notifications.html' },
    { id: 'backup-export', sectionId: 'backup-export', icon: 'database-backup',    label: 'Backup & Export', color: 'var(--emerald)', href: 'Backup & Export.html' },
  ];

  const NAV_BOTTOM = [
    { id: 'logout', icon: 'log-out', label: 'Log Out', color: 'var(--red)', idle: 'var(--red)' },
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
    const idle = item.idle || 'var(--separator)';
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
    const onClick = item.onClick
      || (item.id === 'logout' ? () => window.HL_AUTH && window.HL_AUTH.logout() : undefined);
    return (
      <button id={'sidebar-item-' + item.id + '-btn'} className={'sidebar-item' + (item.active ? ' active' : '')} title={item.label} style={style} onClick={onClick}>{inner}</button>
    );
  }

  // The light/dark switch used to live here as an `SbThemeItem` in the sidebar's
  // bottom section. It was removed from the menu; theme.js is still driven from
  // the Profile page (profile-app.jsx) and the Login page's own toggle, so don't
  // reintroduce a third switch here.

  // Body-level mount point for the top-right profile button. Created on demand so
  // no page has to add the element to its own HTML.
  function profileHost() {
    let el = document.getElementById('topbar-profile-host');
    if (!el) {
      el = document.createElement('div');
      el.id = 'topbar-profile-host';
      document.body.appendChild(el);
    }
    return el;
  }

  // Profile entry, pinned to the TOP RIGHT of the page (it used to be an item in
  // the sidebar's bottom section). Shows the user's picture when they have one,
  // falling back to a generic person icon.
  //
  // Rendered through a PORTAL into a body-level host rather than by each page's
  // header. Every page builds its own `.page-head`, so putting the button there
  // would mean the same markup pasted into 20 `*-app.jsx` files; the portal keeps
  // one implementation and lets `<Sidebar>` — which every page already renders —
  // carry it along. `.page-head-top` reserves the space it floats over (app.css).
  //
  // Reads the CACHED session blob (HL_AUTH.getUser(), written at login and
  // refreshed by profile-data.js's syncSession) rather than calling /api/auth/me.
  // nav.jsx renders on all 20 pages, so a fetch here would be 20 extra requests
  // per session to render one small image. Consequence worth knowing: a session
  // that logged in before the avatar existed carries no `avatar_url` until the
  // Profile page is opened once, or the user signs in again.
  //
  // The initials fallback deliberately does NOT appear here — its helpers live in
  // profile-data.js, which only Profile.html loads, and duplicating them into
  // nav.jsx would put the same logic in two places for a tiny glyph.
  function TopbarProfile({ active }) {
    const [host] = React.useState(profileHost);
    const [user, setUser] = React.useState(
      () => (window.HL_AUTH && window.HL_AUTH.getUser()) || null
    );
    React.useEffect(() => {
      const onChange = (e) => setUser(e.detail);
      window.addEventListener('hl-profile-change', onChange);
      return () => window.removeEventListener('hl-profile-change', onChange);
    }, []);

    const avatar = user && user.avatar_url;
    const label = (user && (user.full_name || user.username)) || 'Profile';
    return ReactDOM.createPortal(
      <a id="topbar-profile-link" className={'topbar-profile' + (active ? ' active' : '')}
        href="Profile.html" title={label} aria-label={label}>
        {avatar
          ? <img src={avatar} alt="" className="topbar-avatar" id="topbar-profile-avatar" />
          : <Icon name="user-round" size={18} color="currentColor" />}
      </a>,
      host
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
    const style = { '--sidebar-active-color': item.color, '--sidebar-idle-color': 'var(--separator)', '--sidebar-active-bg': rgba(item.color, 0.12) };
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
      <React.Fragment>
      <TopbarProfile active={active === 'profile'} />
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
      </React.Fragment>
    );
  }

  window.HL_NAV = { Sidebar, SbItem, SbSubItem, TopbarProfile, rgba, NAV, NAV_TX_SUB, NAV_ACCT_SUB, NAV_CFG_SUB, NAV_BOTTOM, SUBMENUS, usePersistentView };
})();
