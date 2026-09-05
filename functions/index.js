const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const VERSION = "8.4.10";
const REGION = "europe-west1";
const ACTIVE_START_MIN = 8 * 60;
const ACTIVE_END_MIN = 22 * 60;
const CHECK_EVERY_MIN = 5;

// Endpoint di verifica: non invia notifiche. Serve per controllare che le Functions siano deployate.
exports.pushHealth = onRequest({region: REGION}, (req, res) => {
  res.status(200).json({ok: true, service: "hydro-push", version: VERSION});
});

function getLocalParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const out = {};
  for (const p of parts) if (p.type !== "literal") out[p.type] = p.value;
  return {
    date: `${out.year}-${out.month}-${out.day}`,
    minutes: Number(out.hour) * 60 + Number(out.minute),
    hour: Number(out.hour),
    minute: Number(out.minute),
  };
}

function minutesFromHHMM(value) {
  const m = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function getTodayEntries(payload, utcDate) {
  // Hydro currently keys its daily data with Date#toISOString().slice(0,10),
  // i.e. the UTC calendar date. Keep the scheduler aligned with the app data model.
  const data = payload?.data || {};
  return Array.isArray(data[utcDate]) ? data[utcDate] : [];
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
    if (m == null) continue;
    // Times around midnight are ambiguous because Hydro stores only HH:MM.
    // For the active 08:00–22:00 window a simple same-day comparison is reliable.
    if (m <= local.minutes && (latest == null || m > latest)) latest = m;
  }
  return latest == null ? null : local.minutes - latest;
}

async function getTokens(userRef) {
  const snap = await userRef.collection("pushTokens").where("enabled", "==", true).get();
  const rows = [];
  snap.forEach((doc) => {
    const token = doc.data()?.token;
    if (typeof token === "string" && token.length > 20) rows.push({id: doc.id, token});
  });
  return rows;
}

async function sendReminder(userRef, user, local, totalMl, goal) {
  const tokenRows = await getTokens(userRef);
  if (!tokenRows.length) return {sent: 0, removed: 0};

  const remaining = Math.max(goal - totalMl, 0);
  const title = "💧 È il momento di bere";
  const body = remaining > 0
    ? `Hai bevuto ${totalMl.toLocaleString("it-IT")} ml su ${goal.toLocaleString("it-IT")} ml. Un po' d'acqua adesso ti aiuta a continuare.`
    : "Hai raggiunto il tuo obiettivo di oggi. Continua così!";

  const response = await messaging.sendEachForMulticast({
    tokens: tokenRows.map((x) => x.token),
    notification: {title, body},
    data: {
      type: "hydro_reminder",
      date: local.date,
      remainingMl: String(remaining),
      totalMl: String(totalMl),
      goalMl: String(goal),
      url: "https://martiechelon93.github.io/Hydro/",
    },
    webpush: {
      fcmOptions: {link: "https://martiechelon93.github.io/Hydro/"},
      notification: {
        icon: "https://martiechelon93.github.io/Hydro/icon-192.png",
        badge: "https://martiechelon93.github.io/Hydro/icon-192.png",
        tag: "hydro-reminder",
      },
    },
  });

  let removed = 0;
  const deletes = [];
  response.responses.forEach((result, index) => {
    const code = result.error?.code || "";
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
      deletes.push(tokenRows[index].id);
    }
  });
  for (const id of deletes) {
    await userRef.collection("pushTokens").doc(id).delete().catch(() => {});
    removed++;
  }

  return {sent: response.successCount, removed};
}

// Controlla ogni 5 minuti gli utenti con promemoria attivi e invia un push quando
// è trascorso l'intervallo previsto. La logica usa il fuso orario salvato nel profilo.
exports.pushScheduler = onSchedule({
  schedule: "*/5 * * * *",
  timeZone: "UTC",
  region: REGION,
}, async () => {
  const users = await db.collection("users").where("payload.hydroPrefs.remOn", "==", true).get();
  let checked = 0;
  let sent = 0;
  let removed = 0;

  for (const userDoc of users.docs) {
    checked++;
    const user = userDoc.data() || {};
    const payload = user.payload || {};
    const prefs = payload.hydroPrefs || {};
    let timeZone = prefs.timezone || "Europe/Rome";
    let local;
    try {
      local = getLocalParts(new Date(), timeZone);
    } catch (error) {
      console.warn(`Invalid timezone for ${userDoc.id}: ${timeZone}; using Europe/Rome`);
      timeZone = "Europe/Rome";
      local = getLocalParts(new Date(), timeZone);
    }

    if (local.minutes < ACTIVE_START_MIN || local.minutes >= ACTIVE_END_MIN) continue;

    const goal = Math.max(500, Number(payload.goal) || 2000);
    const utcDate = new Date().toISOString().slice(0, 10);
    const entries = getTodayEntries(payload, utcDate);
    const totalMl = entries.reduce((sum, x) => sum + (Number(x?.ml) || 0), 0);
    if (totalMl >= goal) continue;

    const interval = calculateReminderInterval(prefs, totalMl, goal);
    const userRef = userDoc.ref;
    const state = user.reminderState || {};
    const reminderKey = `${local.date}-${String(local.minutes).padStart(4, "0")}`;

    // Avoid duplicate delivery if Cloud Scheduler retries the same invocation.
    if (state.lastReminderKey === reminderKey) continue;

    const lastDrinkAgo = lastDrinkMinutesAgo(entries, local);
    if (lastDrinkAgo != null && lastDrinkAgo < interval) continue;

    // First reminder of the day starts after the configured interval from 08:00.
    // Subsequent reminders are spaced by the same effective interval.
    const lastSentAt = state.lastSentAtMs ? Number(state.lastSentAtMs) : 0;
    if (lastSentAt) {
      const elapsed = Math.floor((Date.now() - lastSentAt) / 60000);
      if (elapsed < interval) continue;
    } else if (local.minutes < ACTIVE_START_MIN + interval) {
      continue;
    }

    try {
      const result = await sendReminder(userRef, user, local, totalMl, goal);
      if (result.sent > 0) {
        sent += result.sent;
        removed += result.removed;
        await userRef.set({
          reminderState: {
            lastReminderKey: reminderKey,
            lastSentAtMs: Date.now(),
            lastSentDate: local.date,
            lastSentTime: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
            version: VERSION,
          },
        }, {merge: true});
      } else if (result.removed > 0) {
        removed += result.removed;
      }
    } catch (error) {
      console.error(`Hydro reminder failed for ${userDoc.id}`, error);
    }
  }

  console.log(`Hydro pushScheduler ${VERSION}: checked=${checked}, sent=${sent}, removed=${removed}`);
});
