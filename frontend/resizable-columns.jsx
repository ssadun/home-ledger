// resizable-columns.jsx — drag-to-resize table columns for Home Ledger.
//
// Powered by TanStack Table v8 (@tanstack/react-table UMD → window.ReactTable).
// The library natively handles the drag math, pointer/touch tracking, and
// min/max clamping; this module adapts it to our hand-rolled <table> markup.
//
// Exports (to window):
//   useResizableColumns({ columns, storageKey, minSize, maxSize })
//     columns:    [{ key, size?, minSize?, maxSize? }, ...]  (px)
//     storageKey: optional localStorage key — persists user widths across reloads
//     returns { tableRef, headersById, colSizeVars, isResizing, resetSizes }
//   attach tableRef to the <table> — resetSizes uses it to fit columns to the
//   visible container width instead of restoring raw px defaults.
//   <ColResizer header={headersById[key]} />  — the grab handle, drop inside each <th>
//
// ── Performance design (the TanStack-documented pattern) ──
// columnResizeMode 'onChange' updates sizing state on every pointer move, but
// widths are applied as CSS custom properties on the <table> element and read
// by <col> elements (table-layout: fixed). During a drag, React only re-renders
// the header row (a handful of <th>); the consumer keeps its <tbody> in a
// React.memo component with stable props, so even thousands of rows are never
// reconciled mid-drag — the browser just recomputes layout from the CSS vars.

