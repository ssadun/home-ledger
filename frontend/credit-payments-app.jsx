// credit-payments-app.jsx — Home Ledger Credit Payments page.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { Sidebar } = window.HL_NAV;
  const { CURRENT_YEAR } = window.LEDGER;
  const CP_API = window.HL_CREDIT_PAYMENTS_API;
  const { CreditPaymentTable, CreditPaymentFormModal, CreditPaymentDetail, DeleteCreditPaymentConfirm } = window;

  // ── Filter bar ────────────────────────────────────────────────────────────
  // Same structure/classes as Account Activity's bar, but the only period filter
  // is a Year stepper (no month) — statements are filtered by their statement year.
  function CreditPaymentFilterBar({ year, onYearStep, cardFilter, setCardFilter, search, setSearch, cards }) {
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

    const cardName = (c) => c.name + (c.number && c.number !== '–' ? ' ' + c.number : '');
    const activeCard = cards.find(c => String(c._dbId) === String(cardFilter));
    const active = [
      cardFilter !== 'all' && { key: 'card', label: 'Card', val: activeCard ? cardName(activeCard) : cardFilter, clear: () => setCardFilter('all') },
    ].filter(Boolean);
    const clearAll = () => setCardFilter('all');

    return (
      <div className="filter-wrap">
        <div className="filter-bar">
          <div className="filter-field ff-period">
            <span className="filter-label"><Icon name="calendar" size={11} />Year</span>
            <div className="month-step">
              <button id="cp-year-prev-btn" className="ms-btn" onClick={() => onYearStep(-1)} title="Previous year"><Icon name="chevron-left" size={14} /></button>
              <span className="ms-label"><Icon name="calendar-days" size={13} />{year}</span>
              <button id="cp-year-next-btn" className="ms-btn" onClick={() => onYearStep(1)} title="Next year"><Icon name="chevron-right" size={14} /></button>
            </div>
          </div>
          <div className="filter-field ff-search">
            <span className="filter-label"><Icon name="search" size={11} />Search</span>
            <div className="search-wrap">
              <Icon name="search" size={13} />
              <input id="cp-filter-search-input" className="search-input" placeholder="Statement or card…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="filter-field ff-filters">
            <span className="filter-label"><Icon name="sliders-horizontal" size={11} />Filters</span>
            <div className="filters-anchor" ref={anchorRef}>
              <button id="cp-filter-toggle-btn" className={'filters-btn' + (active.length ? ' has' : '') + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
                <Icon name="sliders-horizontal" size={14} /><span className="filters-text">Filters</span>
                {active.length > 0 && <span className="filters-count">{active.length}</span>}
                <svg className="filters-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {open && (
                <div className="filters-pop">
                  <div className="filters-pop-head">
                    <span>Filter By Column</span>
                    {active.length > 0 && <button id="cp-filter-clear-all-btn" className="fp-clear" onClick={clearAll}><Icon name="x" size={12} />Clear All</button>}
                  </div>
                  <div className="filter-field">
                    <span className="filter-label"><Icon name="credit-card" size={11} />Card</span>
                    <div className="select-wrap">
                      <StyledSelect id="cp-filter-card-select" className="sel" value={cardFilter} onChange={e => setCardFilter(e.target.value)}>
                        <option value="all">All Cards</option>
                        {cards.map(c => <option key={c._dbId} value={c._dbId}>{cardName(c)}</option>)}
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
              <button key={a.key} id={'cp-filter-chip-' + a.key} className="chip" onClick={a.clear} title={'Clear ' + a.label + ' filter'}>
                <span className="chip-k">{a.label}:</span><span className="chip-v">{a.val}</span><Icon name="x" size={11} />
              </button>
            ))}
            <button id="cp-filter-chips-clear-btn" className="chip chip-clear" onClick={clearAll}>Clear All</button>
          </div>
        )}
      </div>
    );
  }

  function App() {
    const [records, setRecords] = React.useState([]);
    const [cards, setCards] = React.useState([]);
    const [loadError, setLoadError] = React.useState(null);
    const [detail, setDetail] = React.useState(null);       // record obj
    const [formModal, setFormModal] = React.useState(null);  // {mode, record}
    const [del, setDel] = React.useState(null);              // record to delete
    // Mass-delete: ids of checkbox-selected rows + the batch-confirm dialog toggle.
    const [selected, setSelected] = React.useState(() => new Set());
    const [batchDel, setBatchDel] = React.useState(false);
    const toggleSelect = React.useCallback((id) => setSelected(s => {
      const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
    }), []);

    // Filter bar state — year stepper + card filter + free-text search.
    const [year, setYear] = React.useState(CURRENT_YEAR);
    const [cardFilter, setCardFilter] = React.useState('all');
    const [search, setSearch] = React.useState('');
    function yearStep(d) { setYear(y => y + d); }

    // Rows after filtering; records without a statement year always pass the year check.
    const visible = React.useMemo(() => records.filter(r => {
      if (r.year != null && r.year !== year) return false;
      if (cardFilter !== 'all' && String(r.accountId) !== String(cardFilter)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = ((r.name || '') + ' ' + (r.cardLabel || '') + ' ' + (r.accountKey || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }), [records, year, cardFilter, search]);

    // Reset any checkbox selection when the filtered view changes.
    React.useEffect(() => { setSelected(new Set()); }, [year, cardFilter, search]);

    // Attach a human card label to each record from the loaded cards.
    const labelRecords = React.useCallback((recs, cardList) => {
      const byId = {};
      cardList.forEach(c => { byId[c._dbId] = c; byId[c.id] = c; });
      return recs.map(r => {
        const c = byId[r.accountId] || byId[r.accountKey];
        const inst = c && c.institution && c.institution !== '–' ? c.institution : null;
        const cNumber = c && c.number && c.number !== '–' ? window.HL_ACCOUNTS_API.maskCardNumber(c.number) : null;
        const namePart = c ? (c.name + (cNumber ? ' ' + cNumber : '')) : null;
        // cardLabel is the full plain string (institution + name) — used for search
        // and the modal subtitle; cardInst/cardNamePart drive the styled CARD cell.
        const label = namePart ? ((inst ? inst + ' · ' : '') + namePart) : null;
        return { ...r, cardLabel: label, cardInst: inst, cardNamePart: namePart };
      });
    }, []);

    function reload(cardList) {
      const list = cardList || cards;
      return CP_API.list()
        .then(recs => {
          const labeled = labelRecords(recs, list);
          setRecords(labeled);
          window.CREDIT_PAYMENTS_DATA.RECORDS = labeled;
          return labeled;
        })
        .catch(err => setLoadError(err.message));
    }

    // Hydrate cards first (for the picker + labels), then records.
    React.useEffect(() => {
      CP_API.creditCards()
        .then(cardList => { setCards(cardList); return reload(cardList); })
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
      const op = rec.id ? CP_API.update(rec.id, rec) : CP_API.create(rec);
      op.then(() => reload())
        .then(() => { setFormModal(null); setDetail(null); })
        .catch(err => setLoadError(err.message));
    }

    function handleDelete() {
      const target = del;
      CP_API.remove(target.id)
        .then(() => { setDel(null); setDetail(null); return reload(); })
        .catch(err => setLoadError(err.message));
    }

    // Mass delete — loops the per-row API (no bulk endpoint needed); keeps rows that
    // failed so the user sees exactly what remains, and never silently drops errors.
    function confirmBatchDelete() {
      const ids = records.filter(r => selected.has(r.id)).map(r => r.id);
      Promise.allSettled(ids.map(id => CP_API.remove(id)))
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

    return (
      <div className="app">
        <Sidebar active="credit-payments" />
        <div className="main">
          <header className="page-head">
            <div className="page-head-top">
              <div className="page-title-wrap cfg-detail-title-wrap">
                <span className="cfg-title-icon" id="page-header-icon" style={{ color: '#f97316' }}><Icon name="credit-card" size={21} /></span>
                <div className="cfg-title-col">
                  <h1 className="page-title">Credit Payments</h1>
                  <p className="page-subtitle">Credit-card statements & payments</p>
                </div>
              </div>
              <div className="head-actions">
                <button id="cp-add-btn" className="action-modal-btn ok" onClick={() => setFormModal({ mode: 'add', record: {} })}><Icon name="plus" size={14} />Add Credit Payment</button>
              </div>
            </div>
            <CreditPaymentFilterBar
              year={year} onYearStep={yearStep}
              cardFilter={cardFilter} setCardFilter={setCardFilter}
              search={search} setSearch={setSearch}
              cards={cards} />
          </header>

          <div className="cp-body">
            {loadError && <div className="cp-error" id="cp-load-error"><Icon name="alert-triangle" size={13} />{loadError}</div>}
            {selectedIds.length > 0 && (
              <div className="bulk-bar" id="cp-bulk-bar">
                <span className="bulk-count"><Icon name="check-square" size={14} />{selectedIds.length} selected</span>
                <div className="bulk-actions">
                  <button id="cp-bulk-clear-btn" className="list-btn blue" onClick={() => setSelected(new Set())}><Icon name="x" size={12} />Clear</button>
                  <button id="cp-bulk-delete-btn" className="list-btn red" onClick={() => setBatchDel(true)}><Icon name="trash-2" size={12} />Delete Selected</button>
                </div>
              </div>
            )}
            <CreditPaymentTable
              records={visible}
              onRowClick={setDetail}
              onEdit={(r) => setFormModal({ mode: 'edit', record: r })}
              onDelete={setDel}
              selectable selected={selected} onToggleSelect={toggleSelect}
              allSelected={allSelected} someSelected={someSelected} onToggleSelectAll={toggleSelectAll} />
          </div>
        </div>

        {detail && <CreditPaymentDetail record={detail}
          onClose={() => setDetail(null)} onEdit={openEdit} onDelete={openDeleteFromDetail}
          onChanged={refreshKeepingDetail} />}
        {formModal && <CreditPaymentFormModal initial={formModal.record} cards={cards}
          onClose={() => setFormModal(null)} onSave={handleSave} />}
        {del && <DeleteCreditPaymentConfirm record={del}
          onClose={() => setDel(null)} onConfirm={handleDelete} />}
        {batchDel && <DeleteCreditPaymentConfirm count={selectedIds.length}
          onClose={() => setBatchDel(false)} onConfirm={confirmBatchDelete} />}
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
