const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();
const messaging = admin.messaging();
const VERSION = '8.4.16';
const DEFAULT_ACTIVE_START_MIN = 8 * 60;
const DEFAULT_ACTIVE_END_MIN = 22 * 60;

function getLocalParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const out = {};
  for (const p of parts) if (p.type !== 'literal') out[p.type] = p.value;
  return {
    date: `${out.year}-${out.month}-${out.day}`,
    minutes: Number(out.hour) * 60 + Number(out.minute),
    hour: Number(out.hour), minute: Number(out.minute),
  };
}

function minutesFromHHMM(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function getActiveWindow(prefs) {
  const start = minutesFromHHMM(prefs.remStart);
  const end = minutesFromHHMM(prefs.remEnd);
  if (start == null || end == null || start >= end) {
    return {start: DEFAULT_ACTIVE_START_MIN, end: DEFAULT_ACTIVE_END_MIN};
  }
  return {start, end};
}

function calculateReminderInterval(prefs, totalMl, goal) {
  const base = Math.max(30, Number(prefs.interval) || 60);
  let minutes = base;
  if (prefs.drinkSmart && totalMl < goal * 0.4) minutes = Math.max(30, base - 15);
  if (prefs.smart && totalMl > goal * 0.75) minutes = Math.min(120, base + 15);
  return minutes;
}

function lastDrinkMinutesAgo(entries, local) {
  let latest = null;
  for (const entry of entries) {
    const m = minutesFromHHMM(entry?.time);
    if (m == null || m > local.minutes) continue;
    if (latest == null || m > latest) latest = m;
  }
  return latest == null ? null : local.minutes - latest;
}

async function getTokens(userRef) {
  const snap = await userRef.collection('pushTokens').where('enabled', '==', true).get();
  return snap.docs.map(doc => ({id: doc.id, token: doc.data()?.token}))
    .filter(x => typeof x.token === 'string' && x.token.length > 20);
}

async function sendReminder(userRef, local, totalMl, goal) {
  const tokenRows = await getTokens(userRef);
  if (!tokenRows.length) return {sent: 0, removed: 0};
  const remaining = Math.max(goal - totalMl, 0);
  const response = await messaging.sendEachForMulticast({
    tokens: tokenRows.map(x => x.token),
    data: {
      type: 'hydro_reminder', date: local.date,
      title: '💧 È il momento di bere',
      body: remaining > 0
        ? `Hai bevuto ${totalMl.toLocaleString('it-IT')} ml su ${goal.toLocaleString('it-IT')} ml. Un po\' d\'acqua adesso ti aiuta a continuare.`
        : 'Hai raggiunto il tuo obiettivo di oggi. Continua così!',
      remainingMl: String(remaining), totalMl: String(totalMl), goalMl: String(goal),
      url: 'https://martiechelon93.github.io/Hydro/',
    },
    webpush: {
      fcmOptions: {link: 'https://martiechelon93.github.io/Hydro/'},
    },
  });
  const deletes = [];
  response.responses.forEach((result, i) => {
    const code = result.error?.code || '';
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') deletes.push(tokenRows[i].id);
  });
  for (const id of deletes) await userRef.collection('pushTokens').doc(id).delete().catch(() => {});
  return {sent: response.successCount, removed: deletes.length};
}

async function sendTestPush(userRef, local, requestedTokenId) {
  let tokenRows;
  if (requestedTokenId) {
    const doc = await userRef.collection('pushTokens').doc(requestedTokenId).get();
    const token = doc.exists ? doc.data()?.token : null;
    tokenRows = typeof token === 'string' && token.length > 20 ? [{id: requestedTokenId, token}] : [];
  } else {
    tokenRows = await getTokens(userRef);
  }
  if (!tokenRows.length) return {sent: 0, removed: 0};
  if (!tokenRows.length) return {sent: 0, removed: 0};
  const response = await messaging.sendEachForMulticast({
    tokens: tokenRows.map(x => x.token),
    data: {
      type: 'hydro_test', date: local.date,
      title: 'Hydro · test push',
      body: 'La notifica push di prova di Hydro funziona!',
      url: 'https://martiechelon93.github.io/Hydro/'
    },
    webpush: {
      fcmOptions: {link: 'https://martiechelon93.github.io/Hydro/'}
    }
  });
  const deletes = [];
  response.responses.forEach((result, i) => {
    const code = result.error?.code || '';
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') deletes.push(tokenRows[i].id);
  });
  for (const id of deletes) await userRef.collection('pushTokens').doc(id).delete().catch(() => {});
  return {sent: response.successCount, removed: deletes.length, errors: response.failureCount};
}

async function processTestRequests(userDoc, local, stats) {
  const ref = userDoc.ref.collection('pushTestRequests');
  const snap = await ref.where('status', '==', 'pending').get();
  if (snap.empty) return;
  stats.testRequests += snap.size;
  for (const doc of snap.docs) {
    const req = doc.data() || {};
    const requestedAt = Number(req.requestedAtMs) || 0;
    if (requestedAt && Date.now() - requestedAt > 24 * 60 * 60 * 1000) {
      await doc.ref.set({status: 'expired', processedAtMs: Date.now(), version: VERSION}, {merge: true});
      stats.testExpired++;
      continue;
    }
    try {
      const result = await sendTestPush(userDoc.ref, local, req.tokenId || '');
      if (result.sent > 0) {
        await doc.ref.set({status: 'sent', sentAtMs: Date.now(), sentCount: result.sent, removedTokens: result.removed, version: VERSION}, {merge: true});
        stats.testSent += result.sent;
      } else {
        await doc.ref.set({status: 'error', error: 'Nessun token FCM attivo su questo dispositivo.', processedAtMs: Date.now(), removedTokens: result.removed, version: VERSION}, {merge: true});
        stats.testNoToken++;
      }
      stats.removed += result.removed;
    } catch (error) {
      console.error(`Hydro test push failed for ${userDoc.id}/${doc.id}`, error);
      await doc.ref.set({status: 'error', error: String(error?.message || error), processedAtMs: Date.now(), version: VERSION}, {merge: true});
      stats.testErrors++;
    }
  }
}

async function main() {
  const users = await db.collection('users').get();
  const stats = {
    users: users.size, checked: 0, eligible: 0, sent: 0, removed: 0,
    outsideHours: 0, goalReached: 0, duplicate: 0, recentDrink: 0,
    recentSend: 0, startupWait: 0, noTokens: 0, errors: 0,
    testRequests: 0, testSent: 0, testNoToken: 0, testErrors: 0, testExpired: 0
  };
  const now = new Date();

  for (const userDoc of users.docs) {
    stats.checked++;
    const user = userDoc.data() || {};
    const payload = user.payload || {};
    const prefs = payload.hydroPrefs || {};
    let timeZone = prefs.timezone || 'Europe/Rome';
    let local;
    try { local = getLocalParts(now, timeZone); }
    catch { timeZone = 'Europe/Rome'; local = getLocalParts(now, timeZone); }

    // A test request is independent of reminder settings, hours, goal and interval.
    try { await processTestRequests(userDoc, local, stats); }
    catch (error) { console.error(`Hydro test request scan failed for ${userDoc.id}`, error); stats.testErrors++; }

    if (prefs.remOn !== true) continue;
    const activeWindow = getActiveWindow(prefs);
    if (local.minutes < activeWindow.start || local.minutes >= activeWindow.end) { stats.outsideHours++; continue; }

    const goal = Math.max(500, Number(payload.goal) || 2000);
    const entries = Array.isArray(payload.data?.[local.date]) ? payload.data[local.date] : [];
    const totalMl = entries.reduce((sum, x) => sum + (Number(x?.ml) || 0), 0);
    if (totalMl >= goal) { stats.goalReached++; continue; }

    const interval = calculateReminderInterval(prefs, totalMl, goal);
    const state = user.reminderState || {};
    const reminderKey = `${local.date}-${String(local.minutes).padStart(4, '0')}`;
    if (state.lastReminderKey === reminderKey) { stats.duplicate++; continue; }
    const lastDrinkAgo = lastDrinkMinutesAgo(entries, local);
    if (lastDrinkAgo != null && lastDrinkAgo < interval) { stats.recentDrink++; continue; }
    const lastSentAt = Number(state.lastSentAtMs) || 0;
    if (lastSentAt) {
      if (Math.floor((Date.now() - lastSentAt) / 60000) < interval) { stats.recentSend++; continue; }
    } else if (local.minutes < activeWindow.start + interval) { stats.startupWait++; continue; }

    stats.eligible++;
    try {
      const result = await sendReminder(userDoc.ref, local, totalMl, goal);
      stats.sent += result.sent; stats.removed += result.removed;
      if (result.sent > 0) {
        await userDoc.ref.set({reminderState: {
          lastReminderKey: reminderKey,
          lastSentAtMs: Date.now(), lastSentDate: local.date,
          lastSentTime: `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`,
          version: VERSION,
        }}, {merge: true});
      } else {
        stats.noTokens++;
      }
    } catch (error) {
      stats.errors++;
      console.error(`Hydro reminder failed for ${userDoc.id}`, error);
    }
  }

  console.log(`Hydro GitHub push scheduler ${VERSION}`);
  console.log(JSON.stringify({
    users: stats.users,
    checked: stats.checked,
    eligible: stats.eligible,
    notificationsSent: stats.sent,
    invalidTokensRemoved: stats.removed,
    skipped: {
      outsideHours: stats.outsideHours,
      goalReached: stats.goalReached,
      duplicate: stats.duplicate,
      recentDrink: stats.recentDrink,
      recentSend: stats.recentSend,
      startupWait: stats.startupWait,
      noTokens: stats.noTokens
    },
    test: {
      requests: stats.testRequests,
      sent: stats.testSent,
      noToken: stats.testNoToken,
      errors: stats.testErrors,
      expired: stats.testExpired
    },
    errors: stats.errors
  }, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
