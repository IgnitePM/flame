import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filterToActiveStaffEmails,
  indexActiveStaffByEmail,
  resolveClientAlertStaffEmails,
  teamAccessLooksLikeBroadcast,
} from './activeStaff.mjs';

const admins = [
  { id: 'chris@ignitepm.com', email: 'chris@ignitepm.com', role: 'admin' },
  { id: 'billing@ignitepm.com', email: 'billing@ignitepm.com', role: 'billing' },
  { id: 'kiosk1@ignitepm.com', email: 'kiosk1@ignitepm.com', role: 'kiosk' },
  { id: 'kiosk2@ignitepm.com', email: 'kiosk2@ignitepm.com', role: 'kiosk' },
  { id: 'kiosk3@ignitepm.com', email: 'kiosk3@ignitepm.com', role: 'kiosk' },
  {
    id: 'sabrina@ignitepm.com',
    email: 'sabrina@ignitepm.com',
    role: 'kiosk',
    disabled: true,
  },
  {
    id: 'connor@ignitepm.com',
    email: 'connor@ignitepm.com',
    role: 'kiosk',
    disabled: true,
  },
];

describe('indexActiveStaffByEmail', () => {
  it('omits disabled staff', () => {
    const map = indexActiveStaffByEmail(admins);
    assert.equal(map.has('sabrina@ignitepm.com'), false);
    assert.equal(map.has('chris@ignitepm.com'), true);
  });
});

describe('filterToActiveStaffEmails', () => {
  it('drops inactive addresses', () => {
    assert.deepEqual(
      filterToActiveStaffEmails(
        ['sabrina@ignitepm.com', 'Chris@Ignitepm.com', 'gone@x.com'],
        admins,
      ),
      ['chris@ignitepm.com'],
    );
  });
});

describe('teamAccessLooksLikeBroadcast', () => {
  it('detects all-kiosk seed lists', () => {
    const team = [
      'kiosk1@ignitepm.com',
      'kiosk2@ignitepm.com',
      'kiosk3@ignitepm.com',
      'sabrina@ignitepm.com',
    ];
    assert.equal(teamAccessLooksLikeBroadcast(team, admins), true);
  });

  it('treats curated lists as not broadcast', () => {
    assert.equal(
      teamAccessLooksLikeBroadcast(['kiosk1@ignitepm.com'], admins),
      false,
    );
  });
});

describe('resolveClientAlertStaffEmails', () => {
  it('skips disabled users on a broadcast ACL and emails ops + assignees', () => {
    const client = {
      teamMemberAccessEmails: [
        'kiosk1@ignitepm.com',
        'kiosk2@ignitepm.com',
        'kiosk3@ignitepm.com',
        'sabrina@ignitepm.com',
        'connor@ignitepm.com',
      ],
      todoCycles: {
        '1': {
          seo: {
            items: [
              {
                id: 't1',
                assigneeEmails: ['kiosk1@ignitepm.com', 'sabrina@ignitepm.com'],
              },
            ],
          },
        },
      },
    };
    const to = resolveClientAlertStaffEmails(client, admins);
    assert.ok(to.includes('chris@ignitepm.com'));
    assert.ok(to.includes('billing@ignitepm.com'));
    assert.ok(to.includes('kiosk1@ignitepm.com'));
    assert.equal(to.includes('sabrina@ignitepm.com'), false);
    assert.equal(to.includes('connor@ignitepm.com'), false);
    assert.equal(to.includes('kiosk2@ignitepm.com'), false);
  });

  it('honors a curated team ACL (active only)', () => {
    const client = {
      teamMemberAccessEmails: [
        'kiosk1@ignitepm.com',
        'sabrina@ignitepm.com',
      ],
    };
    const to = resolveClientAlertStaffEmails(client, admins);
    assert.deepEqual(to, ['kiosk1@ignitepm.com']);
  });
});
