// scan.jsx — Receipt OCR: on-device Tesseract + Claude structuring → pre-filled Add modal.
(function () {
  const Icon = window.Icon;
  const { CATS } = window.LEDGER;
  const today = () => new Date().toISOString().slice(0, 10);

  const CAT_KEYS = Object.keys(CATS);
  const CAT_HINTS = [
    [/migros|bim|a101|carrefour|sok|market|grocer|bakkal|manav/i, 'groceries'],
    [/restaurant|lokanta|cafe|kafe|coffee|kahve|pizza|burger|dining|restoran/i, 'dining'],
    [/uber|taxi|taksi|fuel|shell|opet|bp|petrol|metro|otobus|istanbulkart|benzin/i, 'transport'],
    [/pharmac|eczane|hastane|hospital|clinic|dent|saglik/i, 'health'],
    [/zara|mango|h&m|store|magaza|giyim|ikea|apple|electronic/i, 'shopping'],
    [/spotify|netflix|youtube|notion|figma|icloud|subscription|abonelik/i, 'subscriptions'],
    [/electric|enerji|water|iski|gas|dogalgaz|fatura|internet|turk telekom|fiber/i, 'utilities'],
    [/cinema|sinema|concert|konser|ticket|bilet|theatre|museum/i, 'entertainment'],
    [/hotel|otel|flight|ucus|pegasus|thy|airbnb|travel|seyahat/i, 'travel'],
  ];

  function naiveParse(text) {
    const t = text || '';
    // amount: pick the largest money-like figure (usually the total)
    const nums = (t.match(/\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2}/g) || [])
      .map(s => parseFloat(s.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')))
      .filter(n => !isNaN(n) && n > 0);
    const amount = nums.length ? Math.max(...nums) : 0;
    // currency
    let cur = 'TRY';
    if (/€|eur/i.test(t)) cur = 'EUR';
    else if (/\$|\busd\b/i.test(t)) cur = 'USD';
    else if (/₺|\btl\b|try|lira/i.test(t)) cur = 'TRY';
    // date
    let date = '';
    const dm = t.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (dm) {
      let [, d, mo, y] = dm;
      if (y.length === 2) y = '20' + y;
      date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    // description: first substantial line
    const line = (t.split(/\n/).map(s => s.trim()).find(s => s.length > 3 && /[a-zçğıöşü]/i.test(s)) || 'Receipt');
    const desc = line.replace(/\s+/g, ' ').slice(0, 40).replace(/\b\w/g, c => c.toUpperCase());
    // category
    let cat = 'shopping';
    for (const [re, k] of CAT_HINTS) { if (re.test(t)) { cat = k; break; } }
    return { date: date || today(), amt: amount, cur, desc, cat, type: 'expense', payingFor: 'Shared', payer: 'Sadun' };
  }

  async function claudeParse(text) {
    if (!window.claude || !window.claude.complete) throw new Error('no-claude');
    const prompt =
`You are a precise receipt parser. From the raw OCR text below, extract ONE transaction.
Return ONLY a JSON object (no markdown, no prose) with EXACTLY these keys:
- "date": ISO "YYYY-MM-DD". If the year is missing assume 2026. If no date is found use "".
- "amount": number — the FINAL total paid, digits only, no currency symbol or thousands separators.
- "cur": one of "TRY","USD","EUR". Infer: ₺/TL/lira→TRY, $→USD, €→EUR. Default "TRY".
- "desc": short merchant or purchase description in Title Case, max 40 chars.
- "cat": the single best-fit key from this list: ${CAT_KEYS.join(', ')}.
- "type": "income" or "expense" (a receipt is almost always "expense").

Raw OCR text:
"""
${(text || '').slice(0, 4000)}
"""`;
    const raw = await window.claude.complete(prompt);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no-json');
    const o = JSON.parse(m[0]);
    const cur = ['TRY', 'USD', 'EUR'].includes(o.cur) ? o.cur : 'TRY';
    const cat = CAT_KEYS.includes(o.cat) ? o.cat : 'shopping';
    const amt = parseFloat(o.amount) || 0;
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : today(),
      amt, cur,
      desc: (o.desc || 'Receipt').toString().slice(0, 40),
      cat,
      type: o.type === 'income' ? 'income' : 'expense',
      payingFor: 'Shared', payer: 'Sadun',
    };
  }

  function ScanModal({ onClose, onScanned }) {
    const [phase, setPhase] = React.useState('idle');   // idle | reading | analyzing | error
    const [progress, setProgress] = React.useState(0);
    const [imgUrl, setImgUrl] = React.useState(null);
    const [err, setErr] = React.useState('');
    const [drag, setDrag] = React.useState(false);
    const inputRef = React.useRef(null);

    React.useEffect(() => () => { if (imgUrl) URL.revokeObjectURL(imgUrl); }, [imgUrl]);

    async function handleFile(file) {
      if (!file || !file.type.startsWith('image/')) { setErr('Please choose an image file.'); setPhase('error'); return; }
      const url = URL.createObjectURL(file);
      setImgUrl(url); setErr(''); setProgress(0); setPhase('reading');
      try {
        if (!window.Tesseract) throw new Error('OCR engine failed to load. Check your connection and try again.');
        const worker = await window.Tesseract.createWorker('eng', 1, {
          logger: (m) => { if (m.status === 'recognizing text') setProgress(m.progress); },
        });
        const { data } = await worker.recognize(url);
        await worker.terminate();
        setProgress(1);
        setPhase('analyzing');
        let parsed;
        try { parsed = await claudeParse(data.text); }
        catch (e) { parsed = naiveParse(data.text); }
        onScanned(parsed);
      } catch (e) {
        setErr(e.message || 'Could not read that receipt.');
        setPhase('error');
      }
    }

    function onDrop(e) {
      e.preventDefault(); setDrag(false);
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    }
    const busy = phase === 'reading' || phase === 'analyzing';

    return (
      <div className="backdrop" onMouseDown={(e) => { if (e.target.classList.contains('backdrop') && !busy) onClose(); }}>
        <div className="modal scan-modal">
          <div className="modal-head">
            <div className="modal-head-l">
              <span className="modal-title"><Icon name="scan-line" size={16} />Scan Receipt</span>
              <span className="modal-sub">Pull the details from a photo</span>
            </div>
            <button id="scan-modal-close-btn" className="m-close" onClick={onClose} disabled={busy}><Icon name="x" size={17} /></button>
          </div>

          <div className="modal-body">
            {phase === 'idle' && (
              <React.Fragment>
                <div className={'dropzone' + (drag ? ' drag' : '')}
                  onClick={() => inputRef.current && inputRef.current.click()}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={onDrop}>
                  <span className="dz-ico"><Icon name="receipt-text" size={26} /></span>
                  <span className="dz-title">Drop a receipt image here</span>
                  <span className="dz-sub">or click to browse · JPG / PNG</span>
                </div>
                <div className="scan-note"><Icon name="cpu" size={13} />Text is read on-device, then structured into a transaction.</div>
                <input id="scan-file-input" ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => handleFile(e.target.files[0])} />
              </React.Fragment>
            )}

            {busy && (
              <React.Fragment>
                {imgUrl && <img className="scan-thumb" src={imgUrl} alt="Receipt" />}
                <div className="scan-status">
                  <span className="scan-spinner" />
                  <div className="scan-status-txt">
                    <span className="ss-title">{phase === 'reading' ? 'Reading receipt…' : 'Extracting details…'}</span>
                    <span className="ss-sub">{phase === 'reading' ? 'Running on-device OCR' : 'Structuring the text into fields'}</span>
                  </div>
                </div>
                <div className="prog-track"><div className="prog-fill" style={{ width: (phase === 'analyzing' ? 100 : Math.round(progress * 100)) + '%' }} /></div>
              </React.Fragment>
            )}

            {phase === 'error' && (
              <React.Fragment>
                <div className="scan-error"><Icon name="alert-triangle" size={18} /><span>{err}</span></div>
                <button id="scan-try-again-btn" className="amb ok" style={{ alignSelf: 'flex-start' }} onClick={() => { setPhase('idle'); setErr(''); }}><Icon name="rotate-cw" size={14} />Try Again</button>
              </React.Fragment>
            )}
          </div>

          <div className="modal-foot">
            <button id="scan-cancel-btn" className="amb cancel" onClick={onClose} disabled={busy}><Icon name="x" size={14} />Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  window.ScanModal = ScanModal;
})();
