/**
 * Slack notification functions for Time Tracker.
 *
 * Configuration lives in Firestore at settings/notifications:
 *   slackWebhookUrl        string  — Slack incoming webhook URL (required)
 *   notifyIdleClockOut     bool    — default true
 *   notifyLongShift        bool    — default true
 *   longShiftHours         number  — default 12
 *   notifyProjectRequests  bool    — default true
 *   notifyEstimateDecisions bool   — default true
 *
 * The admin dashboard (Config tab) writes this doc; functions only read it.
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const DEFAULTS = {
  notifyIdleClockOut: true,
  notifyLongShift: true,
  longShiftHours: 12,
  notifyProjectRequests: true,
  notifyEstimateDecisions: true,
};

async function getNotifyConfig() {
  const snap = await db.doc('settings/notifications').get();
  const data = snap.exists ? snap.data() : {};
  return { ...DEFAULTS, ...data };
}

async function postToSlack(webhookUrl, text) {
  if (!webhookUrl) {
    logger.info('Slack webhook not configured; skipping notification.');
    return;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      logger.error(`Slack responded ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    logger.error('Slack post failed', err);
  }
}

const fmtHM = (ms) => {
  const totalMinutes = Math.round(Number(ms || 0) / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
};

const fmtWhen = (ms) =>
  new Date(Number(ms)).toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

// 1. Idle failsafe fired: a shift was auto clocked out.
exports.onShiftAutoClockOut = onDocumentUpdated('timesheets/{shiftId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;

  const becameIdleStopped =
    after.status === 'completed' &&
    after.autoStoppedReason === 'idle_timeout' &&
    !(before.status === 'completed' && before.autoStoppedReason === 'idle_timeout');
  if (!becameIdleStopped) return;

  const cfg = await getNotifyConfig();
  if (!cfg.notifyIdleClockOut) return;

  await postToSlack(
    cfg.slackWebhookUrl,
    `:warning: *Auto clock-out (idle)* — ${after.employeeName || 'Unknown'} was clocked out automatically after no kiosk activity.\n` +
      `Shift: ${fmtWhen(after.clockInTime)} → ${fmtWhen(after.clockOutTime)} (${fmtHM(after.duration)})\n` +
      `Please verify this shift in Timesheets before payroll.`,
  );
});

// 2. New project request from the client portal.
exports.onProjectRequested = onDocumentCreated('projects/{projectId}', async (event) => {
  const p = event.data?.data();
  if (!p || p.status !== 'requested') return;

  const cfg = await getNotifyConfig();
  if (!cfg.notifyProjectRequests) return;

  const desc = String(p.requestDescription || p.description || '').slice(0, 300);
  await postToSlack(
    cfg.slackWebhookUrl,
    `:clipboard: *New project request* from *${p.clientName || 'a client'}*: ${p.title || 'Untitled'}` +
      (desc ? `\n> ${desc}` : ''),
  );
});

// 3. Client approved or rejected an estimate.
exports.onEstimateDecision = onDocumentUpdated('projects/{projectId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;

  const decided =
    before.status !== after.status &&
    (after.status === 'approved' || after.status === 'rejected');
  if (!decided) return;

  const cfg = await getNotifyConfig();
  if (!cfg.notifyEstimateDecisions) return;

  const emoji = after.status === 'approved' ? ':white_check_mark:' : ':x:';
  const hours = Number(after.estimate?.hours || after.estimatedHours || 0);
  const cost = Number(after.estimate?.cost || after.estimatedBudget || 0);
  await postToSlack(
    cfg.slackWebhookUrl,
    `${emoji} *Estimate ${after.status}* — ${after.clientName || 'Client'}: ${after.title || 'Untitled'}` +
      (hours || cost
        ? `\nEstimate: ${hours.toFixed(1)}h / $${cost.toFixed(2)}`
        : ''),
  );
});

// 4. Server-side safety net: flag shifts still running after N hours, even if
// the kiosk browser was closed (the in-app idle failsafe can't catch that).
exports.longShiftSweep = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'America/Toronto' },
  async () => {
    const cfg = await getNotifyConfig();
    if (!cfg.notifyLongShift || !cfg.slackWebhookUrl) return;

    const maxMs = Math.max(1, Number(cfg.longShiftHours || 12)) * 3600000;
    const cutoff = Date.now() - maxMs;

    const snap = await db
      .collection('timesheets')
      .where('status', 'in', ['active', 'break'])
      .get();

    for (const docSnap of snap.docs) {
      const shift = docSnap.data();
      if (Number(shift.clockInTime || 0) >= cutoff) continue;
      if (shift.longShiftAlertSent) continue;

      await postToSlack(
        cfg.slackWebhookUrl,
        `:hourglass_flowing_sand: *Long-running shift* — ${shift.employeeName || 'Unknown'} has been clocked in since ` +
          `${fmtWhen(shift.clockInTime)} (over ${Math.floor(maxMs / 3600000)}h). ` +
          `They may have forgotten to clock out — you can force clock-out from Timesheets.`,
      );
      await docSnap.ref.update({ longShiftAlertSent: true });
    }
  },
);

/**
 * Auto clock-out abandoned shifts using lastActivityAt heartbeats from the app.
 * Runs even when the browser is closed — the client failsafe cannot.
 * Uses settings/policy idleFailsafeMinutes (+ confirm seconds) with a floor of 2h.
 */
