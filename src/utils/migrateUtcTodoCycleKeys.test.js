import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  billingCycleStartAt,
  utcMidnightKeyToTorontoMidnightKey,
} from './billingEngine.js';
import { planUtcTodoCycleKeyMigration } from './migrateUtcTodoCycleKeys.js';

describe('planUtcTodoCycleKeyMigration', () => {
  it('moves open UTC-key todos to Toronto key and leaves completed', () => {
    const utcKey = Date.UTC(2025, 10, 1);
    const torontoKey = utcMidnightKeyToTorontoMidnightKey(utcKey);
    const open = {
      id: 'open1',
      text: 'Ship MCP fix',
      done: false,
      assigneeEmails: ['chris@ignitepm.com'],
      dueDate: utcKey + 3 * 86400000,
      recurring: true,
      recurringId: 'r1',
      recurrence: { mode: 'monthly', dayOfMonth: 1 },
      comments: [{ id: 'c1', text: 'note', authorEmail: 'a@x.com' }],
      subtasks: [{ id: 's1', text: 'step', done: false, assigneeEmails: ['a@x.com'] }],
    };
    const done = {
      id: 'done1',
      text: 'Finished',
      done: true,
      assigneeEmails: [],
    };
    const clients = [
      {
        id: 'clientA',
        name: 'Acme',
        billingDay: 1,
        todoCycles: {
          [String(utcKey)]: {
            seo: { closed: false, items: [open, done] },
          },
          [String(torontoKey)]: {
            seo: {
              closed: false,
              items: [{ id: 'already', text: 'Browser task', done: false }],
            },
          },
        },
      },
    ];

    const plan = planUtcTodoCycleKeyMigration(clients);
    assert.equal(plan.moves.length, 1);
    assert.equal(plan.moves[0].id, 'open1');
    assert.equal(plan.moves[0].fromCycleStart, utcKey);
    assert.equal(plan.moves[0].toCycleStart, torontoKey);
    assert.equal(plan.moves[0].subtaskCount, 1);
    assert.equal(plan.moves[0].commentCount, 1);
    assert.equal(plan.patches.length, 1);

    const next = plan.patches[0].todoCycles;
    const utcItems = next[String(utcKey)].seo.items;
    const torItems = next[String(torontoKey)].seo.items;
    assert.deepEqual(
      utcItems.map((i) => i.id),
      ['done1'],
    );
    assert.deepEqual(
      torItems.map((i) => i.id),
      ['already', 'open1'],
    );
    assert.equal(torItems[1].recurringId, 'r1');
    assert.equal(torItems[1].subtasks[0].id, 's1');
    assert.equal(torItems[1].comments[0].id, 'c1');
  });

  it('skips clients whose keys are already Toronto midnight', () => {
    const torontoKey = billingCycleStartAt(1, 2025, 10);
    const clients = [
      {
        id: 'c1',
        name: 'Ok',
        billingDay: 1,
        todoCycles: {
          [String(torontoKey)]: {
            general: {
              closed: false,
              items: [{ id: 't', text: 'ok', done: false }],
            },
          },
        },
      },
    ];
    const plan = planUtcTodoCycleKeyMigration(clients);
    assert.equal(plan.moves.length, 0);
    assert.equal(plan.patches.length, 0);
  });

  it('is idempotent when the open item already exists on Toronto key', () => {
    const utcKey = Date.UTC(2025, 10, 1);
    const torontoKey = utcMidnightKeyToTorontoMidnightKey(utcKey);
    const item = { id: 'dup', text: 'Same', done: false };
    const clients = [
      {
        id: 'c1',
        name: 'Dup',
        billingDay: 1,
        todoCycles: {
          [String(utcKey)]: { gen: { closed: false, items: [item] } },
          [String(torontoKey)]: {
            gen: { closed: false, items: [{ ...item }] },
          },
        },
      },
    ];
    const plan = planUtcTodoCycleKeyMigration(clients);
    assert.equal(plan.moves.length, 1);
    assert.equal(plan.moves[0].alreadyPresent, true);
    const torItems = plan.patches[0].todoCycles[String(torontoKey)].gen.items;
    assert.equal(torItems.filter((i) => i.id === 'dup').length, 1);
    assert.equal(
      plan.patches[0].todoCycles[String(utcKey)].gen.items.length,
      0,
    );
  });
});
