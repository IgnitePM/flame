import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeGlobalRetainerStats } from './billingEngine.js';
import {
  allotmentForCycle,
  scheduleRetainerAllotmentChanges,
} from './retainerCategories.js';

const OCT = new Date(2026, 9, 1).getTime();
const NOV = new Date(2026, 10, 1).getTime();
const DEC = new Date(2026, 11, 1).getTime();
const JAN = new Date(2027, 0, 1).getTime();

function clientWith(retainers, extra = {}) {
  return {
    id: 'c1',
    name: 'Get R Gone',
    billingDay: 1,
    status: 'active',
    retainers,
    retainerCategoryEnabled: { SEO: true },
    ...extra,
  };
}

describe('scheduleRetainerAllotmentChanges', () => {
  it('keeps the current and past cycles on the old hours and starts the new amount next cycle', () => {
    const prev = clientWith({ SEO: 20 });
    const scheduled = scheduleRetainerAllotmentChanges(prev, { SEO: 10 }, {
      currentCycleStart: NOV,
      nextCycleStart: DEC,
    });
    const next = clientWith({ SEO: 10 }, scheduled);

    assert.equal(allotmentForCycle(next, 'SEO', OCT), 20);
    assert.equal(allotmentForCycle(next, 'SEO', NOV), 20);
    assert.equal(allotmentForCycle(next, 'SEO', DEC), 10);
    assert.equal(allotmentForCycle(next, 'SEO', JAN), 10);
  });

  it('replaces a pending change when hours are edited again before that cycle starts', () => {
    const prev = clientWith({ SEO: 20 });
    const first = scheduleRetainerAllotmentChanges(prev, { SEO: 10 }, {
      currentCycleStart: NOV,
      nextCycleStart: DEC,
    });
    const pending = clientWith({ SEO: 10 }, first);
    const second = scheduleRetainerAllotmentChanges(pending, { SEO: 15 }, {
      currentCycleStart: NOV,
      nextCycleStart: DEC,
    });
    const next = clientWith({ SEO: 15 }, second);

    assert.equal(allotmentForCycle(next, 'SEO', NOV), 20);
    assert.equal(allotmentForCycle(next, 'SEO', DEC), 15);
  });

  it('locks a cycle once it has started, and the next increase starts the cycle after that', () => {
    const reduced = clientWith(
      { SEO: 10 },
      scheduleRetainerAllotmentChanges(clientWith({ SEO: 20 }), { SEO: 10 }, {
        currentCycleStart: NOV,
        nextCycleStart: DEC,
      }),
    );
    const raised = scheduleRetainerAllotmentChanges(reduced, { SEO: 18 }, {
      currentCycleStart: DEC,
      nextCycleStart: JAN,
    });
    const next = clientWith({ SEO: 18 }, raised);

    assert.equal(allotmentForCycle(next, 'SEO', NOV), 20);
    assert.equal(allotmentForCycle(next, 'SEO', DEC), 10);
    assert.equal(allotmentForCycle(next, 'SEO', JAN), 18);
  });

  it('cancels a pending reduction when the amount is set back to this cycle', () => {
    const pending = clientWith(
      { SEO: 10 },
      scheduleRetainerAllotmentChanges(clientWith({ SEO: 20 }), { SEO: 10 }, {
        currentCycleStart: NOV,
        nextCycleStart: DEC,
      }),
    );
    const restored = scheduleRetainerAllotmentChanges(pending, { SEO: 20 }, {
      currentCycleStart: NOV,
      nextCycleStart: DEC,
    });
    const next = clientWith({ SEO: 20 }, restored);

    assert.equal(allotmentForCycle(next, 'SEO', OCT), 20);
    assert.equal(allotmentForCycle(next, 'SEO', DEC), 20);
    assert.deepEqual(restored.retainerAllotmentSchedule.SEO, undefined);
  });

  it('applies a brand-new category immediately', () => {
    const prev = clientWith({});
    const scheduled = scheduleRetainerAllotmentChanges(prev, { SEO: 8 }, {
      currentCycleStart: NOV,
      nextCycleStart: DEC,
    });
    const next = clientWith({ SEO: 8 }, scheduled);
    assert.equal(allotmentForCycle(next, 'SEO', NOV), 8);
    assert.equal(allotmentForCycle(next, 'SEO', DEC), 8);
  });
});

describe('computeGlobalRetainerStats allotment history', () => {
  it('carries unused hours from past cycles at the old allotment', () => {
    const scheduled = scheduleRetainerAllotmentChanges(clientWith({ SEO: 20 }), { SEO: 10 }, {
      currentCycleStart: NOV,
      nextCycleStart: DEC,
    });
    const client = clientWith({ SEO: 10 }, scheduled);
    const octoberTask = {
      clientId: 'c1',
      projectName: 'SEO',
      status: 'completed',
      clockInTime: OCT + 3600000,
      clockOutTime: OCT + 3600000 + 5 * 3600000,
      duration: 5 * 3600000,
    };
    const december = computeGlobalRetainerStats(client, DEC, JAN - 1, {
      taskLogs: [octoberTask],
    });
    const october = computeGlobalRetainerStats(client, OCT, NOV - 1, {
      taskLogs: [octoberTask],
    });

    assert.equal(october.perCategory.SEO.baseActive, 20);
    assert.equal(december.perCategory.SEO.baseActive, 10);
    // October leftover 15, plus November's full 20, carried into December.
    assert.ok(Math.abs(december.perCategory.SEO.carryover - 35) < 0.05);
  });
});
