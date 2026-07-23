// export-data.jsx — Home Ledger shared "More" control.
// Renders a compact toolbar item with table actions and CSV export options.
// Requires: window.HL_EXPORT (export-data.js), window.Icon (Icon.jsx), React.
(function () {
  const Icon = window.Icon;

  // Props:
  //   entity       — slug used in the filename (e.g. "spending")
  //   entityLabel  — plural noun for menu copy (e.g. "Transactions")
  //   period       — optional suffix for the filtered filename (e.g. "2026-06")
  //   columns      — [{ key, label, get? }] CSV schema
  //   rows         — the rows currently shown (respects active filters)
  //   allRows      — the full entity dataset (ignores filters); defaults to rows
  //   tableTools   — optional table-layout controls rendered in the More popover
  function ExportData({ entity, entityLabel, period, columns, rows, allRows, inline, tableTools }) {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef(null);

    React.useEffect(() => {
      if (!open) return;
      const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
      const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
      return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const all = allRows || rows;
    const hasMore = all.length !== rows.length;     // are filters actually narrowing the set?
    const base = 'home-ledger-' + (entity || 'data');
    const idBase = 'export-' + (entity || 'data');
    const label = entityLabel || 'Records';
    const plural = (n) => n === 1 ? 'row' : 'rows';

    function doExport(scope) {
      const data = scope === 'all' ? all : rows;
      const name = scope === 'all'
        ? base + '-all.csv'
        : base + (period ? '-' + period : '') + '.csv';
      window.HL_EXPORT.exportCSV(name, data, columns);
      setOpen(false);
    }

    // ── Inline mode: render as a filter-bar field that matches the Filters
    //    button exactly (reuses .filters-btn / .filters-text / .filters-caret so
    //    even the mobile icon-only behavior is shared). ──
    if (inline) {
      return (
        <div className="filter-field ff-export">
          <span className="filter-label"><Icon name="circle-ellipsis" size={11} />More</span>
          <div className="filters-anchor export-anchor" ref={ref}>
            <button id={idBase + '-toggle-btn'} className={'filters-btn' + (open ? ' open' : '')}
              onClick={() => setOpen(o => !o)}
              title="More actions">
              <Icon name="circle-ellipsis" size={14} /><span className="filters-text">More</span>
              <svg className="filters-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {open && <Pop />}
          </div>
        </div>
      );
    }

    return (
      <div className="export-bar">
        <div className="export-anchor" ref={ref}>
          <button id={idBase + '-toggle-btn'} className={'export-btn' + (open ? ' open' : '')}
            onClick={() => setOpen(o => !o)}
            title="More actions">
            <Icon name="circle-ellipsis" size={14} />
            <span className="export-btn-label">More</span>
            <svg className="export-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          {open && (
            <Pop />
          )}
        </div>
      </div>
    );

    function Pop() {
      return (
        <div className="export-pop">
          {tableTools && (
            <React.Fragment>
              <div className="export-pop-head export-table-head"><Icon name="columns-3" size={12} />Table</div>
              <div className="export-tools">{tableTools}</div>
            </React.Fragment>
          )}
          <div className="export-pop-head"><Icon name="file-spreadsheet" size={12} />Export As CSV</div>
          <button id={idBase + '-filtered-btn'} className="export-opt" onClick={() => doExport('filtered')}>
            <Icon name={hasMore ? 'list-filter' : 'table'} size={15} />
            <span className="export-opt-txt">
              <span className="export-opt-title">{hasMore ? 'Filtered View' : 'All ' + label}</span>
              <span className="export-opt-sub">{rows.length} {plural(rows.length)}{hasMore ? ' · current filters' : ''}</span>
            </span>
            <Icon name="download" size={13} />
          </button>
          {hasMore && (
            <button id={idBase + '-all-btn'} className="export-opt" onClick={() => doExport('all')}>
              <Icon name="database" size={15} />
              <span className="export-opt-txt">
                <span className="export-opt-title">All {label}</span>
                <span className="export-opt-sub">{all.length} {plural(all.length)} · ignores filters</span>
              </span>
              <Icon name="download" size={13} />
            </button>
          )}
        </div>
      );
    }
  }

  window.ExportData = ExportData;
})();
