// ═══════════════════════════════════════════════════════════════════════════
// menu.js — Collapsible sidebar toggle logic for Hyper Ledger.
// Mirrors the NAS Monitor sidebar system: collapsed (69px, icons only) /
// expanded (175px, icons + labels). State persists in sessionStorage.
// All state is driven off the `sidebar-expanded` class on <body>.
// ═══════════════════════════════════════════════════════════════════════════

const HL_SIDEBAR_KEY = 'hl-sidebar-expanded';

function updateSidebarToggleLabel() {
  const label = document.getElementById('sidebar-toggle-label');
  if (!label) return;
  const expanded = document.body.classList.contains('sidebar-expanded');
  const iconName = expanded ? 'ChevronsLeft' : 'ChevronsRight';
  if (window.lucide && window.lucide[iconName]) {
    label.innerHTML = '';
    const svg = window.lucide.createElement(window.lucide[iconName]);
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('stroke-width', '2');
    label.appendChild(svg);
  } else {
    // fallback text while Lucide CDN loads
    label.textContent = expanded ? '<' : '>';
  }
}

function applySidebarState() {
  const expanded = sessionStorage.getItem(HL_SIDEBAR_KEY) === 'true';
  document.body.classList.toggle('sidebar-expanded', expanded);
  updateSidebarToggleLabel();
}

function toggleSidebar() {
  const expanded = !document.body.classList.contains('sidebar-expanded');
  document.body.classList.toggle('sidebar-expanded', expanded);
  sessionStorage.setItem(HL_SIDEBAR_KEY, String(expanded));
  updateSidebarToggleLabel();
}

function closeSidebar() {
  document.body.classList.remove('sidebar-expanded');
  sessionStorage.setItem(HL_SIDEBAR_KEY, 'false');
  updateSidebarToggleLabel();
}

// Apply persisted state immediately (before React paints the sidebar) so the
// first frame is already correct; the label is re-synced once React mounts.
applySidebarState();

// Close mobile submenus when tapping outside the sidebar.
// Works by programmatically clicking the open parent's toggle button,
// which triggers React's onClick and keeps state in sync.
document.addEventListener('click', function (e) {
  if (window.innerWidth > 660) return;
  var sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.contains(e.target)) return;
  // Also ignore clicks on the mobile backdrop (it has its own handler)
  if (e.target.classList && e.target.classList.contains('mobile-sub-backdrop')) return;
  var openBtns = sidebar.querySelectorAll('.sidebar-parent.open > .sidebar-item');
  openBtns.forEach(function (btn) { btn.click(); });
});

// Expose for React onClick handlers + post-mount label sync.
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.updateSidebarToggleLabel = updateSidebarToggleLabel;