exports.idleShiftSweep = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'America/Toronto' },
  async () => {
    const policySnap = await db.doc('settings/policy').get();
    const policy = policySnap.exists ? policySnap.data() : {};
    const failsafeMin = Number(policy.idleFailsafeMinutes);
    if (!Number.isFinite(failsafeMin) || failsafeMin <= 0) {
      logger.info('idleShiftSweep: failsafe disabled (idleFailsafeMinutes <= 0)');
      return;
    }
    const confirmSec = Math.max(10, Number(policy.idleFailsafeConfirmSeconds) || 300);
    // Require at least the configured idle window + confirm, with a small grace
    // so a missed heartbeat (tab backgrounded) does not cut people off early.
    const maxIdleMs = failsafeMin * 60 * 1000 + confirmSec * 1000 + 3 * 60 * 1000;
    const now = Date.now();
    const IDLE_TAG =
      '[Clock stopped automatically: session was idle — Ignite PM server]';

    const snap = await db
      .collection('timesheets')
      .where('status', 'in', ['active', 'break'])
      .get();

    let stopped = 0;
    for (const docSnap of snap.docs) {
      const shift = docSnap.data();
      const lastActivity = Number(
        shift.lastActivityAt ||
          shift.lastResumeTime ||
          shift.clockInTime ||
          0,
      );
      if (!lastActivity || now - lastActivity < maxIdleMs) continue;

      const endTime = Math.min(lastActivity + maxIdleMs - 3 * 60 * 1000, now);
      try {
        const tasksSnap = await db
          .collection('taskLogs')
          .where('shiftId', '==', docSnap.id)
          .where('status', '==', 'active')
          .get();

        for (const taskDoc of tasksSnap.docs) {
          const task = taskDoc.data();
          const segment = Math.max(
            0,
            endTime - Number(task.lastResumeTime || task.clockInTime || endTime),
          );
          const newTotal = Number(task.totalSavedDuration || 0) + segment;
          const base = String(task.notes || '').trim();
          await taskDoc.ref.update({
            clockOutTime: endTime,
            status: 'completed',
            totalSavedDuration: newTotal,
            duration: newTotal,
            notes: base ? `${base}\n\n${IDLE_TAG}` : IDLE_TAG,
            autoStoppedReason: 'idle_timeout',
            autoStoppedAt: endTime,
            autoStoppedSource: 'server',
          });
        }

        let newTotal = Number(shift.totalSavedDuration || 0);
        if (shift.status === 'active') {
          newTotal += Math.max(
            0,
            endTime - Number(shift.lastResumeTime || shift.clockInTime || endTime),
          );
        }
        await docSnap.ref.update({
          clockOutTime: endTime,
          status: 'completed',
          totalSavedDuration: newTotal,
          duration: newTotal,
          autoStoppedReason: 'idle_timeout',
          autoStoppedAt: endTime,
          autoStoppedSource: 'server',
          shiftNote: IDLE_TAG,
        });
        stopped += 1;
        logger.info(
          `idleShiftSweep: stopped shift ${docSnap.id} for ${shift.employeeName || shift.userId}`,
        );
      } catch (err) {
        logger.error(`idleShiftSweep failed for ${docSnap.id}`, err);
      }
    }

    if (stopped) {
      const cfg = await getNotifyConfig();
      if (cfg.notifyIdleClockOut && cfg.slackWebhookUrl) {
        await postToSlack(
          cfg.slackWebhookUrl,
          `:warning: *Server auto clock-out* — stopped ${stopped} abandoned shift${
            stopped === 1 ? '' : 's'
          } with no activity heartbeat (browser likely closed). Verify in Timesheets.`,
        );
      }
    }
  },
);
