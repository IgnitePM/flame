/**
 * Post a message to a client's Slack channel webhook (if configured).
 * Falls back to the workspace-wide settings/notifications webhook when
 * `alsoGlobal` is true and the client has no webhook of its own.
 */

import { fetchDoc, getDigestDb } from './firebaseDigestClient.mjs';

async function postWebhook(url, text) {
  const webhook = String(url || '').trim();
  if (!webhook) return { ok: false, reason: 'no_webhook' };
  const resp = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Slack ${resp.status}: ${body.slice(0, 200)}`);
  }
  return { ok: true };
}

export async function notifyClientSlack({
  clientId,
  text,
  alsoGlobal = false,
} = {}) {
  const message = String(text || '').trim();
  if (!message) return { ok: false, reason: 'empty' };

  const db = await getDigestDb();
  const client = clientId ? await fetchDoc(db, `clients/${clientId}`) : null;
  const clientHook = String(client?.slackWebhookUrl || '').trim();
  const results = { client: null, global: null };

  if (clientHook) {
    results.client = await postWebhook(clientHook, message);
  }

  if (alsoGlobal || !clientHook) {
    const settings = (await fetchDoc(db, 'settings/notifications')) || {};
    const globalHook = String(settings.slackWebhookUrl || '').trim();
    if (globalHook && globalHook !== clientHook) {
      results.global = await postWebhook(globalHook, message);
    }
  }

  return {
    ok: !!(results.client?.ok || results.global?.ok),
    clientName: client?.name || '',
    results,
  };
}
