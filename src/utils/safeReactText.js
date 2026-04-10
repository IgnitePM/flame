/** Avoid React child errors when Firestore stored a map/object in a text field. */
export function safeDisplayForReact(v) {
  if (v == null) return '';
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return String(v);
  if (t === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return '[Invalid value]';
    }
  }
  return String(v);
}
