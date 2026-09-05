const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();
const messaging = admin.messaging();
const VERSION = '8.4.11';
const ACTIVE_START_MIN = 8 * 60;
const ACTIVE_END_MIN = 22 * 60;

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
    notification: {
      title: '💧 È il momento di bere',
      body: remaining > 0
        ? `Hai bevuto ${totalMl.toLocaleString('it-IT')} ml su ${goal.toLocaleString('it-IT')} ml. Un po\' d\'acqua adesso ti aiuta a continuare.`
        : 'Hai raggiunto il tuo obiettivo di oggi. Continua così!',
    },
    data: {
      type: 'hydro_reminder', date: local.date,
      remainingMl: String(remaining), totalMl: String(totalMl), goalMl: String(goal),
      url: 'https://martiechelon93.github.io/Hydro/',
    },
    webpush: {
      fcmOptions: {link: 'https://martiechelon93.github.io/Hydro/'},
      notification: {
        icon: 'https://martiechelon93.github.io/Hydro/icon-192.png',
        badge: 'https://martiechelon93.github.io/Hydro/icon-192.png',
        tag: 'hydro-reminder',
      },
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

async function main() {
  const users = await db.collection('users').where('payload.hydroPrefs.remOn', '==', true).get();
  let checked = 0, sent = 0, removed = 0;
  const now = new Date();
  const utcDate = now.toISOString().slice(0, 10);

  for (const userDoc of users.docs) {
    checked++;
    const user = userDoc.data() || {};
    const payload = user.payload || {};
    const prefs = payload.hydroPrefs || {};
    let timeZone = prefs.timezone || 'Europe/Rome';
    let local;
    try { local = getLocalParts(now, timeZone); }
    catch { timeZone = 'Europe/Rome'; local = getLocalParts(now, timeZone); }
    if (local.minutes < ACTIVE_START_MIN || local.minutes >= ACTIVE_END_MIN) continue;

    const goal = Math.max(500, Number(payload.goal) || 2000);
    const entries = Array.isArray(payload.data?.[utcDate]) ? payload.data[utcDate] : [];
    const totalMl = entries.reduce((sum, x) => sum + (Number(x?.ml) || 0), 0);
    if (totalMl >= goal) continue;

    const interval = calculateReminderInterval(prefs, totalMl, goal);
    const state = user.reminderState || {};
    if (state.lastReminderKey === `${local.date}-${String(local.minutes).padStart(4, '0')}`) continue;
    const lastDrinkAgo = lastDrinkMinutesAgo(entries, local);
    if (lastDrinkAgo != null && lastDrinkAgo < interval) continue;
    const lastSentAt = Number(state.lastSentAtMs) || 0;
    if (lastSentAt) {
      if (Math.floor((Date.now() - lastSentAt) / 60000) < interval) continue;
    } else if (local.minutes < ACTIVE_START_MIN + interval) continue;

    try {
      const result = await sendReminder(userDoc.ref, local, totalMl, goal);
      sent += result.sent; removed += result.removed;
      if (result.sent > 0) {
        await userDoc.ref.set({reminderState: {
          lastReminderKey: `${local.date}-${String(local.minutes).padStart(4, '0')}`,
          lastSentAtMs: Date.now(), lastSentDate: local.date,
          lastSentTime: `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`,
          version: VERSION,
        }}, {merge: true});
      }
    } catch (error) { console.error(`Hydro reminder failed for ${userDoc.id}`, error); }
  }
  console.log(`Hydro GitHub push scheduler ${VERSION}: checked=${checked}, sent=${sent}, removed=${removed}`);
}

main().catch(error => { console.error(error); process.exit(1); });
