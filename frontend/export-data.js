// export-data.js — Home Ledger shared CSV export helper.
// Plain JS (load with a normal <script>, before the babel components).
// Exposes window.HL_EXPORT: { toCSV, download, exportCSV }.
(function () {
  // Normalize any cell value to a printable string.
  function fmt(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  }

  // RFC-4180 escaping: wrap in quotes when the value contains a comma,
  // quote, or newline; double any embedded quotes.
  function esc(value) {
    const s = fmt(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // rows: array of records. columns: [{ key, label, get? }].
  // get(row) overrides the default row[key] lookup (for derived/looked-up values).
  function toCSV(rows, columns) {
    const header = columns.map(c => esc(c.label)).join(',');
    const body = rows.map(r =>
      columns.map(c => esc(c.get ? c.get(r) : r[c.key])).join(',')
    );
    return [header].concat(body).join('\r\n');
  }

  // Trigger a client-side download. A UTF-8 BOM is prepended so Excel reads
  // Turkish characters (İ, ş) and the ₺ symbol correctly.
  function download(filename, text) {
    const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportCSV(filename, rows, columns) {
    download(filename, toCSV(rows, columns));
  }

  window.HL_EXPORT = { toCSV, download, exportCSV };
})();
