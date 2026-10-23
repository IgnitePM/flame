import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOpenItemsFromPrevCycle } from './recurringTodoMaterialize.js';

describe('mergeOpenItemsFromPrevCycle comment carry', () => {
  it('pulls notes from the prior-cycle copy onto the same task id in the current cycle', () => {
    const prev = {
      seo: {
        closed: false,
        items: [
          {
            id: 'todo_1',
            text: 'Publish blog',
            done: false,
            comments: [
              {
                id: 'cmt_camille',
                text: '@client please review the draft',
                authorName: 'Camille',
                createdAt: 100,
              },
            ],
          },
        ],
      },
    };
    const current = {
      seo: {
        closed: false,
        items: [
          {
            id: 'todo_1',
            text: 'Publish blog',
            done: false,
            comments: [],
          },
        ],
      },
    };

    const merged = mergeOpenItemsFromPrevCycle(current, prev);
    const comments = merged.seo.items[0].comments || [];
    assert.equal(comments.length, 1);
    assert.equal(comments[0].id, 'cmt_camille');
    assert.match(comments[0].text, /please review/);
  });

  it('does not duplicate comments that already exist on the current cycle', () => {
    const comment = {
      id: 'cmt_1',
      text: 'already here',
      authorName: 'Camille',
      createdAt: 100,
    };
    const prev = {
      seo: {
        closed: false,
        items: [{ id: 'todo_1', text: 'Task', done: false, comments: [comment] }],
      },
    };
    const current = {
      seo: {
        closed: false,
        items: [{ id: 'todo_1', text: 'Task', done: false, comments: [comment] }],
      },
    };

    const merged = mergeOpenItemsFromPrevCycle(current, prev);
    assert.equal(merged, current);
  });
});
