// credit-payments-app.jsx — Home Ledger Credit Payments page.
(function () {
  const Icon = window.Icon;
  const { Sidebar } = window.HL_NAV;
  const CP_API = window.HL_CREDIT_PAYMENTS_API;
  const { CreditPaymentTable, CreditPaymentFormModal, CreditPaymentDetail, DeleteCreditPaymentConfirm } = window;

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

    // Attach a human card label to each record from the loaded cards.
    const labelRecords = React.useCallback((recs, cardList) => {
      const byId = {};
      cardList.forEach(c => { byId[c._dbId] = c; byId[c.id] = c; });
      return recs.map(r => {
        const c = byId[r.accountId] || byId[r.accountKey];
        const label = c ? (c.name + (c.number && c.number !== '–' ? ' ' + c.number : '')) : null;
        return { ...r, cardLabel: label };
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

    // Select-all — no pagination on this page, so it spans every loaded record.
    const selectedIds = records.filter(r => selected.has(r.id)).map(r => r.id);
    const allSelected = records.length > 0 && selectedIds.length === records.length;
    const someSelected = selectedIds.length > 0 && !allSelected;
    const toggleSelectAll = () => setSelected(s => {
      if (allSelected) return new Set();
      return new Set(records.map(r => r.id));
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
              records={records}
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
