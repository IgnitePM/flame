/**
 * Shared Gemini model fallbacks (Sep 2026+).
 * Prefer GEMINI_MODEL env, then current Flash / Flash-Lite IDs.
 * Avoid shut-down 1.5 / 2.0 IDs that still linger in older defaults.
 */

export function geminiModelCandidates(preferred) {
  const fromEnv = String(preferred || process.env.GEMINI_MODEL || '').trim();
  return Array.from(
    new Set(
      [
        fromEnv,
        'gemini-flash-latest',
        'gemini-3.5-flash',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
      ].filter(Boolean),
    ),
  );
}

/** True when we should try the next model id instead of failing hard. */
export function shouldTryNextGeminiModel(errorMessage) {
  const msg = String(errorMessage || '').toLowerCase();
  return (
    msg.includes('not found') ||
    msg.includes('not supported') ||
    msg.includes('unsupported') ||
    msg.includes('no longer available') ||
    msg.includes('deprecated') ||
    msg.includes('not available') ||
    msg.includes('invalid model') ||
    msg.includes('is not enabled')
  );
}

/**
 * Generation config that works for JSON tasks on thinking-capable Flash models.
 * thinkingBudget 0 avoids burning the whole output budget on hidden reasoning.
 */
export function geminiJsonGenerationConfig(overrides = {}) {
  return {
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingBudget: 0 },
    ...overrides,
  };
}

export function collectGeminiText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const bits = [];
  for (const cand of candidates) {
    const parts = cand?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (typeof p === 'string' && p.trim()) bits.push(p.trim());
      else if (typeof p?.text === 'string' && p.text.trim()) bits.push(p.text.trim());
    }
  }
  return bits.join('\n').trim();
}
