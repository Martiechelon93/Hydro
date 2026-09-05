const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();

// Endpoint di verifica: non invia notifiche. Serve per controllare che le Functions siano deployate.
exports.pushHealth = onRequest({region:"europe-west1"}, (req, res) => {
  res.status(200).json({ok:true, service:"hydro-push", version:"8.4.9"});
});

// Placeholder per la fase 2: qui verrà inserita la logica dei promemoria automatici.
// Non invia nulla finché non configuriamo frequenza, fascia oraria e logica intelligente.
exports.pushSchedulerPlaceholder = onSchedule({schedule:"0 4 * * *", timeZone:"Europe/Rome", region:"europe-west1"}, async () => {
  console.log("Hydro push scheduler placeholder: no messages sent.");
});
