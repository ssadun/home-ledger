// account-holdings.jsx — Holdings panel shown inside an "invest"-type account's
// detail on the Accounts page. Lists the account's Investment records (matched by
// platform == account name), with add / edit / delete. Records are also created by
// the Midas portfolio import.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const DateInput = window.DateInput;
  const { FX } = window.LEDGER;
  const { ASSET_TYPES, EXCHANGES, costBasisOf } = window.INVESTMENTS_DATA;

  // Defined locally (the Accounts page does not load components.jsx/LEDGER_FMT),
  // matching accounts-components.jsx.
  function grp(v, dec = 2) { return Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
  const SYM = { TRY: '₺', USD: '$', EUR: '€' };

  const typeMeta = (k) => ASSET_TYPES[k] || ASSET_TYPES.stock;
  const exchangeMeta = (k) => EXCHANGES[k] || EXCHANGES.OTHER || { label: k || 'Other', icon: 'layers' };
  const fmtQty = (q) => { const n = Number(q) || 0; return Number.isInteger(n) ? n.toLocaleString('en-US') : grp(n, 4); };

  function parseCurrencyInput(raw, currency) {
    if (!raw) return '';
    const cleaned = currency === 'TRY' ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? '' : String(num);
  }

  function fmtCurrency(value, currency) {
    if (!value && value !== 0) return '';
    const num = parseFloat(value);
    if (isNaN(num)) return '';
    return currency === 'TRY'
      ? num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function CurrencyInput({ id, value, currency, onChange, placeholder = '-' }) {
    const [focused, setFocused] = React.useState(false);
    const [raw, setRaw] = React.useState(value || '');
    React.useEffect(() => { if (!focused) setRaw(value || ''); }, [value, focused]);
    function handleFocus() { setFocused(true); setRaw(value || ''); }
    function handleChange(e) { setRaw(e.target.value); onChange(parseCurrencyInput(e.target.value, currency)); }
    function handleBlur() {
      setFocused(false);
      const parsed = parseCurrencyInput(raw, currency);
      setRaw(parsed);
      onChange(parsed);
    }
    return (
      <input id={id} type="text" inputMode="decimal" className="field-input" placeholder={placeholder}
        value={focused ? raw : fmtCurrency(value, currency)}
        onFocus={handleFocus} onChange={handleChange} onBlur={handleBlur} />
    );
  }

  function TypeBadge({ type }) {
    const m = typeMeta(type);
    return <span className="inv-type-badge" style={{ '--t': m.color }}><Icon name={m.icon} size={11} />{m.label}</span>;
  }

  // ── Add / edit holding modal ──────────────────────────────────────────
  function HoldingModal({ initial, platform, defaultType = 'stock', onClose, onSave }) {
    const editing = !!initial.id;
    const [f, setF] = React.useState({
      name: initial.name || '',
      assetType: initial.assetType || defaultType,
      cur: initial.cur || 'TRY',
      qty: initial.qty != null ? String(initial.qty) : '',
      price: initial.price != null ? String(initial.price) : '',
      currentPrice: initial.currentPrice != null ? String(initial.currentPrice) : '',
      priceAsOf: initial.priceAsOf || '',
      priceSource: initial.priceSource || '',
      note: initial.note || '',
    });
    const set = (k, v) => setF(p => ({ ...p, [k]: v }));
    const qtyNum = parseFloat(f.qty) || 0;
    const priceNum = f.price === '' ? null : (parseFloat(f.price) || 0);
    const basis = +costBasisOf(qtyNum, priceNum).toFixed(2);
    const tryV = +(basis * FX[f.cur].toTRY).toFixed(2);

    function submit() {
      if (!f.name.trim() || !qtyNum) return;
      onSave({
        ...initial,
        name: f.name.trim(),
        platform,
        assetType: f.assetType,
        cur: f.cur,
        qty: qtyNum,
        price: priceNum,
        currentPrice: f.currentPrice === '' ? null : (parseFloat(f.currentPrice) || 0),
        priceAsOf: f.priceAsOf || '',
        priceSource: f.priceSource || '',
        note: f.note.trim(),
      });
    }

    return (
      <div className="backdrop" onMouseDown={(e) => { if (e.target.classList.contains('backdrop')) onClose(); }}>
        <div className="modal inv-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name={editing ? 'pencil' : 'plus-circle'} size={16} />{editing ? 'Edit Holding' : 'Add Holding'}</span>
              <span className="modal-sub">{platform} · {editing ? initial.name : 'New position'}</span>
            </div>
            <button id="hold-modal-close-btn" className="m-close" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>

          <div className="modal-body">
            <div className="form-field">
              <span className="field-label">Name / Symbol</span>
              <input id="hold-modal-name-input" className="field-input" placeholder="e.g. ALTIN.S1, THYAO, BTC" value={f.name} onChange={e => set('name', e.target.value)} />
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Asset Type</span>
                <StyledSelect id="hold-modal-type-select" className="field-input" value={f.assetType} onChange={e => set('assetType', e.target.value)} disabled={editing}>
                  {Object.keys(ASSET_TYPES).map(k => <option key={k} value={k}>{ASSET_TYPES[k].label}</option>)}
                </StyledSelect>
              </div>
              <div className="form-field">
                <span className="field-label">Currency</span>
                <StyledSelect id="hold-modal-currency-select" className="field-input" value={f.cur} onChange={e => set('cur', e.target.value)} disabled={editing}>
                  {Object.keys(FX).map(c => <option key={c} value={c}>{c}</option>)}
                </StyledSelect>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Quantity</span>
                <input id="hold-modal-qty-input" type="number" step="any" className="field-input" placeholder="0" value={f.qty} onChange={e => set('qty', e.target.value)} />
              </div>
              <div className="form-field">
                <span className="field-label">Avg Cost / Unit <span className="field-opt">(optional)</span></span>
                <CurrencyInput id="hold-modal-price-input" value={f.price} currency={f.cur} onChange={v => set('price', v)} />
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Current Price <span className="field-opt">(optional)</span></span>
                <CurrencyInput id="hold-modal-current-price-input" value={f.currentPrice} currency={f.cur} onChange={v => set('currentPrice', v)} />
              </div>
              <div className="form-field">
                <span className="field-label">Price Date <span className="field-opt">(optional)</span></span>
                <DateInput id="hold-modal-price-date-input" className="field-input" value={f.priceAsOf} onChange={e => set('priceAsOf', e.target.value)} />
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Note <span className="field-opt">(optional)</span></span>
                <input id="hold-modal-note-input" className="field-input" placeholder="Anything worth remembering" value={f.note} onChange={e => set('note', e.target.value)} />
              </div>
              <div className="form-field">
                <span className="field-label">Price Source <span className="field-opt">(optional)</span></span>
                <StyledSelect id="hold-modal-price-source-select" className="field-input" value={f.priceSource} onChange={e => set('priceSource', e.target.value)}>
                  <option value="">- Not Set -</option>
                  <option value="manual">Manual</option>
                  <option value="market_price">Market Price</option>
                  <option value="integration">Integration</option>
                  <option value="import">Import</option>
                </StyledSelect>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <span className="field-label">Cost Basis</span>
                <div className="inv-basis-preview" id="hold-modal-basis-preview">
                  <span className="mono">{SYM[f.cur]}{grp(basis)}</span>
                  {f.cur !== 'TRY' && <span className="inv-basis-try">≈ ₺{grp(tryV)}</span>}
                </div>
              </div>
            </div>
            {editing && <span className="inv-edit-hint"><Icon name="info" size={11} />Asset type &amp; currency are fixed after creation.</span>}
          </div>

          <div className="modal-foot">
            <button id="hold-modal-cancel-btn" className="amb cancel" onClick={onClose}><Icon name="x" size={14} />Cancel</button>
            <button id="hold-modal-save-btn" className="amb ok" disabled={!f.name.trim() || !qtyNum} onClick={submit}><Icon name="save" size={14} />{editing ? 'Save' : 'Add Holding'}</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Holdings panel (rendered inside AccountDetail for invest accounts) ──
  function AccountHoldings({ account }) {
    const platform = account.name;
    // A retirement plan holds the same Investment rows, but they are emeklilik
    // funds valued in TRY rather than priced positions — so the panel reads
    // "Funds"/"Total Value" and shows each fund's share of the plan instead of a
    // quantity × unit-cost line.
    const isPension = account.type === 'pension';
    // The statement's own printed share per fund. Preferred over deriving
    // value ÷ total, because a participant fund's percentage is of "Birikiminiz"
    // while the devlet katkısı fund's is of its own pool — dividing by the plan
    // total would show 34,48% where the statement prints 40,17%. Funds added by
    // hand aren't in here and fall back to the derived share.
    const allocation = (account.pension || {}).allocation || {};
    const stateFunds = (account.pension || {}).state_funds || [];
    const [holdings, setHoldings] = React.useState(null);   // null = loading
    const [error, setError] = React.useState(null);
    const [modal, setModal] = React.useState(null);         // { holding } or {}
    const [del, setDel] = React.useState(null);
    const [flashId, setFlashId] = React.useState(null);

    const reload = React.useCallback(() => {
      window.HL_INVESTMENTS_API.listForAccount(account)
        .then(setHoldings)
        .catch(e => { setError(e.message || 'Could not load holdings.'); setHoldings([]); });
    }, [platform, account._dbId]);
    React.useEffect(() => { reload(); }, [reload]);

    async function save(h) {
      const editing = !!h.id;
      try {
        const saved = await window.HL_OP_NOTIFY.promise(
          editing ? window.HL_INVESTMENTS_API.update(h.id, h) : window.HL_INVESTMENTS_API.create(h),
          {
            pending: editing ? 'Updating holding...' : 'Saving holding...',
            success: editing ? 'Holding updated.' : 'Holding saved.',
            error: false,
          }
        );
        setHoldings(prev => {
          const arr = prev || [];
          return h.id ? arr.map(x => x.id === saved.id ? saved : x) : [saved, ...arr];
        });
        setFlashId(saved.id);
        setModal(null);
        setTimeout(() => setFlashId(null), 1500);
      } catch (e) {
        const msg = e.message || 'Could not save holding.';
        setError(msg);
        window.HL_OP_NOTIFY.show((editing ? 'Could not update holding: ' : 'Could not save holding: ') + msg, { type: 'error', timeout: 4200 });
      }
    }
    async function confirmDelete() {
      const id = del.id;
      try {
        await window.HL_OP_NOTIFY.promise(window.HL_INVESTMENTS_API.remove(id), { pending: 'Deleting holding...', success: 'Holding deleted.', error: false });
        setHoldings(prev => (prev || []).filter(x => x.id !== id));
        setDel(null);
      } catch (e) {
        const msg = e.message || 'Could not delete holding.';
        setError(msg);
        window.HL_OP_NOTIFY.show('Could not delete holding: ' + msg, { type: 'error', timeout: 4200 });
      }
    }

    // Holding add/edit/delete dialogs are portaled to <body> so they overlay the
    // whole viewport rather than nesting inside the account-detail modal. While one
    // is open, hide the detail modal beneath it (via a body class) so it doesn't
    // frame the dialog. Mirrors the app's "one modal at a time" convention.
    const subOpen = !!(modal || del);
    React.useEffect(() => {
      document.body.classList.toggle('hl-holding-dialog', subOpen);
      return () => document.body.classList.remove('hl-holding-dialog');
    }, [subOpen]);

    const loading = holdings === null;
    const rows = holdings || [];
    const totalTry = rows.reduce((s, r) => s + (r.tryValue || 0), 0);
    const exchangeGroups = React.useMemo(() => {
      const order = ['BIST', 'TEFAS', 'NASDAQ', 'EUR', 'OTHER'];
      const map = new Map();
      rows.forEach(row => {
        const key = row.exchange || 'OTHER';
        if (!map.has(key)) map.set(key, { key, rows: [], totalTry: 0 });
        const group = map.get(key);
        group.rows.push(row);
        group.totalTry += row.tryValue || 0;
      });
      return Array.from(map.values()).sort((a, b) => {
        const ai = order.indexOf(a.key), bi = order.indexOf(b.key);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
    }, [rows]);

    function pensionShare(h) {
      const pct = allocation[h.name];
      if (pct != null) return grp(pct) + '%';
      if (!totalTry) return '-';
      return grp(h.tryValue / totalTry * 100) + '%';
    }

    return (
      <div className="acct-holdings">
        <div className="detail-section-label acct-holdings-head">
          <span><Icon name={isPension ? 'layers' : 'trending-up'} size={12} />{isPension ? 'Funds' : 'Holdings'}{rows.length ? ' · ' + rows.length : ''}</span>
          <button id="acct-holdings-add-btn" className="list-btn blue" onClick={() => setModal({})}><Icon name="plus" size={12} />{isPension ? 'Add Fund' : 'Add Holding'}</button>
        </div>

        {error && <div className="acct-holdings-error"><Icon name="alert-triangle" size={13} />{error}</div>}

        {loading ? (
          <div className="detail-empty"><Icon name="loader" size={22} /><span>Loading holdings…</span></div>
        ) : rows.length === 0 ? (
          <div className="detail-empty">
            <Icon name={isPension ? 'layers' : 'trending-up'} size={26} />
            <span>{isPension
              ? 'No funds yet. Add one, or import a BES Birikim Özeti statement.'
              : 'No holdings yet. Add one, or import a Midas portfolio statement.'}</span>
          </div>
        ) : (
          <React.Fragment>
            {isPension && (
              <div className="acct-holdings-total">
                <span className="ah-total-k">Total Value</span>
                <span className="ah-total-v">₺{grp(totalTry)}</span>
              </div>
            )}
            <div className="acct-holdings-list">
              {exchangeGroups.map(group => {
                const xm = exchangeMeta(group.key);
                return (
                  <div className="ah-exchange-group" key={group.key}>
                    {!isPension && (
                      <div className="ah-exchange-head">
                        <span><Icon name={xm.icon} size={12} />{xm.label}</span>
                        <span>{group.rows.length} · ₺{grp(group.totalTry, 0)}</span>
                      </div>
                    )}
                    {group.rows.map(h => (
                      <div className={'ah-row' + (h.id === flashId ? ' row-flash' : '')} key={h.id} id={'ah-row-' + h.id}>
                        <span className="ah-ico cat-chip" style={{ '--cat': typeMeta(h.assetType).color }}><Icon name={typeMeta(h.assetType).icon} size={14} /></span>
                        <div className="ah-main">
                          <span className="ah-name">{h.name}</span>
                          <span className="ah-sub"><TypeBadge type={h.assetType} /><span className="inv-cur-chip">{h.cur}</span>{!isPension && <span className="inv-cur-chip">{exchangeMeta(h.exchange).label}</span>}</span>
                        </div>
                        <div className="ah-metrics">
                          <span className="ah-qty mono" title={isPension && stateFunds.includes(h.name) ? 'Share of your state contribution' : isPension ? 'Share of your savings' : undefined}>{isPension
                            ? pensionShare(h)
                            : fmtQty(h.qty) + (h.price != null ? ' × ' + SYM[h.cur] + grp(h.price) : '')}</span>
                          <span className="ah-basis mono">{SYM[h.cur]}{grp(h.marketValue != null ? h.marketValue : h.costBasis)}</span>
                        </div>
                        <div className="ah-actions">
                          <button id={'ah-edit-' + h.id} className="ah-btn" title="Edit holding" onClick={() => setModal({ holding: h })}><Icon name="pencil" size={13} /></button>
                          <button id={'ah-del-' + h.id} className="ah-btn danger" title="Delete holding" onClick={() => setDel(h)}><Icon name="trash-2" size={13} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </React.Fragment>
        )}

        {subOpen && ReactDOM.createPortal(
          <React.Fragment>
            {modal && <HoldingModal initial={modal.holding || {}} platform={platform}
              defaultType={isPension ? 'fund' : 'stock'} onClose={() => setModal(null)} onSave={save} />}
            {del && window.DeleteConfirm && <window.DeleteConfirm tx={del} onClose={() => setDel(null)} onConfirm={confirmDelete} />}
          </React.Fragment>,
          document.body
        )}
      </div>
    );
  }

  window.AccountHoldings = AccountHoldings;
  window.InvTypeBadge = TypeBadge;
})();
