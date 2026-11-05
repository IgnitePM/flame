import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStaffTodoItem,
  mergeNoteText,
  normalizeAssigneeEmails,
  parseDueDateMs,
  resolveMcpActorEmail,
  resolveRetainerCategory,
  todoCategoryKey,
} from './mcpClientWriteUtils.mjs';

describe('todoCategoryKey', () => {
  it('sanitizes Firestore-hostile characters', () => {
    assert.equal(todoCategoryKey('SEO/Web'), 'SEO_Web');
    assert.equal(todoCategoryKey('A.B'), 'A_B');
  });
});

describe('mergeNoteText', () => {
  it('appends by default', () => {
    assert.equal(mergeNoteText('Old', 'New'), 'Old\n\nNew');
  });

  it('replaces when requested', () => {
    assert.equal(mergeNoteText('Old', 'New', 'replace'), 'New');
  });

  it('rejects empty text', () => {
    assert.throws(() => mergeNoteText('x', '  '), /required/i);
  });
});

describe('buildStaffTodoItem', () => {
  it('builds an open staff task without portal request fields', () => {
    const item = buildStaffTodoItem({
      text: 'Write blog',
      assigneeEmails: ['Alex@Ignite.pm', 'bad', 'alex@ignite.pm'],
      dueDate: '2026-12-01',
      estimatedHours: 2,
      pinned: true,
      now: 1000,
    });
    assert.match(item.id, /^todo_1000_/);
    assert.equal(item.text, 'Write blog');
    assert.equal(item.done, false);
    assert.equal(item.pinned, true);
    assert.equal(item.estimatedHours, 2);
    assert.deepEqual(item.assigneeEmails, ['alex@ignite.pm']);
    assert.equal(item.requestStatus, undefined);
    assert.ok(item.dueDate > 0);
  });

  it('rejects blank text', () => {
    assert.throws(() => buildStaffTodoItem({ text: '' }), /required/i);
  });
});

describe('resolveRetainerCategory', () => {
  const client = {
    retainers: { SEO: 10, 'Social Media': 5 },
    retainerCategoryEnabled: { SEO: true, 'Social Media': true },
  };

  it('matches label or key', () => {
    assert.equal(resolveRetainerCategory(client, { category: 'SEO' }).categoryKey, 'SEO');
    assert.equal(
      resolveRetainerCategory(client, { categoryKey: 'Social Media' }).categoryLabel,
      'Social Media',
    );
  });

  it('errors on unknown category', () => {
    assert.throws(
      () => resolveRetainerCategory(client, { category: 'Ads' }),
      /Unknown category/,
    );
  });
});

describe('helpers', () => {
  it('normalizes assignees and due dates', () => {
    assert.deepEqual(normalizeAssigneeEmails(['A@B.com', 'a@b.com']), ['a@b.com']);
    assert.equal(parseDueDateMs(1700000000000), 1700000000000);
    assert.ok(parseDueDateMs('2026-01-15T12:00:00Z') > 0);
  });

  it('resolves actor email from env/arg', () => {
    const prev = process.env.PERPLEXITY_MCP_ACTOR_EMAIL;
    process.env.PERPLEXITY_MCP_ACTOR_EMAIL = 'bot@ignite.pm';
    assert.equal(resolveMcpActorEmail(), 'bot@ignite.pm');
    assert.equal(resolveMcpActorEmail('Human@Ignite.pm'), 'human@ignite.pm');
    process.env.PERPLEXITY_MCP_ACTOR_EMAIL = prev;
  });
});
