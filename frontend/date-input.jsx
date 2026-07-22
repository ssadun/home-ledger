// date-input.jsx — SINGLE SOURCE OF TRUTH for date picking across Home Ledger.
// ─────────────────────────────────────────────────────────────────────────────
// A flatpickr wrapper styled for the dark theme. Every date field in the app
// renders through this component — there is exactly one implementation.
//
//     <DateInput id="tx-modal-date-input" className="field-input"
//                value={f.date} onChange={(e) => set('date', e.target.value)} />
//
// This used to be copy-pasted into controls.jsx, config-app.jsx,
// backup-export-app.jsx and import.jsx (four near-identical copies, each with
// its own guarded copy of HL_enhanceFpYear) — so a fix to the picker had to be
// made four times and pages that never got a copy, like Accounts, silently fell
// back to a raw <input type="date"> with the browser's light-theme picker.
// Those four now alias this file; do NOT reintroduce a local copy.
//
// The prop surface is the union of what the old copies accepted:
//   id, value ('YYYY-MM-DD'), onChange({target:{value}}), min, max,
//   className (on the <input>), wrapClassName (extra class on the wrapper),
//   placeholder, dataTable/dataCol (data-* attrs used by the Backup & Export
//   and Configuration table editors).
//
// Requires flatpickr (CDN <script> + flatpickr.min.css + styles/datepicker.css)
// and Icon.jsx to be loaded first.
(function () {
  // Replaces flatpickr's tiny year spinner with a real dropdown, so picking a
  // birth year or a 2019 statement doesn't mean 80 clicks on the arrow.
  if (!window.HL_enhanceFpYear) {
    window.HL_enhanceFpYear = function (fp) {
      const head = fp.calendarContainer &&
        fp.calendarContainer.querySelector('.flatpickr-current-month');
      const numWrap = head && head.querySelector('.numInputWrapper');
      if (!numWrap || numWrap.dataset.hlYear) return;
      const today = new Date();
      const minYear = fp.config.minDate ? fp.config.minDate.getFullYear() : today.getFullYear() - 80;
      let maxYear = fp.config.maxDate ? fp.config.maxDate.getFullYear() : today.getFullYear() + 10;
      if (maxYear < minYear) maxYear = minYear;
      const sel = document.createElement('select');
      sel.className = 'flatpickr-yearDropdown-years';
      sel.setAttribute('aria-label', 'Year');
      for (let y = maxYear; y >= minYear; y--) {
        const o = document.createElement('option');
        o.value = String(y);
        o.textContent = String(y);
        sel.appendChild(o);
      }
      sel.value = String(fp.currentYear);
      sel.addEventListener('change', (e) => fp.changeYear(parseInt(e.target.value, 10)));
      numWrap.dataset.hlYear = '1';
      numWrap.style.display = 'none';
      numWrap.parentNode.insertBefore(sel, numWrap.nextSibling);
      fp._hlYearSelect = sel;
    };
  }

  function DateInput({ value, onChange, min, max, className, wrapClassName, placeholder, dataTable, dataCol, id }) {
    // Read Icon at render time, not load time — this file is loaded early and
    // must not capture an Icon that isn't defined yet.
    const Icon = window.Icon;
    const inputRef = React.useRef(null);
    const wrapRef  = React.useRef(null);
    const fpRef    = React.useRef(null);

    // Match the calendar's width to the field it drops out of.
    function syncWidth(fp) {
      if (!wrapRef.current || !fp.calendarContainer) return;
      const w = wrapRef.current.getBoundingClientRect().width;
      if (w > 0) fp.calendarContainer.style.width = w + 'px';
    }

    React.useEffect(() => {
      if (!inputRef.current || typeof flatpickr === 'undefined') return;
      fpRef.current = flatpickr(inputRef.current, {
        dateFormat:    'Y-m-d',
        defaultDate:   value || null,
        minDate:       min   || null,
        maxDate:       max   || null,
        disableMobile: true,
        monthSelectorType: 'dropdown',
        onReady: (_, __, fp) => { syncWidth(fp); window.HL_enhanceFpYear(fp); },
        onOpen:  (_, __, fp) => syncWidth(fp),
        onYearChange: (_, __, fp) => { if (fp._hlYearSelect) fp._hlYearSelect.value = String(fp.currentYear); },
        onChange: (_, dateStr) => onChange({ target: { value: dateStr } }),
      });
      return () => { if (fpRef.current) { fpRef.current.destroy(); fpRef.current = null; } };
    }, []); // eslint-disable-line

    React.useEffect(() => {
      if (!fpRef.current) return;
      const cur = fpRef.current.selectedDates[0]
        ? fpRef.current.formatDate(fpRef.current.selectedDates[0], 'Y-m-d') : '';
      if (value !== cur) fpRef.current.setDate(value || null, false);
    }, [value]);

    React.useEffect(() => { if (fpRef.current) fpRef.current.set('minDate', min || null); }, [min]);
    React.useEffect(() => { if (fpRef.current) fpRef.current.set('maxDate', max || null); }, [max]);

    return (
      <div ref={wrapRef} className={'date-input-wrap' + (wrapClassName ? ' ' + wrapClassName : '')}>
        <input
          id={id}
          ref={inputRef}
          type="text"
          className={className || 'field-input'}
          placeholder={placeholder || 'YYYY-MM-DD'}
          data-table={dataTable}
          data-col={dataCol}
          readOnly
        />
        <span className="date-input-icon"><Icon name="calendar" size={14} /></span>
      </div>
    );
  }

  window.DateInput = DateInput;
})();
