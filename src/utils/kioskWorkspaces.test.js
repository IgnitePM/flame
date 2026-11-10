import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  billingTargetMatchesActiveTask,
  createWorkspace,
  isTimingWorkspace,
  loadWorkspacesFromStorage,
  removeWorkspace,
  saveWorkspacesToStorage,
  upsertWorkspace,
  workspaceLabel,
} from './kioskWorkspaces.js';

describe('kioskWorkspaces', () => {
  it('labels retainer and project tabs', () => {
    assert.equal(
      workspaceLabel({
        clientName: 'Twin Peaks',
        billingTarget: 'retainer_SEO',
      }),
      'Twin Peaks · SEO',
    );
    assert.equal(
      workspaceLabel({
        clientName: 'Acme',
        billingTarget: 'project_abc',
      }),
      'Acme · Project',
    );
  });

  it('upserts without duplicating the same client+target', () => {
    let state = { workspaces: [], activeId: null };
    state = upsertWorkspace(state.workspaces, {
      clientName: 'A',
      billingTarget: 'retainer_SEO',
    });
    const firstId = state.activeId;
    state = upsertWorkspace(state.workspaces, {
      clientName: 'A',
      billingTarget: 'retainer_SEO',
    });
    assert.equal(state.workspaces.length, 1);
    assert.equal(state.activeId, firstId);
    state = upsertWorkspace(state.workspaces, {
      clientName: 'B',
      billingTarget: 'retainer_Ads',
    });
    assert.equal(state.workspaces.length, 2);
  });

  it('remove keeps at least one blank workspace', () => {
    const only = [createWorkspace({ clientName: 'A', billingTarget: 'retainer_SEO' })];
    const next = removeWorkspace(only, only[0].id);
    assert.equal(next.length, 1);
    assert.equal(next[0].clientName, '');
  });

  it('detects which tab the active timer belongs to', () => {
    const task = {
      clientName: 'Elite',
      projectName: 'Web Development',
      projectId: null,
    };
    assert.equal(
      isTimingWorkspace(task, {
        clientName: 'Elite',
        billingTarget: 'retainer_Web Development',
      }),
      true,
    );
    assert.equal(
      billingTargetMatchesActiveTask(task, 'retainer_Web Development'),
      true,
    );
    assert.equal(
      isTimingWorkspace(task, {
        clientName: 'Other',
        billingTarget: 'retainer_Web Development',
      }),
      false,
    );
  });

  it('persists to storage', () => {
    const mem = new Map();
    const storage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
    };
    const ws = [createWorkspace({ clientName: 'A', billingTarget: 'retainer_SEO' })];
    saveWorkspacesToStorage(storage, 'chris@x.com', {
      workspaces: ws,
      activeId: ws[0].id,
    });
    const loaded = loadWorkspacesFromStorage(storage, 'chris@x.com');
    assert.equal(loaded.workspaces.length, 1);
    assert.equal(loaded.workspaces[0].clientName, 'A');
    assert.equal(loaded.activeId, ws[0].id);
  });
});
