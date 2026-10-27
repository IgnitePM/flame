import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectClientTaskApprovalRows,
  isTodoApprovalTracked,
  TODO_APPROVAL,
} from './todoApproval.js';

describe('isTodoApprovalTracked', () => {
  it('tracks pending, revisions, and decided items', () => {
    assert.equal(
      isTodoApprovalTracked({ approvalStatus: TODO_APPROVAL.PENDING_CLIENT }),
      true,
    );
    assert.equal(
      isTodoApprovalTracked({
        approvalStatus: TODO_APPROVAL.REVISION_REQUESTED,
      }),
      true,
    );
    assert.equal(
      isTodoApprovalTracked({ approvalDecisionAt: 1_700_000_000_000, done: true }),
      true,
    );
    assert.equal(isTodoApprovalTracked({ text: 'plain task' }), false);
  });
});

describe('collectClientTaskApprovalRows', () => {
  it('includes approvals from past cycles, not only current', () => {
    const current = 1_700_000_000_000;
    const past = current - 30 * 86400000;
    const client = {
      id: 'c1',
      billingDay: 1,
      retainers: { SEO: 10 },
      todoCycles: {
        [String(past)]: {
          seo: {
            items: [
              {
                id: 'todo_past',
                text: 'Past blog',
                approvalStatus: TODO_APPROVAL.PENDING_CLIENT,
                approvalRequestedAt: past + 1000,
              },
            ],
          },
        },
        [String(current)]: {
          seo: {
            items: [
              {
                id: 'todo_now',
                text: 'Current blog',
                approvalDecisionAt: current + 5000,
                done: true,
              },
            ],
          },
        },
      },
    };

    const rows = collectClientTaskApprovalRows(client, {
      getBillingPeriod: () => ({ start: current, end: current + 86400000 }),
      getTodoStateForCycle: (c, cycleStart) =>
        c.todoCycles[String(cycleStart)] || {},
      todoCategoryKey: (name) => String(name || '').toLowerCase(),
    });

    const ids = rows.map((r) => r.item.id).sort();
    assert.deepEqual(ids, ['todo_now', 'todo_past']);
    const pastRow = rows.find((r) => r.item.id === 'todo_past');
    assert.equal(pastRow.cycleStart, past);
    assert.equal(pastRow.pending, true);
  });

  it('dedupes the same task id across cycles by newest activity', () => {
    const current = 1_700_000_000_000;
    const past = current - 30 * 86400000;
    const client = {
      id: 'c1',
      billingDay: 1,
      retainers: {},
      todoCycles: {
        [String(past)]: {
          seo: {
            items: [
              {
                id: 'todo_1',
                text: 'Carry',
                approvalStatus: TODO_APPROVAL.PENDING_CLIENT,
                approvalRequestedAt: past + 1,
              },
            ],
          },
        },
        [String(current)]: {
          seo: {
            items: [
              {
                id: 'todo_1',
                text: 'Carry',
                approvalStatus: TODO_APPROVAL.PENDING_CLIENT,
                approvalRequestedAt: current + 1,
              },
            ],
          },
        },
      },
    };

    const rows = collectClientTaskApprovalRows(client, {
      getBillingPeriod: () => ({ start: current, end: current + 1 }),
      getTodoStateForCycle: (c, s) => c.todoCycles[String(s)] || {},
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].cycleStart, current);
  });
});
