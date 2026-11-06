import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildClientTransferPatch,
  planStaffTransfer,
  replaceEmailInList,
  rewriteTodoItemAssignments,
  summarizeTransferPlan,
} from './staffTransfer.js';

describe('replaceEmailInList', () => {
  it('swaps and de-dupes', () => {
    const r = replaceEmailInList(
      ['Julius@Ignitepm.com', 'other@x.com', 'julius@ignitepm.com'],
      'julius@ignitepm.com',
      'chris.bert@ignitepm.com',
    );
    assert.equal(r.replacements, 2);
    assert.deepEqual(r.next, ['chris.bert@ignitepm.com', 'other@x.com']);
  });

  it('no-ops when emails match', () => {
    const r = replaceEmailInList(['a@x.com'], 'a@x.com', 'a@x.com');
    assert.equal(r.changed, false);
    assert.equal(r.replacements, 0);
  });
});

describe('rewriteTodoItemAssignments', () => {
  it('rewrites assignees and reviewers but not comment authors', () => {
    const item = {
      id: 't1',
      assigneeEmails: ['julius@ignitepm.com'],
      approvalReviewerEmails: ['julius@ignitepm.com', 'sam@ignitepm.com'],
      comments: [
        {
          id: 'c1',
          authorEmail: 'julius@ignitepm.com',
          authorName: 'Julius',
          text: 'note',
        },
      ],
      subtasks: [
        {
          id: 's1',
          assigneeEmails: ['Julius@ignitepm.com'],
          comments: [{ id: 'c2', authorEmail: 'julius@ignitepm.com', text: 'sub' }],
        },
      ],
    };
    const { next, changed, counts } = rewriteTodoItemAssignments(
      item,
      'julius@ignitepm.com',
      'chris.bert@ignitepm.com',
    );
    assert.equal(changed, true);
    assert.deepEqual(next.assigneeEmails, ['chris.bert@ignitepm.com']);
    assert.deepEqual(next.approvalReviewerEmails, [
      'chris.bert@ignitepm.com',
      'sam@ignitepm.com',
    ]);
    assert.equal(next.comments[0].authorEmail, 'julius@ignitepm.com');
    assert.deepEqual(next.subtasks[0].assigneeEmails, ['chris.bert@ignitepm.com']);
    assert.equal(next.subtasks[0].comments[0].authorEmail, 'julius@ignitepm.com');
    assert.ok(counts.assignees >= 2);
    assert.equal(counts.reviewers, 1);
  });
});

describe('buildClientTransferPatch', () => {
  it('rewrites todoCycles and team access', () => {
    const client = {
      id: 'c1',
      name: 'Acme',
      teamMemberAccessEmails: ['julius@ignitepm.com', 'sam@ignitepm.com'],
      todoCycles: {
        '1000': {
          seo: {
            items: [
              {
                id: 't1',
                assigneeEmails: ['julius@ignitepm.com'],
                comments: [{ authorEmail: 'julius@ignitepm.com', text: 'keep' }],
              },
            ],
          },
        },
      },
    };
    const built = buildClientTransferPatch(
      client,
      'julius@ignitepm.com',
      'chris.bert@ignitepm.com',
    );
    assert.ok(built);
    assert.deepEqual(built.patch.teamMemberAccessEmails, [
      'chris.bert@ignitepm.com',
      'sam@ignitepm.com',
    ]);
    assert.deepEqual(
      built.patch.todoCycles['1000'].seo.items[0].assigneeEmails,
      ['chris.bert@ignitepm.com'],
    );
    assert.equal(
      built.patch.todoCycles['1000'].seo.items[0].comments[0].authorEmail,
      'julius@ignitepm.com',
    );
  });

  it('returns null when nothing assigned', () => {
    assert.equal(
      buildClientTransferPatch(
        { id: 'c1', todoCycles: {}, teamMemberAccessEmails: ['sam@x.com'] },
        'julius@ignitepm.com',
        'chris.bert@ignitepm.com',
      ),
      null,
    );
  });
});

describe('planStaffTransfer', () => {
  it('aggregates clients, sales ownership, and digest list', () => {
    const plan = planStaffTransfer({
      fromEmail: 'julius@ignitepm.com',
      toEmail: 'chris.bert@ignitepm.com',
      clients: [
        {
          id: 'c1',
          teamMemberAccessEmails: ['julius@ignitepm.com'],
          todoCycles: {
            a: {
              cat: { items: [{ id: '1', assigneeEmails: ['julius@ignitepm.com'] }] },
            },
          },
        },
      ],
      leads: [{ id: 'l1', ownerEmail: 'julius@ignitepm.com' }],
      deals: [
        { id: 'd1', ownerEmail: 'julius@ignitepm.com' },
        { id: 'd2', ownerEmail: 'sam@ignitepm.com' },
      ],
      digestRecipients: ['julius@ignitepm.com', 'boss@ignitepm.com'],
    });
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.summary.clients, 1);
    assert.equal(plan.summary.leads, 1);
    assert.equal(plan.summary.deals, 1);
    assert.equal(plan.summary.digestRecipients, 1);
    assert.deepEqual(plan.digestRecipients, [
      'chris.bert@ignitepm.com',
      'boss@ignitepm.com',
    ]);
    assert.match(summarizeTransferPlan(plan, 3), /inbox notification/);
  });

  it('rejects same from/to', () => {
    const plan = planStaffTransfer({
      fromEmail: 'a@x.com',
      toEmail: 'a@x.com',
    });
    assert.ok(plan.errors.length);
  });
});
