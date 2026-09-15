/**
 * Portal mini-app registry.
 *
 * Each tool:
 *   {
 *     id: string,                 // stable key used for Firestore saves
 *     title: string,
 *     description: string,
 *     icon?: LucideIcon name key (optional; panel has a default)
 *     component: React component   // receives { client, user, save, load, savedData, saving }
 *     enabled?: boolean            // default true
 *   }
 *
 * Add Customer Journey Builder (and others) here when you provide the code.
 */

export const PORTAL_TOOLS = [
  // Example shape for the next mini-app:
  // {
  //   id: 'customer_journey_builder',
  //   title: 'Customer Journey Builder',
  //   description: 'Map and save your customer journey.',
  //   component: CustomerJourneyBuilder,
  // },
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
