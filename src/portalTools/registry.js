import CustomerJourneyBuilder from './customerJourney/CustomerJourneyBuilder.jsx';

/**
 * Portal mini-app registry.
 *
 * Each tool:
 *   {
 *     id: string,                 // stable key used for Firestore saves
 *     title: string,
 *     description: string,
 *     component: React component   // { client, user, save, load, savedData, saving }
 *     fullBleed?: boolean          // skip outer card chrome for immersive tools
 *     enabled?: boolean            // default true
 *   }
 */

export const PORTAL_TOOLS = [
  {
    id: 'customer_journey_builder',
    title: 'Customer Journey Builder',
    description:
      'Build a StoryBrand-style journey with AI copy, sound bites, deliverables, and a landing-page audit — saved to your portal.',
    component: CustomerJourneyBuilder,
    fullBleed: true,
  },
];

export function listEnabledPortalTools() {
  return (PORTAL_TOOLS || []).filter((t) => t && t.enabled !== false && t.component);
}

export function getPortalTool(toolId) {
  return listEnabledPortalTools().find((t) => t.id === toolId) || null;
}

export function portalToolSaveDocId(clientId, toolId, saveKey = 'default') {
  const c = String(clientId || '').trim();
  const t = String(toolId || '').trim();
  const k = String(saveKey || 'default')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .slice(0, 80);
  return `${c}__${t}__${k || 'default'}`;
}
