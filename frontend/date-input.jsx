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
// Every picker is dimensioned from #tx-modal-date-input (Add Spending): the
// <input> ALWAYS carries .field-input, and `className` is additive on top of
// it — it can never replace it. styles/datepicker.css pins the metrics with
// `.date-input-wrap > input.field-input`, which outranks a page's own cell
// class, so a date field cannot drift smaller/larger on one screen.
//
// The prop surface is the union of what the old copies accepted:
//   id, value ('YYYY-MM-DD'), onChange({target:{value}}), min, max,
//   className (EXTRA classes on the <input>, appended to .field-input),
//   wrapClassName (extra class on the wrapper), placeholder,
//   dataTable/dataCol (data-* attrs used by the Backup & Export and
//   Configuration table editors).
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

    // The calendar is ALWAYS CAL_W wide — the width it has under
    // #tx-modal-date-input, the app's reference picker — regardless of the
    // field it drops out of. It used to track the field width, which broke it
    // at both ends: the import wizard's 148px review cell and Backup & Export's
    // 150px range fields squeezed the 7 weekday labels together as
    // "SUMOITUEWEITHLFRISAT" and wrapped "July 2026" onto two lines, while the
    // Currencies config form's full-width 400px field stretched the day grid to
    // nearly double the reference. A date grid has one natural size; don't
    // rubber-band it to its trigger.
    const CAL_W = 232;
    function syncWidth(fp) {
      if (!fp.calendarContainer) return;
      fp.calendarContainer.style.width = CAL_W + 'px';
    }

    // Nearest enclosing modal. Container classes all END in "modal"
    // (.modal, .cp-modal, .acct-form-modal, .imp-modal, .cfg-modal…), while the
    // parts inside them do not (.modal-body, .modal-foot, .action-modal-btn) —
    // so an exact suffix test picks the shell and never a child of it.
    function closestModal(el) {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if ([...n.classList].some((c) => c.endsWith('modal'))) return n;
      }
      return null;
    }

    // Flip the calendar above the field when opening downward would push it out
    // through the bottom of its modal. flatpickr's own `position: 'auto'` only
    // flips at the VIEWPORT edge, so on a short modal (Add Credit Payment) the
    // popup had room on the page and happily spilled across the Cancel/Save
    // footer onto the page behind it.
    //
    // The test is "which side has more room", NOT "does it fit above" — a modal
    // can be shorter than the calendar in BOTH directions (Add Credit Payment
    // leaves 161px below the field and 267px above for a 294px calendar), and
    // demanding a clean fit meant such a modal never flipped at all, which is
    // exactly the case the flip is for. When neither side is better,
    // flatpickr's own placement stands.
    //
    // MUST run deferred (rAF), not inline in onOpen: flatpickr 4.x fires
    // onOpen BEFORE positionCalendar(), so writing .top during the event just
    // gets overwritten a moment later.
    function keepInsideModal(fp) {
      const cal = fp.calendarContainer;
      const wrap = wrapRef.current;
      if (!cal || !wrap) return;
      const modal = closestModal(wrap);
      if (!modal) return;
      const w = wrap.getBoundingClientRect();
      const m = modal.getBoundingClientRect();
      const h = cal.offsetHeight;
      const GAP = 2;
      const below = m.bottom - w.bottom;
      const above = w.top - m.top;
      if (below >= h || above <= below) return;
      cal.classList.remove('arrowTop');
      cal.classList.add('arrowBottom');
      // flatpickr positions with absolute page coordinates, so add the scroll.
      cal.style.top = (window.scrollY + w.top - h - GAP) + 'px';
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
        onOpen:  (_, __, fp) => {
          syncWidth(fp);
          requestAnimationFrame(() => { if (fp.isOpen) keepInsideModal(fp); });
        },
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
          className={['field-input'].concat(
            String(className || '').split(/\s+/).filter(c => c && c !== 'field-input'),
          ).join(' ')}
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
