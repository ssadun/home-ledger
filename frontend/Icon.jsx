// Icon.jsx — reliable Lucide wrapper for React.
// Each Icon manages its own SVG via a ref + innerHTML, so it survives
// React re-renders (no data-lucide reconciliation issues).
(function () {
  function toPascal(name) {
    return name.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  }

  function Icon({ name, size = 16, color = 'currentColor', strokeWidth = 2, style = {}, className = '', id = '' }) {
    const ref = React.useRef(null);
    React.useEffect(() => {
      const el = ref.current;
      if (!el || !window.lucide) return;
      el.innerHTML = '';
      const pascal = toPascal(name);
      const node = window.lucide[pascal] || (window.lucide.icons && window.lucide.icons[pascal]);
      try {
        if (node && window.lucide.createElement) {
          const svg = window.lucide.createElement(node);
          svg.setAttribute('width', size);
          svg.setAttribute('height', size);
          svg.setAttribute('stroke-width', strokeWidth);
          el.appendChild(svg);
        } else {
          // Fallback: data-lucide scan
          const i = document.createElement('i');
          i.setAttribute('data-lucide', name);
          el.appendChild(i);
          window.lucide.createIcons({ nameAttr: 'data-lucide', attrs: { width: size, height: size, 'stroke-width': strokeWidth } });
        }
      } catch (e) { /* noop */ }
    }, [name, size, strokeWidth]);

    // Static layout lives in the `.lc` CSS class; only keep genuinely dynamic
    // values inline (a non-default color, or a caller-supplied style override).
    const dynStyle = {
      ...(color && color !== 'currentColor' ? { color } : {}),
      ...style,
    };
    return React.createElement('span', {
      ref,
      id: id || undefined,
      className: 'lc ' + className,
      style: Object.keys(dynStyle).length ? dynStyle : undefined,
    });
  }

  window.Icon = Icon;

  // ── StyledSelect — drop-in replacement for native <select> ──────────────
  // Native <select> popups cannot be styled (the OS/browser draws them), so
  // there is no way to give the *expanded* list a themed border. This renders
  // a custom popup we fully control, matching the app's dark theme and the
  // calendar's bordered popup. It is a drop-in: keep the same props and the
  // same <option>/<optgroup> children, and onChange still receives an event
  // shaped like { target: { value } } exactly as a native <select> would.
  function ssLabel(children) {
    if (children == null || children === false) return '';
    if (typeof children === 'string' || typeof children === 'number') return String(children);
    if (Array.isArray(children)) return children.map(ssLabel).join('');
    return '';
  }

  function StyledSelect({ id, className, value, onChange, children, style, disabled, placeholder, title }) {
    const [open, setOpen] = React.useState(false);
    const [menu, setMenu] = React.useState(null);   // fixed-position box {left,width,top,bottom,up}
    const wrapRef = React.useRef(null);
    const btnRef = React.useRef(null);
    const menuRef = React.useRef(null);              // the portaled dropdown

    // Flatten <option>/<optgroup> children into a positional item list.
    const items = [];
    React.Children.forEach(children, (child) => {
      if (!child || !child.props) return;
      if (child.type === 'optgroup') {
        items.push({ group: ssLabel(child.props.label) });
        React.Children.forEach(child.props.children, (o) => {
          if (!o || !o.props) return;
          const v = o.props.value !== undefined ? String(o.props.value) : ssLabel(o.props.children);
          items.push({ value: v, label: ssLabel(o.props.children), disabled: !!o.props.disabled });
        });
      } else if (child.type === 'option') {
        const v = child.props.value !== undefined ? String(child.props.value) : ssLabel(child.props.children);
        items.push({ value: v, label: ssLabel(child.props.children), disabled: !!child.props.disabled });
      }
    });

    const cur = value == null ? '' : String(value);
    const selected = items.find(it => it.value !== undefined && it.value === cur);
    const displayLabel = selected ? selected.label : (placeholder || '');

    React.useEffect(() => {
      if (!open) return;
      const onDoc = (e) => {
        if (wrapRef.current && wrapRef.current.contains(e.target)) return;
        if (menuRef.current && menuRef.current.contains(e.target)) return;  // click inside portaled menu
        setOpen(false);
      };
      const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
      // The menu is position:fixed (so it escapes ancestor overflow clipping —
      // modal body, scrollable review list — instead of hiding behind sibling
      // rows). A fixed box can't follow a scroll, so close on any outer scroll/
      // resize — but NOT when the scroll happens inside the menu itself (the
      // category list is taller than max-height:260px and scrolls internally;
      // closing on that would make the dropdown vanish the moment you scroll it).
      // `resize` fires with e.target === window, which is not a Node — passing it
      // to contains() throws. Only a real Node can be "inside" the menu anyway.
      const onShift = (e) => {
        const t = e && e.target;
        if (t instanceof Node && menuRef.current &&
            (menuRef.current === t || menuRef.current.contains(t))) return;
        setOpen(false);
      };
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
      window.addEventListener('resize', onShift);
      window.addEventListener('scroll', onShift, true);
      return () => {
        document.removeEventListener('mousedown', onDoc);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', onShift);
        window.removeEventListener('scroll', onShift, true);
      };
    }, [open]);

    function toggle() {
      if (disabled) return;
      if (!open && btnRef.current) {
        // Anchor a position:fixed menu to the trigger's viewport rect. Being fixed,
        // it is clipped by nothing (no transform ancestor here — the modal's open
        // animation ends at transform:none), so it renders above the modal body /
        // scroll list / sibling rows. Flip up when there's more room above.
        const r = btnRef.current.getBoundingClientRect();
        const below = window.innerHeight - r.bottom;
        const up = below < 260 && r.top > below;
        setMenu({
          left: Math.round(r.left),
          width: Math.round(r.width),
          top: up ? 'auto' : Math.round(r.bottom + 4),
          bottom: up ? Math.round(window.innerHeight - r.top + 4) : 'auto',
          up,
        });
      }
      setOpen(o => !o);
    }
    function pick(it) {
      if (it.disabled || it.value === undefined) return;
      if (onChange) onChange({ target: { value: it.value } });
      setOpen(false);
    }

    return (
      <div ref={wrapRef} style={style}
        className={'ss-wrap ' + (className || '') + (open ? ' open' : '') + (disabled ? ' disabled' : '')}>
        <button type="button" id={id} ref={btnRef} disabled={disabled} title={title}
          className="ss-trigger" onClick={toggle}>
          <span className={'ss-value' + (selected ? '' : ' ss-placeholder')}>{displayLabel}</span>
          <Icon name="chevron-down" size={14} className="ss-chev" />
        </button>
        {open && menu && ReactDOM.createPortal(
          // Portaled to <body> so it escapes the modal's transform/backdrop-filter
          // containing block (which would otherwise clip this fixed menu inside the
          // modal / scrollable review list). z-index sits above the .backdrop (1000).
          <div ref={menuRef} className={'ss-dropdown' + (menu.up ? ' up' : '')} role="listbox"
            style={{ position: 'fixed', left: menu.left, width: menu.width, top: menu.top, bottom: menu.bottom, right: 'auto', zIndex: 100000 }}>
            {items.map((it, i) => it.group !== undefined
              ? <div key={'g' + i} className="ss-group-label">{it.group}</div>
              : <div key={i} role="option" aria-selected={it.value === cur}
                  id={id ? id + '-option-' + it.value : undefined}
                  className={'ss-option' + (it.value === cur ? ' selected' : '') + (it.disabled ? ' disabled' : '')}
                  onClick={() => pick(it)}>
                  <span className="ss-option-label">{it.label}</span>
                  {it.value === cur && <Icon name="check" size={12} className="ss-check" />}
                </div>
            )}
          </div>, document.body)}
      </div>
    );
  }

  window.StyledSelect = StyledSelect;
})();
