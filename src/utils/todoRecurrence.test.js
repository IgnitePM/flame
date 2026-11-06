import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyRecurrenceFields,
  buildRecurrenceFromMode,
  normalizeRecurrenceMode,
  resolveRecurrenceInput,
} from './todoRecurrence.js';

describe('normalizeRecurrenceMode', () => {
  it('accepts aliases', () => {
    assert.equal(normalizeRecurrenceMode('Daily'), 'daily');
    assert.equal(normalizeRecurrenceMode('bi-weekly'), 'biweekly');
    assert.equal(normalizeRecurrenceMode('yearly'), 'annual');
    assert.equal(normalizeRecurrenceMode('off'), 'none');
  });
});

describe('buildRecurrenceFromMode', () => {
  const due = Date.parse('2026-03-15T12:00:00');

  it('builds weekly/monthly/annual from due date', () => {
    assert.deepEqual(buildRecurrenceFromMode('weekly', due), {
      type: 'weekly_weekday',
      weekday: new Date(due).getDay(),
    });
    assert.deepEqual(buildRecurrenceFromMode('monthly', due), {
      type: 'monthly_fixed_day',
      dayOfMonth: 15,
    });
    assert.equal(buildRecurrenceFromMode('daily', due).type, 'daily_fixed');
    assert.equal(buildRecurrenceFromMode('none', due), null);
  });
});

describe('resolveRecurrenceInput', () => {
  it('prefers raw recurrence object', () => {
    const r = resolveRecurrenceInput({
      recurrenceMode: 'daily',
      recurrence: { type: 'monthly_fixed_day', dayOfMonth: 1 },
    });
    assert.equal(r.recurrence.type, 'monthly_fixed_day');
  });

  it('rejects unknown modes', () => {
    assert.throws(
      () => resolveRecurrenceInput({ recurrenceMode: 'every_hour' }),
      /Unknown recurrenceMode/,
    );
  });
});

describe('applyRecurrenceFields', () => {
  it('sets series id from item id', () => {
    const next = applyRecurrenceFields(
      { id: 'todo_1', text: 'x' },
      { type: 'daily_fixed' },
    );
    assert.equal(next.recurring, true);
    assert.equal(next.recurringId, 'todo_1');
    assert.equal(next.recurrence.type, 'daily_fixed');
  });

  it('clears when recurrence is null', () => {
    const next = applyRecurrenceFields(
      {
        id: 'todo_1',
        recurring: true,
        recurringId: 'todo_1',
        recurrence: { type: 'daily_fixed' },
      },
      null,
    );
    assert.equal(next.recurring, false);
    assert.equal(next.recurrence, null);
  });
});
