import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeTaskCommentLists,
  syncTaskCommentsAcrossCycles,
  taskCommentListsDiffer,
} from './taskComments.js';

describe('mergeTaskCommentLists', () => {
  it('unions comments by id and keeps existing order first', () => {
    const existing = [
      { id: 'c1', text: 'first' },
      { id: 'c2', text: 'second' },
    ];
    const incoming = [
      { id: 'c2', text: 'second-dup' },
      { id: 'c3', text: 'third' },
    ];
    assert.deepEqual(mergeTaskCommentLists(existing, incoming), [
      { id: 'c1', text: 'first' },
      { id: 'c2', text: 'second' },
      { id: 'c3', text: 'third' },
    ]);
  });

  it('returns incoming when existing is empty', () => {
    const incoming = [{ id: 'c1', text: 'only' }];
    assert.deepEqual(mergeTaskCommentLists([], incoming), incoming);
  });
});

describe('taskCommentListsDiffer', () => {
  it('detects newly added comment ids', () => {
    assert.equal(
      taskCommentListsDiffer([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]),
      true,
    );
    assert.equal(
      taskCommentListsDiffer([{ id: 'a' }], [{ id: 'a' }]),
      false,
    );
  });
});

describe('syncTaskCommentsAcrossCycles', () => {
  it('copies new notes onto the same task id in other cycles', () => {
    const comment = {
      id: 'cmt_1',
      text: 'Please review',
      authorName: 'Camille',
      createdAt: 1,
    };
    const cycles = {
      '100': {
        seo: {
          items: [{ id: 'todo_1', text: 'Blog', comments: [comment] }],
        },
      },
      '200': {
        seo: {
          items: [{ id: 'todo_1', text: 'Blog', comments: [] }],
        },
      },
    };
    const { cycles: next, changed } = syncTaskCommentsAcrossCycles(
      cycles,
      'seo',
      cycles['100'].seo.items,
    );
    assert.equal(changed, true);
    assert.equal(next['200'].seo.items[0].comments[0].id, 'cmt_1');
  });
});
