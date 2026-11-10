import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOTIFICATION_TYPES } from './notifications.js';
import {
  findTodoLocationInClient,
  isMessagesMentionNotification,
  resolveBillingTargetForCategoryKey,
  resolveKioskNotificationTarget,
} from './kioskNotificationNav.js';

// Mirrors App.jsx todoCategoryKey (spaces preserved; only a few chars rewritten).
const todoCategoryKey = (cat) =>
  String(cat ?? '').replace(/[~*[\]/]/g, '_').replace(/\./g, '_');

describe('isMessagesMentionNotification', () => {
  it('detects Messages titles and category-less mentions', () => {
    assert.equal(
      isMessagesMentionNotification({
        type: 'mention',
        title: 'Mentioned in Messages — Twin Peaks',
        itemId: 'm1',
      }),
      true,
    );
    assert.equal(
      isMessagesMentionNotification({
        type: NOTIFICATION_TYPES.MENTION,
        itemId: 'm1',
        categoryKey: null,
      }),
      true,
    );
    assert.equal(
      isMessagesMentionNotification({
        type: NOTIFICATION_TYPES.MENTION,
        itemId: 't1',
        categoryKey: 'seo',
      }),
      false,
    );
  });
});

describe('resolveKioskNotificationTarget', () => {
  const clients = [
    {
      id: 'c1',
      name: 'Twin Peaks',
      retainers: { SEO: 10 },
      todoCycles: {
        '1000': {
          SEO: {
            items: [{ id: 'todo1', text: 'Blog', done: false }],
          },
        },
      },
    },
    {
      id: 'c2',
      name: 'Elite Exteriors',
      retainers: { 'Web Development': 5 },
      todoCycles: {
        '2000': {
          'Web Development': {
            items: [{ id: 'appr1', text: 'Form fix', done: false }],
          },
        },
      },
    },
  ];

  it('opens messages for message mentions', () => {
    const t = resolveKioskNotificationTarget(
      {
        type: 'mention',
        title: 'Mentioned in Messages — Twin Peaks',
        clientId: 'c1',
        clientName: 'Twin Peaks',
        itemId: 'msg99',
      },
      { clients, todoCategoryKeyFn: todoCategoryKey },
    );
    assert.equal(t.kind, 'messages');
    assert.equal(t.clientId, 'c1');
    assert.equal(t.messageId, 'msg99');
  });

  it('opens todo + billing target for approvals', () => {
    const t = resolveKioskNotificationTarget(
      {
        type: NOTIFICATION_TYPES.TODO_APPROVAL,
        title: 'Review requested: Fix form',
        clientId: 'c2',
        clientName: 'Elite Exteriors',
        categoryKey: 'Web Development',
        itemId: 'appr1',
      },
      { clients, todoCategoryKeyFn: todoCategoryKey },
    );
    assert.equal(t.kind, 'todo');
    assert.equal(t.billingTarget, 'retainer_Web Development');
    assert.equal(t.itemId, 'appr1');
  });

  it('finds todo location across cycles', () => {
    const hit = findTodoLocationInClient(clients[0], {
      itemId: 'todo1',
      categoryKey: 'SEO',
    });
    assert.equal(hit.cycleStart, 1000);
    assert.equal(hit.item.text, 'Blog');
  });

  it('resolves retainer billing target from key', () => {
    assert.equal(
      resolveBillingTargetForCategoryKey(
        clients[0],
        'SEO',
        todoCategoryKey,
      ),
      'retainer_SEO',
    );
  });
});
