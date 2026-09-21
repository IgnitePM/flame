import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTasksForShift,
  getUnassignedTasks,
  getDerivedShiftWindow,
  isTaskOutsideShiftWindow,
  describeTaskOutsideWindow,
  resolveShiftIdForTask,
  planShiftIdBackfill,
} from './shiftTaskAssociation.js';

const T0 = 1_700_000_000_000; // fixed epoch ms

describe('getTasksForShift', () => {
  it('associates by shiftId only, including tasks outside the shift window', () => {
    const shift = { id: 's1', clockInTime: T0 + 60_000, clockOutTime: T0 + 3_600_000 };
    const tasks = [
      { id: 'a', shiftId: 's1', clockInTime: T0 + 59_000, clockOutTime: T0 + 120_000 }, // 1s before
      { id: 'b', shiftId: 's1', clockInTime: T0 + 100_000, clockOutTime: T0 + 3_601_000 }, // 1s after
      { id: 'c', shiftId: 'other', clockInTime: T0 + 100_000, clockOutTime: T0 + 200_000 },
      { id: 'd', shiftId: null, clockInTime: T0 + 100_000, clockOutTime: T0 + 200_000 },
    ];
    const linked = getTasksForShift(tasks, shift.id);
    assert.deepEqual(
      linked.map((t) => t.id).sort(),
      ['a', 'b'],
    );
  });
});

describe('isTaskOutsideShiftWindow', () => {
  it('flags tasks that start before or end after the stored shift window', () => {
    const shift = { id: 's1', clockInTime: T0 + 60_000, clockOutTime: T0 + 3_600_000 };
    const early = {
      id: 'a',
      shiftId: 's1',
      clockInTime: T0 + 59_000,
      clockOutTime: T0 + 120_000,
    };
    const late = {
      id: 'b',
      shiftId: 's1',
      clockInTime: T0 + 100_000,
      clockOutTime: T0 + 3_601_000,
    };
    const inside = {
      id: 'c',
      shiftId: 's1',
      clockInTime: T0 + 60_000,
      clockOutTime: T0 + 3_600_000,
    };
    assert.equal(isTaskOutsideShiftWindow(early, shift), true);
    assert.equal(isTaskOutsideShiftWindow(late, shift), true);
    assert.equal(isTaskOutsideShiftWindow(inside, shift), false);
    assert.match(describeTaskOutsideWindow(early, shift), /before/);
    assert.match(describeTaskOutsideWindow(late, shift), /after/);
  });
});

describe('getDerivedShiftWindow', () => {
  it('uses min clock-in and max clock-out across tasks', () => {
    const tasks = [
      { clockInTime: T0 + 100_000, clockOutTime: T0 + 200_000 },
      { clockInTime: T0 + 50_000, clockOutTime: T0 + 150_000 },
      { clockInTime: T0 + 80_000, clockOutTime: T0 + 400_000 },
    ];
    assert.deepEqual(getDerivedShiftWindow(tasks), {
      start: T0 + 50_000,
      end: T0 + 400_000,
    });
  });

  it('returns null when there are no tasks', () => {
    assert.equal(getDerivedShiftWindow([]), null);
  });
});

describe('getUnassignedTasks', () => {
  it('lists tasks with missing or unknown shiftId', () => {
    const shifts = [{ id: 's1' }];
    const tasks = [
      { id: 'a', shiftId: 's1' },
      { id: 'b', shiftId: 'gone' },
      { id: 'c', shiftId: null },
      { id: 'd' },
    ];
    assert.deepEqual(
      getUnassignedTasks(tasks, shifts)
        .map((t) => t.id)
        .sort(),
      ['b', 'c', 'd'],
    );
  });
});

describe('resolveShiftIdForTask / planShiftIdBackfill', () => {
  it('keeps an existing valid shiftId', () => {
    const shifts = [
      {
        id: 's1',
        userId: 'u1',
        clockInTime: T0,
        clockOutTime: T0 + 3_600_000,
      },
    ];
    const task = {
      id: 't1',
      shiftId: 's1',
      userId: 'u1',
      clockInTime: T0 - 1000,
      clockOutTime: T0 + 1000,
    };
    const r = resolveShiftIdForTask(task, shifts);
    assert.equal(r.shiftId, 's1');
    assert.equal(r.method, 'existing');
  });

  it('backfills via clock-out containment then nearest fallback', () => {
    const shifts = [
      {
        id: 'early',
        userId: 'u1',
        employeeName: 'Ada',
        clockInTime: T0 - 10_000_000,
        clockOutTime: T0 - 9_000_000,
      },
      {
        id: 'right',
        userId: 'u1',
        employeeName: 'Ada',
        clockInTime: T0 + 60_000,
        clockOutTime: T0 + 3_600_000,
      },
    ];
    // Task ends inside "right" but started slightly before it
    const orphan = {
      id: 't-orphan',
      shiftId: null,
      userId: 'u1',
      employeeName: 'Ada',
      clockInTime: T0 + 59_000,
      clockOutTime: T0 + 120_000,
    };
    const r = resolveShiftIdForTask(orphan, shifts);
    assert.equal(r.shiftId, 'right');
    assert.equal(r.method, 'clock_out_containment');

    const plan = planShiftIdBackfill([orphan], shifts);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].to, 'right');
    assert.equal(plan[0].from, null);
  });

  it('uses nearest-shift fallback when no containment/overlap', () => {
    const shifts = [
      {
        id: 'far',
        userId: 'u1',
        clockInTime: T0 - 86_400_000,
        clockOutTime: T0 - 80_000_000,
      },
      {
        id: 'near',
        userId: 'u1',
        clockInTime: T0 + 5_000,
        clockOutTime: T0 + 10_000,
      },
    ];
    // Completely disjoint from both windows
    const task = {
      id: 't2',
      shiftId: 'deleted',
      userId: 'u1',
      clockInTime: T0 + 100_000,
      clockOutTime: T0 + 200_000,
    };
    const r = resolveShiftIdForTask(task, shifts);
    assert.equal(r.shiftId, 'near');
    assert.equal(r.method, 'nearest_shift');
  });
});
