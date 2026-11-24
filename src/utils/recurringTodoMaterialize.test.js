import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parentTodoDoneBlockReason } from './todoSubtasks.js';
import {
  deterministicRecurringTodoId,
  inheritSubtasksOntoOpenItems,
  maintainCurrentCycleTodos,
  mergeOpenItemsFromPrevCycle,
  subtasksVisibleForCompletion,
  markPrimaryTodoDoneAcrossCycles,
  propagateSubtasksAcrossCycles,
  reconcileRecurringTodoInstances,
  removeSubtaskFromCycles,
} from './recurringTodoMaterialize.js';

const SERIES = 'todo_1773962915175_czb909m829m';
const CATEGORY = 'Blog Posts';

function atLocalNoon(year, monthIndex, day) {
  return new Date(year, monthIndex, day, 12, 0, 0, 0).getTime();
}

const DUE = atLocalNoon(2026, 9, 30);
const CYCLE_START = atLocalNoon(2026, 9, 17);
const CYCLE_END = atLocalNoon(2026, 10, 16);
const OCCURRENCE_ID = deterministicRecurringTodoId(SERIES, DUE);

function blogTask(overrides = {}) {
  return {
    id: OCCURRENCE_ID,
    text: 'Create 2 monthly blog articles',
    done: false,
    doneAt: null,
    recurring: true,
    recurringId: SERIES,
    recurrence: { type: 'monthly_fixed_day', dayOfMonth: 30 },
    dueDate: DUE,
    subtasks: [],
    ...overrides,
  };
}

const TEMPLATE_SUBTASKS = [
  {
    id: 'sub_1794287720207_9i3ernh',
    text: 'Schedule Blog 1 for the 9th',
    done: false,
    recurring: true,
    recurringId: 'sub_blog_1',
  },
  {
    id: 'sub_1794287720207_cgo1a92',
    text: 'Schedule blog 2 for the 22nd',
    done: false,
    recurring: true,
    recurringId: 'sub_blog_2',
  },
];

describe('inherited recurring subtasks', () => {
  it('copies template subtask ids onto the open occurrence the list shows', () => {
    const { cycles, changed } = propagateSubtasksAcrossCycles({
      [String(CYCLE_START)]: {
        [CATEGORY]: {
          items: [blogTask()],
          recurringSeriesTemplates: [
            {
              id: SERIES,
              recurring: true,
              recurringId: SERIES,
              text: 'Create 2 monthly blog articles',
              subtasks: TEMPLATE_SUBTASKS,
            },
          ],
        },
      },
    });

    const saved = cycles[String(CYCLE_START)][CATEGORY].items[0];
    assert.equal(changed, true);
    assert.deepEqual(
      saved.subtasks.map((sub) => sub.id),
      TEMPLATE_SUBTASKS.map((sub) => sub.id),
    );
    assert.equal(parentTodoDoneBlockReason(saved), '2 subtasks still open');
    const again = propagateSubtasksAcrossCycles(cycles);
    assert.equal(again.changed, false);
  });

  it('still sees template subtasks when checking a row that was marked done too early', () => {
    const visible = subtasksVisibleForCompletion(
      blogTask({ done: true, subtasks: [] }),
      [],
      [
        {
          id: SERIES,
          recurring: true,
          recurringId: SERIES,
          subtasks: TEMPLATE_SUBTASKS,
        },
      ],
    );
    assert.equal(parentTodoDoneBlockReason({ subtasks: visible }), '2 subtasks still open');
  });

  it('does not reopen a subtask that is already done on the occurrence', () => {
    const doneSub = { ...TEMPLATE_SUBTASKS[0], done: true, doneAt: 50 };
    const { items } = inheritSubtasksOntoOpenItems(
      [blogTask({ subtasks: [doneSub] })],
      [
        {
          id: SERIES,
          recurring: true,
          recurringId: SERIES,
          subtasks: TEMPLATE_SUBTASKS,
        },
      ],
    );
    const first = items[0].subtasks.find((sub) => sub.recurringId === 'sub_blog_1');
    assert.equal(first.done, true);
    assert.equal(first.id, doneSub.id);
  });

  it('removes a subtask from the occurrence and the series template', () => {
    const cycles = {
      [String(CYCLE_START)]: {
        [CATEGORY]: {
          items: [blogTask({ subtasks: TEMPLATE_SUBTASKS.map((sub) => ({ ...sub })) })],
          recurringSeriesTemplates: [
            {
              id: SERIES,
              recurring: true,
              recurringId: SERIES,
              subtasks: TEMPLATE_SUBTASKS.map((sub) => ({ ...sub })),
            },
          ],
        },
      },
    };
    const { cycles: next, removed } = removeSubtaskFromCycles(cycles, {
      categoryKey: CATEGORY,
      todoId: OCCURRENCE_ID,
      subtaskId: TEMPLATE_SUBTASKS[0].id,
    });
    assert.equal(removed, true);
    const cat = next[String(CYCLE_START)][CATEGORY];
    assert.equal(
      cat.items[0].subtasks.some((sub) => sub.id === TEMPLATE_SUBTASKS[0].id),
      false,
    );
    assert.equal(
      cat.recurringSeriesTemplates[0].subtasks.some(
        (sub) => sub.id === TEMPLATE_SUBTASKS[0].id,
      ),
      false,
    );
  });
});

