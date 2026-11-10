import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { taskReplyContextFromMessage } from './portalTaskMessageReply.js';

describe('taskReplyContextFromMessage', () => {
  it('returns task reply context for mention mirrors with refs', () => {
    const ctx = taskReplyContextFromMessage({
      id: 'msg1',
      systemKind: 'todo_note_mention',
      itemId: 'todo_1',
      categoryKey: 'SEO',
      cycleStart: 1000,
      taskTitle: 'Update sitemap',
    });
    assert.equal(ctx.itemId, 'todo_1');
    assert.equal(ctx.categoryKey, 'SEO');
    assert.equal(ctx.cycleStart, 1000);
    assert.equal(ctx.taskTitle, 'Update sitemap');
  });

  it('ignores general messages and incomplete task mirrors', () => {
    assert.equal(
      taskReplyContextFromMessage({
        id: 'm',
        systemKind: 'todo_note_mention',
        // missing itemId/categoryKey (legacy rows)
      }),
      null,
    );
    assert.equal(
      taskReplyContextFromMessage({
        id: 'm',
        authorType: 'client',
        body: 'hello',
      }),
      null,
    );
  });
});
