// statements-app.jsx — Home Ledger Statements page (bank-account statement archive).
// This page owns the Import Statement wizard (moved here from Accounts): importing
// is what creates a statement record, so the wizard belongs with the archive.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { Sidebar } = window.HL_NAV;
  const { CURRENT_YEAR } = window.LEDGER;
  const ImportWizard = window.ImportWizard;
  const ST_API = window.HL_STATEMENTS_API;
  const { StatementTable, StatementFormModal, StatementDetail, DeleteStatementConfirm } = window;

  // ── Filter bar ────────────────────────────────────────────────────────────
  // Same structure/classes as Credit Payments' bar — Year stepper, search, and an
  // Account filter in the Filters popup.
  function StatementFilterBar({ year, onYearStep, acctFilter, setAcctFilter, search, setSearch, accounts }) {
    const [open, setOpen] = React.useState(false);
    const anchorRef = React.useRef(null);
    React.useEffect(() => {
      if (!open) return;
      // Don't close on clicks inside a portaled StyledSelect dropdown (rendered to
      // <body>), or picking a filter option would unmount the popover mid-click.
      const onDoc = (e) => { if (anchorRef.current && !anchorRef.current.contains(e.target) && !e.target.closest('.ss-dropdown')) setOpen(false); };
      const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
      return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const acctName = (a) => a.name + (a.number && a.number !== '–' ? ' ' + a.number : '');
    const activeAcct = accounts.find(a => String(a._dbId) === String(acctFilter));
    const active = [
      acctFilter !== 'all' && { key: 'account', label: 'Account', val: activeAcct ? acctName(activeAcct) : acctFilter, clear: () => setAcctFilter('all') },
    ].filter(Boolean);
    const clearAll = () => setAcctFilter('all');

    return (
      <div className="filter-wrap">
        <div className="filter-bar">
          <div className="filter-field ff-period">
            <span className="filter-label"><Icon name="calendar" size={11} />Year</span>
            <div className="month-step">
              <button id="st-year-prev-btn" className="ms-btn" onClick={() => onYearStep(-1)} title="Previous year"><Icon name="chevron-left" size={14} /></button>
              <span className="ms-label"><Icon name="calendar-days" size={13} />{year}</span>
              <button id="st-year-next-btn" className="ms-btn" onClick={() => onYearStep(1)} title="Next year"><Icon name="chevron-right" size={14} /></button>
            </div>
          </div>
          <div className="filter-field ff-search">
            <span className="filter-label"><Icon name="search" size={11} />Search</span>
            <div className="search-wrap">
              <Icon name="search" size={13} />
              <input id="st-filter-search-input" className="search-input" placeholder="Statement, account or file…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="filter-field ff-filters">
            <span className="filter-label"><Icon name="sliders-horizontal" size={11} />Filters</span>
            <div className="filters-anchor" ref={anchorRef}>
              <button id="st-filter-toggle-btn" className={'filters-btn' + (active.length ? ' has' : '') + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
                <Icon name="sliders-horizontal" size={14} /><span className="filters-text">Filters</span>
                {active.length > 0 && <span className="filters-count">{active.length}</span>}
                <svg className="filters-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {open && (
                <div className="filters-pop">
                  <div className="filters-pop-head">
                    <span>Filter By Column</span>
                    {active.length > 0 && <button id="st-filter-clear-all-btn" className="fp-clear" onClick={clearAll}><Icon name="x" size={12} />Clear All</button>}
                  </div>
                  <div className="filter-field">
                    <span className="filter-label"><Icon name="landmark" size={11} />Account</span>
                    <div className="select-wrap">
                      <StyledSelect id="st-filter-account-select" className="sel" value={acctFilter} onChange={e => setAcctFilter(e.target.value)}>
                        <option value="all">All Accounts</option>
                        {accounts.map(a => <option key={a._dbId} value={a._dbId}>{acctName(a)}</option>)}
                      </StyledSelect>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        {active.length > 0 && (
          <div className="active-chips">
            <span className="chips-lead"><Icon name="filter" size={12} />Active</span>
            {active.map(a => (
              <button key={a.key} id={'st-filter-chip-' + a.key} className="chip" onClick={a.clear} title={'Clear ' + a.label + ' filter'}>
                <span className="chip-k">{a.label}:</span><span className="chip-v">{a.val}</span><Icon name="x" size={11} />
              </button>
            ))}
            <button id="st-filter-chips-clear-btn" className="chip chip-clear" onClick={clearAll}>Clear All</button>
          </div>
        )}
      </div>
    );
  }

  function App() {
    const [records, setRecords] = React.useState([]);
    const [accounts, setAccounts] = React.useState([]);
    const [loadError, setLoadError] = React.useState(null);
    const [detail, setDetail] = React.useState(null);        // record obj
    const [formModal, setFormModal] = React.useState(null);  // {mode, record}
    const [del, setDel] = React.useState(null);              // record to delete
    // The wizard is opened by ?import=1 too, so a deep link from the Accounts
    // detail modal lands straight on Choose File with the account pre-selected.
    const [importWiz, setImportWiz] = React.useState(() => {
      const q = new URLSearchParams(window.location.search);
      return q.get('import') ? { preAccId: q.get('account') || null } : null;
    });
    // Mass-delete: ids of checkbox-selected rows + the batch-confirm dialog toggle.
    const [selected, setSelected] = React.useState(() => new Set());
    const [batchDel, setBatchDel] = React.useState(false);
    const toggleSelect = React.useCallback((id) => setSelected(s => {
      const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
    }), []);

    // Filter bar state — year stepper + account filter + free-text search.
    const [year, setYear] = React.useState(CURRENT_YEAR);
    const [acctFilter, setAcctFilter] = React.useState('all');
    const [search, setSearch] = React.useState('');
    function yearStep(d) { setYear(y => y + d); }

    // Rows after filtering; records without a statement year always pass the year check.
    const visible = React.useMemo(() => records.filter(r => {
      if (r.year != null && r.year !== year) return false;
      if (acctFilter !== 'all' && String(r.accountId) !== String(acctFilter)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = ((r.name || '') + ' ' + (r.acctLabel || '') + ' ' + (r.accountKey || '') + ' ' + (r.fileName || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }), [records, year, acctFilter, search]);

    // Reset any checkbox selection when the filtered view changes.
    React.useEffect(() => { setSelected(new Set()); }, [year, acctFilter, search]);

    // Attach a human account label to each record from the loaded accounts.
    const labelRecords = React.useCallback((recs, acctList) => {
      const byId = {};
      acctList.forEach(a => { byId[a._dbId] = a; byId[a.id] = a; });
      return recs.map(r => {
        const a = byId[r.accountId] || byId[r.accountKey];
        const inst = a && a.institution && a.institution !== '–' ? a.institution : null;
        const namePart = a ? a.name : null;
        // acctLabel is the full plain string (institution + name) — used for search
        // and the modal subtitle; acctInst/acctNamePart drive the styled ACCOUNT cell.
        const label = namePart ? ((inst ? inst + ' · ' : '') + namePart) : null;
        return { ...r, acctLabel: label, acctInst: inst, acctNamePart: namePart };
      });
    }, []);

    function reload(acctList) {
      const list = acctList || accounts;
      return ST_API.list()
        .then(recs => {
          const labeled = labelRecords(recs, list);
          setRecords(labeled);
          return labeled;
        })
        .catch(err => setLoadError(err.message));
    }

    // Hydrate the institution map FIRST, then accounts (for the picker + labels),
    // then records. The institution map is not cosmetic here: the wizard's "Create
    // from statement…" draft resolves the parsed bank through it, and the account
    // form refuses to save an account with a blank institution — so without this
    // the draft silently won't save. A failure is non-fatal for the rest of the
    // page (the bootstrap map still names the banks, only logos are missing).
    React.useEffect(() => {
      const insts = window.HL_INSTITUTIONS_API
        ? window.HL_INSTITUTIONS_API.hydrate().catch(err => {
            console.warn('[statements] institutions unavailable:', err.message);
          })
        : Promise.resolve();
      insts
        .then(() => ST_API.statementAccounts())
        .then(acctList => { setAccounts(acctList); return reload(acctList); })
        .catch(err => setLoadError(err.message));
    }, []); // eslint-disable-line

    // Keep the open detail modal in sync with the freshly-loaded record.
    function refreshKeepingDetail() {
      reload().then(labeled => {
        if (labeled && detail) {
          const fresh = labeled.find(r => r.id === detail.id);
          if (fresh) setDetail(fresh);
        }
      });
    }

    function handleSave(rec) {
      const op = rec.id ? ST_API.update(rec.id, rec) : ST_API.create(rec);
      op.then(() => reload())
        .then(() => { setFormModal(null); setDetail(null); })
        .catch(err => setLoadError(err.message));
    }

    function handleDelete() {
      const target = del;
      ST_API.remove(target.id)
        .then(() => { setDel(null); setDetail(null); return reload(); })
        .catch(err => setLoadError(err.message));
    }

    // Mass delete — loops the per-row API (no bulk endpoint needed); keeps rows that
    // failed so the user sees exactly what remains, and never silently drops errors.
    function confirmBatchDelete() {
      const ids = records.filter(r => selected.has(r.id)).map(r => r.id);
      Promise.allSettled(ids.map(id => ST_API.remove(id)))
        .then(results => {
          const failed = results.filter(r => r.status === 'rejected').length;
          setSelected(new Set());
          setBatchDel(false);
          return reload().then(() => {
            if (failed) setLoadError(failed + (failed === 1 ? ' record' : ' records') + ' could not be deleted.');
          });
        });
    }

    // Select-all — no pagination on this page, so it spans every visible record.
    const selectedIds = visible.filter(r => selected.has(r.id)).map(r => r.id);
    const allSelected = visible.length > 0 && selectedIds.length === visible.length;
    const someSelected = selectedIds.length > 0 && !allSelected;
    const toggleSelectAll = () => setSelected(s => {
      if (allSelected) return new Set();
      return new Set(visible.map(r => r.id));
    });

    function openEdit(record) { setDetail(null); setFormModal({ mode: 'edit', record }); }
    function openDeleteFromDetail(record) { setDetail(null); setDel(record); }

    // Apply an approved import. This carries the balance sync that used to live on
    // the Accounts page: re-hydrate from the backend first (so accounts created
    // inside the wizard show up), then move each affected account's balance by its
    // net delta and persist it. Finally reload the archive — the wizard has created
    // a Statement record per imported bank account.
    function handleImport(rows, byAcc) {
      window.HL_ACCOUNTS_API.list().then(fresh => {
        const affected = fresh.filter(a => byAcc && byAcc[a.id]);
        return Promise.all(affected.map(a => {
          const updated = { ...a, balance: +(a.balance + byAcc[a.id].delta).toFixed(2) };
          return window.HL_ACCOUNTS_API.update(a._dbId, updated);
        }));
      })
        .then(() => ST_API.statementAccounts())
        .then(acctList => { setAccounts(acctList); return reload(acctList); })
        .catch(err => setLoadError(err.message));
    }

    return (
      <div className="app">
        <Sidebar active="statements" />
        <div className="main">
          <header className="page-head">
            <div className="page-head-top">
              <div className="page-title-wrap cfg-detail-title-wrap">
                <div className="cfg-title-col">
                  <h1 className="page-title">Statements</h1>
                  <p className="page-subtitle">Uploaded bank-account statements</p>
                </div>
              </div>
              <div className="head-actions">
                <button id="st-import-btn" className="action-modal-btn scan" onClick={() => setImportWiz({ preAccId: null })}><Icon name="file-down" size={14} />Import Statement</button>
                <button id="st-add-btn" className="action-modal-btn ok" onClick={() => setFormModal({ mode: 'add', record: {} })}><Icon name="plus" size={14} />Add Statement</button>
              </div>
            </div>
            <StatementFilterBar
              year={year} onYearStep={yearStep}
              acctFilter={acctFilter} setAcctFilter={setAcctFilter}
              search={search} setSearch={setSearch}
              accounts={accounts} />
          </header>

          <div className="st-body">
            {loadError && <div className="st-error" id="st-load-error"><Icon name="alert-triangle" size={13} />{loadError}</div>}
            {selectedIds.length > 0 && (
              <div className="bulk-bar" id="st-bulk-bar">
                <span className="bulk-count"><Icon name="check-square" size={14} />{selectedIds.length} selected</span>
                <div className="bulk-actions">
                  <button id="st-bulk-clear-btn" className="list-btn blue" onClick={() => setSelected(new Set())}><Icon name="x" size={12} />Clear</button>
                  <button id="st-bulk-delete-btn" className="list-btn red" onClick={() => setBatchDel(true)}><Icon name="trash-2" size={12} />Delete Selected</button>
                </div>
              </div>
            )}
            <StatementTable
              records={visible}
              onRowClick={setDetail}
              onEdit={(r) => setFormModal({ mode: 'edit', record: r })}
              onDelete={setDel}
              selectable selected={selected} onToggleSelect={toggleSelect}
              allSelected={allSelected} someSelected={someSelected} onToggleSelectAll={toggleSelectAll} />
          </div>
        </div>

        {detail && <StatementDetail record={detail}
          onClose={() => setDetail(null)} onEdit={openEdit} onDelete={openDeleteFromDetail}
          onChanged={refreshKeepingDetail} />}
        {formModal && <StatementFormModal initial={formModal.record} accounts={accounts}
          onClose={() => setFormModal(null)} onSave={handleSave} />}
        {del && <DeleteStatementConfirm record={del}
          onClose={() => setDel(null)} onConfirm={handleDelete} />}
        {batchDel && <DeleteStatementConfirm count={selectedIds.length}
          onClose={() => setBatchDel(false)} onConfirm={confirmBatchDelete} />}
        {importWiz && <ImportWizard preAccId={importWiz.preAccId}
          onClose={() => setImportWiz(null)} onCommit={handleImport} />}
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
