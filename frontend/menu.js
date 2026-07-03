// ═══════════════════════════════════════════════════════════════════════════
// menu.js — Collapsible sidebar toggle logic for Home Ledger.
// Mirrors the NAS Monitor sidebar system: collapsed (69px, icons only) /
// expanded (175px, icons + labels). State persists in sessionStorage.
// All state is driven off the `sidebar-expanded` class on <body>.
// ═══════════════════════════════════════════════════════════════════════════

const HL_SIDEBAR_KEY = 'hl-sidebar-expanded';

// Custom expanded width persists across visits (localStorage, not sessionStorage).
const HL_SIDEBAR_W_KEY = 'hl-sidebar-width';
const HL_SB_MIN = 180;         // narrowest expanded width; dragging below this collapses to the icon rail
const HL_SB_MAX = 420;         // widest allowed
const HL_SB_COLLAPSE_AT = 70;  // drag narrower than this → collapse to the icon rail

// Apply the persisted expanded width as a CSS var on <html>; the sidebar + main
// column read it via var(--hl-sidebar-w,175px). Runs before paint so there's no
// flash at the default width.
function applySidebarWidth() {
  const raw = parseInt(localStorage.getItem(HL_SIDEBAR_W_KEY), 10);
  if (raw >= HL_SB_MIN && raw <= HL_SB_MAX) {
    document.documentElement.style.setProperty('--hl-sidebar-w', raw + 'px');
  }
}

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
applySidebarWidth();

// Drag-to-resize the expanded sidebar. Delegated off document so it works
// regardless of when React mounts the #sidebar-resizer handle. Only active when
// expanded on desktop; the width tracks the cursor's X (sidebar is left-anchored)
// and is clamped, then persisted to localStorage on release.
document.addEventListener('pointerdown', function (e) {
  const handle = e.target.closest && e.target.closest('#sidebar-resizer');
  if (!handle) return;
  if (window.innerWidth <= 660) return;
  if (!document.body.classList.contains('sidebar-expanded')) return;
  e.preventDefault();
  document.body.classList.add('sidebar-resizing');
  try { handle.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }

  const onMove = function (ev) {
    const x = Math.round(ev.clientX);
    const expanded = document.body.classList.contains('sidebar-expanded');
    // Dragging narrower than the minimum collapses to the icon rail. The stored
    // width is left untouched so re-expanding restores the last good width.
    if (x < HL_SB_MIN) {
      if (expanded) {
        document.body.classList.remove('sidebar-expanded');
        sessionStorage.setItem(HL_SIDEBAR_KEY, 'false');
        updateSidebarToggleLabel();
      }
      return;
    }
    // At/above the minimum: ensure expanded and track the cursor (clamped).
    if (!expanded) {
      document.body.classList.add('sidebar-expanded');
      sessionStorage.setItem(HL_SIDEBAR_KEY, 'true');
      updateSidebarToggleLabel();
    }
    document.documentElement.style.setProperty('--hl-sidebar-w', Math.min(x, HL_SB_MAX) + 'px');
  };
  const onUp = function () {
    document.body.classList.remove('sidebar-resizing');
    try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    // Only persist a width when we ended expanded; if the drag collapsed the menu,
    // keep the previously stored width for the next expand.
    if (!document.body.classList.contains('sidebar-expanded')) return;
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hl-sidebar-w'), 10);
    if (cur >= HL_SB_MIN && cur <= HL_SB_MAX) localStorage.setItem(HL_SIDEBAR_W_KEY, String(cur));
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
});

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
