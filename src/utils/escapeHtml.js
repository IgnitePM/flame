/**
 * Escape a value for interpolation into a print-window HTML template.
 * The PDF exports build markup as strings and hand it to document.write(), so
 * Firestore-sourced text (client names, task notes, descriptions) must be
 * escaped or it executes in the popup on our own origin.
 */
export function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
