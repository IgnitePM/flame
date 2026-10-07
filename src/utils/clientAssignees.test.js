import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assigneeChoiceGroups, portalUserEmailsForClient } from './clientAssignees.js';

describe('portalUserEmailsForClient', () => {
  it('returns only this client’s portal emails', () => {
    assert.deepEqual(
      portalUserEmailsForClient({
        clientEmails: [' Ada@Client.com ', 'ada@client.com', 'bob@client.com'],
      }),
      ['ada@client.com', 'bob@client.com'],
    );
    assert.deepEqual(portalUserEmailsForClient({}), []);
  });
});

describe('assigneeChoiceGroups', () => {
  it('keeps other clients’ users out and lists this client beside staff', () => {
    const groups = assigneeChoiceGroups({
      staffEmails: ['sam@ignitepm.com'],
      client: { clientEmails: ['ada@client.com'] },
      selected: ['old@gone.com'],
    });
    assert.deepEqual(groups.staff, ['sam@ignitepm.com']);
    assert.deepEqual(groups.clients, ['ada@client.com']);
    assert.deepEqual(groups.other, ['old@gone.com']);
  });

  it('hides the client group when no client is selected', () => {
    const groups = assigneeChoiceGroups({
      staffEmails: ['sam@ignitepm.com'],
      client: null,
      selected: [],
    });
    assert.equal(groups.showClients, false);
    assert.deepEqual(groups.clients, []);
  });

  it('does not list a portal user twice when they are also staff', () => {
    const groups = assigneeChoiceGroups({
      staffEmails: ['ada@client.com'],
      client: { clientEmails: ['ada@client.com', 'bob@client.com'] },
    });
    assert.deepEqual(groups.staff, ['ada@client.com']);
    assert.deepEqual(groups.clients, ['bob@client.com']);
  });
});