describe('recurring completion stays closed', () => {
  it('does not spawn another open row with the completed occurrence id', () => {
    const completed = blogTask({
      done: true,
      doneAt: 10,
      dueDate: atLocalNoon(2026, 9, 29),
    });
    const { cycleDataByCategory } = reconcileRecurringTodoInstances(
      { [CATEGORY]: { items: [completed], closed: false } },
      CYCLE_START,
      CYCLE_END,
      () => 'todo_should_not_replace',
    );
    const items = cycleDataByCategory[CATEGORY].items;
    const copies = items.filter((row) => row.id === OCCURRENCE_ID);
    assert.equal(copies.length, 1);
    assert.equal(copies[0].done, true);
  });

  it('keeps a completed occurrence closed when an older open copy is still in the previous cycle', () => {
    const prevKey = String(atLocalNoon(2026, 8, 17));
    const olderOpen = blogTask({
      id: SERIES,
      done: false,
      subtasks: TEMPLATE_SUBTASKS.map((sub) => ({ ...sub })),
    });
    const completed = blogTask({ done: true, doneAt: 10, subtasks: [] });
    const { cycles } = maintainCurrentCycleTodos({
      todoCycles: {
        [prevKey]: { [CATEGORY]: { items: [olderOpen], closed: false } },
        [String(CYCLE_START)]: { [CATEGORY]: { items: [completed], closed: false } },
      },
      prevCycleData: { [CATEGORY]: { items: [olderOpen], closed: false } },
      cycleStartMs: CYCLE_START,
      cycleEndMs: CYCLE_END,
      newTodoId: () => 'todo_should_not_be_created',
      categoryKeys: [CATEGORY],
    });
    const items = cycles[String(CYCLE_START)][CATEGORY].items;
    const current = items.find((row) => row.id === OCCURRENCE_ID);
    assert.ok(current);
    assert.equal(current.done, true);
    assert.equal(
      items.some((row) => row.recurring && !row.done && row.recurringId === SERIES),
      false,
    );
  });

  it('does not merge an older open copy back over a completed occurrence', () => {
    const olderOpen = blogTask({ id: SERIES, done: false });
    const completed = blogTask({ done: true, doneAt: 10 });
    const merged = mergeOpenItemsFromPrevCycle(
      { [CATEGORY]: { items: [completed], closed: false } },
      { [CATEGORY]: { items: [olderOpen], closed: false } },
    );
    assert.equal(merged[CATEGORY].items.length, 1);
    assert.equal(merged[CATEGORY].items[0].done, true);
  });

  it('marks every open copy of the same occurrence done', () => {
    const anchorCopy = blogTask({ id: SERIES, done: false });
    const deterministic = blogTask({ done: false });
    const { cycles, touched } = markPrimaryTodoDoneAcrossCycles(
      {
        [String(CYCLE_START)]: {
          [CATEGORY]: { items: [anchorCopy, deterministic], closed: false },
        },
      },
      CATEGORY,
      OCCURRENCE_ID,
      true,
      {
        recurringSkipKey: `${SERIES}__${new Date(DUE).toDateString()}`,
      },
    );
    assert.equal(touched, true);
    const items = cycles[String(CYCLE_START)][CATEGORY].items;
    assert.equal(items.every((row) => row.done), true);
  });
});
