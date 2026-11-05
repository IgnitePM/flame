import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeClientSummary, stripSecretFields } from './mcpSanitize.mjs';

describe('stripSecretFields', () => {
  it('removes token/secret-like keys', () => {
    const cleaned = stripSecretFields({
      name: 'Acme',
      apiKey: 'nope',
      refreshToken: 'nope',
      nested: { access_token: 'x', ok: 1 },
    });
    assert.equal(cleaned.name, 'Acme');
    assert.equal(cleaned.apiKey, undefined);
    assert.equal(cleaned.refreshToken, undefined);
    assert.equal(cleaned.nested.access_token, undefined);
    assert.equal(cleaned.nested.ok, 1);
  });
});

describe('sanitizeClientSummary', () => {
  it('returns allowlisted fields only', () => {
    const summary = sanitizeClientSummary({
      id: 'c1',
      name: 'Twin Peaks',
      status: 'active',
      website: 'https://example.com',
      retainers: { SEO: 10, 'Social Media': 5 },
      clientEmails: ['a@co.com'],
      primaryContact: { name: 'Pat', email: 'pat@co.com' },
      slackWebhookUrl: 'https://hooks.slack.com/secret',
      todoCycles: {
        '1': {
          seo: { items: [{ id: 't1', text: 'Blog', done: false }] },
        },
      },
    });
    assert.equal(summary.id, 'c1');
    assert.equal(summary.name, 'Twin Peaks');
    assert.equal(summary.openTodoCount, 1);
    assert.deepEqual(summary.portalEmails, ['a@co.com']);
    assert.equal(summary.slackWebhookUrl, undefined);
    assert.equal(summary.todoCycles, undefined);
    assert.equal(summary.retainers.length, 2);
  });
});
