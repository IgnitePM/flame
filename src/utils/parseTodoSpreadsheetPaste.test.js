import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTodoItemsFromPasteRows,
  parsePasteDueToMs,
  parseTodoSpreadsheetPaste,
  readTaskCellNesting,
  removePastePreviewRow,
  splitPasteLine,
} from './parseTodoSpreadsheetPaste.js';

describe('splitPasteLine', () => {
  it('prefers TSV when tabs are present', () => {
    assert.deepEqual(splitPasteLine('A\tB\tC'), ['A', 'B', 'C']);
  });

  it('splits simple CSV', () => {
    assert.deepEqual(splitPasteLine('A,B,C'), ['A', 'B', 'C']);
  });
});

describe('readTaskCellNesting', () => {
  it('treats leading tab as subtask depth', () => {
    assert.deepEqual(readTaskCellNesting('\tNested'), { depth: 1, text: 'Nested' });
  });

  it('treats 2+ leading spaces as subtask depth', () => {
    assert.deepEqual(readTaskCellNesting('  Nested'), { depth: 1, text: 'Nested' });
  });
});

describe('parsePasteDueToMs', () => {
  it('parses YYYY-MM-DD at local noon', () => {
    const ms = parsePasteDueToMs('2026-03-15');
    assert.ok(ms != null);
    const d = new Date(ms);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 2);
    assert.equal(d.getDate(), 15);
    assert.equal(d.getHours(), 12);
  });
});

describe('parseTodoSpreadsheetPaste', () => {
  it('parses TSV with header, parent, and indented subtask', () => {
    const tsv = [
      'Task\tAssignee\tDue',
      'Ship invoice\talice@ex.com\t2026-04-01',
      '\tGather line items\tbob@ex.com\t2026-03-20',
      'Close books\t\t2026-04-30',
    ].join('\n');

    const rows = parseTodoSpreadsheetPaste(tsv, {
      assignableEmails: ['alice@ex.com', 'bob@ex.com', 'me@ex.com'],
      defaultAssigneeEmail: 'me@ex.com',
    });

    assert.equal(rows.length, 3);
    assert.equal(rows[0].role, 'parent');
    assert.equal(rows[0].text, 'Ship invoice');
    assert.equal(rows[0].assigneeEmail, 'alice@ex.com');
    assert.equal(rows[0].dueDisplay, '2026-04-01');
    assert.equal(rows[1].role, 'subtask');
    assert.equal(rows[1].text, 'Gather line items');
    assert.equal(rows[1].assigneeEmail, 'bob@ex.com');
    assert.equal(rows[2].role, 'parent');
    assert.equal(rows[2].assigneeEmail, 'me@ex.com');
  });

  it('defaults blank assignee and dedupes existing parent text', () => {
    const rows = parseTodoSpreadsheetPaste('Already there\nNew one\n', {
      defaultAssigneeEmail: 'me@ex.com',
      existingParentTexts: ['Already there'],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, 'New one');
    assert.equal(rows[0].assigneeEmail, 'me@ex.com');
  });

  it('parses optional Est hours on parents and subtasks', () => {
    const tsv = [
      'Task\tAssignee\tDue\tEst',
      'Ship invoice\talice@ex.com\t2026-04-01\t4',
      '\tGather line items\tbob@ex.com\t2026-03-20\t1.5',
    ].join('\n');
    const rows = parseTodoSpreadsheetPaste(tsv, {
      assignableEmails: ['alice@ex.com', 'bob@ex.com'],
    });
    assert.equal(rows[0].estimatedHours, 4);
    assert.equal(rows[1].estimatedHours, 1.5);
    const items = buildTodoItemsFromPasteRows(rows);
    assert.equal(items[0].estimatedHours, 4);
    assert.equal(items[0].subtasks[0].estimatedHours, 1.5);
  });
});

describe('removePastePreviewRow + buildTodoItemsFromPasteRows', () => {
  it('builds nested subtasks and clamps due to parent', () => {
    const rows = parseTodoSpreadsheetPaste(
      'Parent\tme@ex.com\t2026-01-10\n\tChild\tme@ex.com\t2026-01-20\n',
      { defaultAssigneeEmail: 'me@ex.com' },
    );
    const items = buildTodoItemsFromPasteRows(rows, {
      newParentId: (() => {
        let n = 0;
        return () => `p${++n}`;
      })(),
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'p1');
    assert.equal(items[0].subtasks.length, 1);
    assert.equal(items[0].subtasks[0].text, 'Child');
    // Child due clamped to parent due (Jan 10)
    const parentDue = items[0].dueDate;
    assert.equal(items[0].subtasks[0].dueDate, parentDue);
  });

  it('removes parent and its following subtasks', () => {
    const rows = parseTodoSpreadsheetPaste(
      'A\n\tA1\nB\n\tB1\n',
      { defaultAssigneeEmail: 'me@ex.com' },
    );
    assert.equal(rows.length, 4);
    const next = removePastePreviewRow(rows, rows[0].previewId);
    assert.equal(next.length, 2);
    assert.equal(next[0].text, 'B');
    assert.equal(next[1].text, 'B1');
  });
});