(function () {
  const { useReactTable, getCoreRowModel } = window.ReactTable;
  const EMPTY_DATA = []; // stable identity — we only use the sizing feature

  function loadSizing(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; }
  }

  function loadOrder(key) {
    try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : null; } catch (e) { return null; }
  }

  // Inner content width of the scroll container: clientWidth INCLUDES horizontal
  // padding, but the <table> lays out inside the padding box — so fitting to the
  // raw clientWidth makes the table overflow by (paddingLeft+paddingRight) and
  // forces a horizontal scrollbar. Subtract the padding so the fit is exact.
  function innerWidth(wrap) {
    if (!wrap) return 0;
    const cs = getComputedStyle(wrap);
    return wrap.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  }

  // Fit a set of columns to exactly fill `avail` px. Each item: {key, base, min, max}.
  // `base` widths set the relative proportions; we scale them to the target, clamp
  // to min/max, then water-fill the residual onto the still-flexible columns and
  // repeat — so the column total equals the container width exactly (no h-scroll),
  // unless every column is pinned to its min and still overflows (unavoidable).
  function fitWidths(items, avail) {
    const totalBase = items.reduce((s, i) => s + i.base, 0) || 1;
    const w = {};
    items.forEach(i => { w[i.key] = i.base * (avail / totalBase); });
    for (let iter = 0; iter < 10; iter++) {
      let sum = 0; const flex = [];
      items.forEach(i => {
        let v = w[i.key];
        if (v < i.min) v = i.min;
        else if (v > i.max) v = i.max;
        else flex.push(i.key);
        w[i.key] = v; sum += v;
      });
      const residual = avail - sum;
      if (Math.abs(residual) < 0.5 || !flex.length) break;
      const per = residual / flex.length;
      flex.forEach(k => { w[k] += per; });
    }
    const sizing = {};
    items.forEach(i => { sizing[i.key] = Math.round(w[i.key]); });
    // absorb integer rounding drift on the widest column so the sum is exact
    let sum = 0; for (const k in sizing) sum += sizing[k];
    const drift = Math.round(avail) - sum;
    if (drift !== 0 && items.length) {
      const k = items.slice().sort((a, b) => sizing[b.key] - sizing[a.key])[0].key;
      sizing[k] += drift;
    }
    return sizing;
  }

  function useResizableColumns({ columns, storageKey, minSize = 80, maxSize = 600 }) {
    // Controlled sizing state, seeded from localStorage so widths survive reloads.
    const [columnSizing, setColumnSizing] = React.useState(() => (storageKey ? loadSizing(storageKey) : {}));
    const tableRef = React.useRef(null);

    // ── Column ORDER state (drag-to-reorder) ──────────────────────────────
    // Persisted as an array of column keys at `<storageKey>-order`, seeded from
    // localStorage so a user's chosen order survives reloads. null = default order.
    const orderKey = storageKey ? storageKey + '-order' : null;
    const [order, setOrder] = React.useState(() => (orderKey ? loadOrder(orderKey) : null));
    const [dragKey, setDragKey] = React.useState(null);   // column being dragged
    const [overKey, setOverKey] = React.useState(null);   // column under the cursor

    // Map our simple column descriptors to TanStack ColumnDefs.
    // size = initial width; minSize / maxSize = hard drag constraints (px).
    const tableColumns = React.useMemo(() => columns.map(c => ({
      id: c.key,
      accessorKey: c.key,
      size: c.size,
      minSize: c.minSize,
      maxSize: c.maxSize,
    })), [columns]);

    const table = useReactTable({
      data: EMPTY_DATA,
      columns: tableColumns,
      getCoreRowModel: getCoreRowModel(),
      enableColumnResizing: true,
      columnResizeMode: 'onChange',                 // live resize (no ghost bar)
      defaultColumn: { minSize, maxSize },          // fallback constraints
      state: { columnSizing },
      onColumnSizingChange: setColumnSizing,
    });

    const headers = table.getFlatHeaders();
    const isResizing = !!table.getState().columnSizingInfo.isResizingColumn;

    // Track "just finished resizing" — stays true for 200ms after drag ends
    // so the click event that fires on mouseup doesn't trigger a sort.
    const wasResizingRef = React.useRef(false);
    React.useEffect(() => {
      if (isResizing) { wasResizingRef.current = true; }
      else if (wasResizingRef.current) {
        const id = setTimeout(() => { wasResizingRef.current = false; }, 200);
        return () => clearTimeout(id);
      }
    }, [isResizing]);

    // CSS variable map: { '--rz-total': '1090px', '--rz-date': '130px', ... }
    // Recomputed only when a width actually changes.
    const colSizeVars = React.useMemo(() => {
      const vars = { '--rz-total': table.getTotalSize() + 'px' };
      headers.forEach(h => { vars['--rz-' + h.column.id] = h.getSize() + 'px'; });
      return vars;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [columnSizing, tableColumns]);

    // Persist widths — debounced, and never while a drag is in progress.
    React.useEffect(() => {
      if (!storageKey || isResizing) return;
      const id = setTimeout(() => {
        try { localStorage.setItem(storageKey, JSON.stringify(columnSizing)); } catch (e) {}
      }, 250);
      return () => clearTimeout(id);
    }, [columnSizing, isResizing, storageKey]);

    // Page-wide col-resize cursor + selection lock while dragging.
    React.useEffect(() => {
      document.body.classList.toggle('col-resizing', isResizing);
      return () => document.body.classList.remove('col-resizing');
    }, [isResizing]);

    const headersById = React.useMemo(() => {
      const m = {};
      headers.forEach(h => { m[h.column.id] = h; });
      return m;
    }, [headers]);

    // ── Fluid fit ──
    // Watch the scroll container; whenever its width changes (window resize,
    // sidebar toggle, first mount) rescale all column widths proportionally so
    // the table always fills the available width exactly. The user's relative
    // proportions are preserved; only the absolute pixels adapt.
    const sizingRef = React.useRef(columnSizing);
    sizingRef.current = columnSizing;
    React.useEffect(() => {
      let ro = null, rafId = null, tries = 0;
      const fit = (wrap) => {
        if (window.matchMedia('(max-width: 660px)').matches) return;     // mobile = stacked cards, no columns
        if (document.body.classList.contains('col-resizing')) return;    // never fight an active drag
        const avail = innerWidth(wrap);
        if (!avail) return;
        const cur = columns.map(c => ({
          key: c.key,
          base: sizingRef.current[c.key] || c.size || 150,
          min: c.minSize != null ? c.minSize : minSize,
          max: c.maxSize != null ? c.maxSize : maxSize,
        }));
        const total = cur.reduce((s, c) => s + c.base, 0);
        if (!total || Math.abs(total - avail) < 2) return;
        setColumnSizing(fitWidths(cur, avail));     // keep current proportions, fill width exactly
      };
      // The table may mount a frame or two after this effect (e.g. it sits behind a
      // layout toggle), so retry the lookup until it appears, then observe + fit.
      const setup = () => {
        const el = tableRef.current;
        const wrap = el && (el.closest('.table-scroll') || el.parentElement);
        if (!wrap || typeof ResizeObserver === 'undefined') {
          if (tries++ < 30) rafId = requestAnimationFrame(setup);
          return;
        }
        fit(wrap);                                  // initial fit to the container width
        ro = new ResizeObserver(() => fit(wrap));   // refit on resize (window, sidebar)
        ro.observe(wrap);
      };
      setup();
      return () => { if (ro) ro.disconnect(); if (rafId) cancelAnimationFrame(rafId); };
    }, [columns, minSize, maxSize]);

    // Reset: fit columns to the visible container width. Declared default
    // sizes are treated as proportions and scaled so the total equals the
    // container's width (clamped to each column's min/max) — so a reset never
    // leaves the table wider than the page (no horizontal scroll).
    const resetSizes = React.useCallback(() => {
      const el = tableRef.current;
      const wrap = el && (el.closest('.table-scroll') || el.parentElement);
      const avail = innerWidth(wrap);
      const defs = columns.map(c => ({
        key: c.key,
        base: c.size || 150,
        min: c.minSize != null ? c.minSize : minSize,
        max: c.maxSize != null ? c.maxSize : maxSize,
      }));
      if (avail > 0) {
        setColumnSizing(fitWidths(defs, avail));    // default proportions, scaled to fill width exactly
      } else {
        table.resetColumnSizing(true);
      }
      if (storageKey) { try { localStorage.removeItem(storageKey); } catch (e) {} }
    }, [table, storageKey, columns, minSize, maxSize]);

    // ── Column ordering ──────────────────────────────────────────────────
    // Resolve the user's saved order against the *current* column set: keep saved
    // keys that still exist (in saved order), then append any columns the saved
    // order doesn't mention (e.g. a column toggled back on, or a newly added one).
    const orderedColumns = React.useMemo(() => {
      if (!order || !order.length) return columns;
      const byKey = {}; columns.forEach(c => { byKey[c.key] = c; });
      const used = {}; const out = [];
      order.forEach(k => { if (byKey[k] && !used[k]) { out.push(byKey[k]); used[k] = 1; } });
      columns.forEach(c => { if (!used[c.key]) out.push(c); });
      return out;
    }, [columns, order]);

    const defaultKeys = React.useMemo(() => columns.map(c => c.key).join('\u0001'), [columns]);
    const isDefaultOrder = orderedColumns.map(c => c.key).join('\u0001') === defaultKeys;

    // Move column `from` to occupy `to`'s slot, shifting the rest.
    const moveColumn = React.useCallback((from, to) => {
      setOrder(prev => {
        const base = (prev && prev.length) ? prev.slice() : columns.map(c => c.key);
        columns.forEach(c => { if (base.indexOf(c.key) < 0) base.push(c.key); }); // include any missing
        const fi = base.indexOf(from), ti = base.indexOf(to);
        if (fi < 0 || ti < 0 || fi === ti) return prev;
        base.splice(ti, 0, base.splice(fi, 1)[0]);
        return base;
      });
    }, [columns]);

    // Persist (or clear) the saved order whenever it changes.
    React.useEffect(() => {
      if (!orderKey) return;
      try {
        if (order && order.length) localStorage.setItem(orderKey, JSON.stringify(order));
        else localStorage.removeItem(orderKey);
      } catch (e) {}
    }, [order, orderKey]);

    // Restore the original column order and forget the saved one.
    const resetOrder = React.useCallback(() => { setOrder(null); }, []);

    // Props to spread on each <th> to make it a drag-reorder source + drop target.
    // Grabbing the resize handle never starts a reorder (it preventDefaults the
    // native drag); a plain click still sorts because HTML5 drag suppresses click.
    const getReorderProps = React.useCallback((key) => ({
      draggable: true,
      'data-col-drag': dragKey === key ? 'src' : (overKey === key && dragKey ? 'over' : undefined),
      onDragStart: (e) => {
        if (e.target.closest && e.target.closest('.col-resizer')) { e.preventDefault(); return; }
        setDragKey(key);
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); } catch (_) {}
      },
      onDragOver: (e) => { if (dragKey && dragKey !== key) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (_) {} } },
      onDragEnter: () => { if (dragKey && dragKey !== key) setOverKey(key); },
      onDrop: (e) => { e.preventDefault(); if (dragKey && dragKey !== key) moveColumn(dragKey, key); setDragKey(null); setOverKey(null); },
      onDragEnd: () => { setDragKey(null); setOverKey(null); },
    }), [dragKey, overKey, moveColumn]);

    return { tableRef, headersById, colSizeVars, isResizing, wasResizingRef, resetSizes,
             orderedColumns, getReorderProps, resetOrder, isDefaultOrder, isReordering: !!dragKey };
  }

  // ── The grab handle ──
  // 9px hit area hugging the right edge of the <th>, col-resize cursor,
  // visible hairline that brightens on hover and glows accent while dragging.
  // Double-click resets that one column. stopPropagation everywhere so the
  // th's sort-on-click never fires from a resize gesture.
  function ColResizer({ header }) {
    if (!header || !header.column.getCanResize()) return null;
    const handler = header.getResizeHandler();
    return (
      <span
        className={'col-resizer' + (header.column.getIsResizing() ? ' resizing' : '')}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handler(e); }}
        onTouchStart={(e) => { e.stopPropagation(); handler(e); }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => { e.stopPropagation(); header.column.resetSize(); }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize column"
        title="Drag To Resize · Double-Click To Reset"
      ></span>
    );
  }

  // ── The "Fit Columns" toolbar button (centralized) ──
  // Every table's filter bar renders this same control — wire it straight to the
  // hook: <FitColumnsButton onClick={rz.resetSizes} />. resetSizes fits all
  // columns to the table-card width. Returns null when no handler is supplied.
  function FitColumnsButton({ onClick, label, id }) {
    if (!onClick) return null;
    const Icon = window.Icon;
    return (
      <button id={id || 'fit-columns-btn'} className="fp-reset" onClick={onClick} title="Fit All Columns To The Table Width">
        <Icon name="unfold-horizontal" size={12} />{label || 'Fit Columns'}
      </button>
    );
  }

  // ── The "Reset Order" toolbar button ──
  // Restores the table's columns to their original left-to-right order and
  // forgets the user's saved arrangement. Disabled while already at default.
  function ResetOrderButton({ onClick, disabled, label, id }) {
    if (!onClick) return null;
    const Icon = window.Icon;
    return (
      <button id={id || 'reset-order-btn'} className="fp-reset" onClick={onClick} disabled={disabled}
        title="Restore Columns To Their Original Order">
        <Icon name="list-restart" size={12} />{label || 'Reset Order'}
      </button>
    );
  }

  Object.assign(window, { useResizableColumns, ColResizer, FitColumnsButton, ResetOrderButton });
})();
