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
})();
