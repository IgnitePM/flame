import { authedFetch } from '../../utils/authedFetch.js';

async function postJourneyAi(clientId, payload) {
  const resp = await authedFetch('/.netlify/functions/portal-journey-ai', {
    clientId,
    ...payload,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || `Request failed (${resp.status})`);
  }
  return data;
}

export async function generateStepContent(clientId, { stepTitle, businessType, inputs }) {
  return postJourneyAi(clientId, {
    action: 'step',
    stepTitle,
    businessType,
    inputs,
  });
}

export async function generateFinalDeliverables(clientId, sections) {
  return postJourneyAi(clientId, {
    action: 'final',
    sections,
  });
}

export async function generateWebsiteAudit(clientId, { framework, url }) {
  return postJourneyAi(clientId, {
    action: 'audit',
    framework,
    url,
  });
}

export async function generateTargetPortrait(clientId, payload) {
  return postJourneyAi(clientId, {
    action: 'portrait',
    ...payload,
  });
}

/** Drop large data-URL portraits so Firestore docs stay under size limits. */
export function sanitizeJourneyStateForSave(state) {
  if (!state || typeof state !== 'object') return state;
  try {
    const clone = JSON.parse(JSON.stringify(state));
    const img = clone?.data?.target?.output?.imageUrl;
    if (typeof img === 'string' && img.startsWith('data:')) {
      delete clone.data.target.output.imageUrl;
    }
    return clone;
  } catch {
    return state;
  }
}
