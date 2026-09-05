# Hydro 8.4.14

PWA per il monitoraggio dell'idratazione, con account Firebase, sincronizzazione Firestore, uso offline e notifiche Web Push/FCM.

## Novità 8.4.14
- Corretto il problema delle date: Hydro usa ora la **data locale** del dispositivo, non la data UTC, per registrazioni, calendario e statistiche.
- Aggiunta una migrazione automatica dei dati creati dalle versioni precedenti che usavano chiavi data UTC.
- Il giorno corrente viene aggiornato anche se l'app resta aperta durante il passaggio di mezzanotte.
- Corretto anche il selettore lato scheduler: i promemoria leggono il giorno locale dell'utente in base al suo fuso orario.
- Aggiornato GitHub Actions a **Node.js 24**.
- Aggiunto un vero test push dall’app: Hydro crea una richiesta in Firestore e GitHub Actions la invia tramite FCM, senza Firebase Cloud Functions a pagamento.
- Lo scheduler ora stampa un riepilogo diagnostico dei motivi per cui una notifica è stata inviata o saltata.
- Il workflow usa esplicitamente il fuso **Europe/Rome**; GitHub documenta che i cron possono usare un fuso IANA e che l’intervallo minimo è 5 minuti.
- Pulita l'architettura dello scheduler: l'invio automatico usa GitHub Actions.
- Rimasto invariato il comportamento già testato: fascia 08:00–22:00, intervalli 30/45/60/90/120 min, modalità smart, più dispositivi e rimozione dei token FCM non validi.

## Architettura gratuita

Il flusso automatico è:

**Hydro → token FCM → Firestore → GitHub Actions → FCM → iPhone**

Firebase viene usato per:
1. **Authentication → Email/Password** per gli account.
2. **Cloud Firestore** per dati, profilo e token push.
3. **Firebase Cloud Messaging (FCM)** per le notifiche.

La pianificazione dei promemoria viene eseguita da **GitHub Actions ogni 5 minuti**. Questo mantiene lo scheduler separato dal piano di fatturazione Firebase/Google Cloud.

## Sicurezza

La chiave VAPID pubblica e la configurazione Web Firebase possono stare nel client. **Non inserire mai nel repository, nel codice client o in chat la chiave privata VAPID o il JSON privato del Service Account.**

Il JSON del Service Account viene conservato esclusivamente nel secret GitHub:

`FIREBASE_SERVICE_ACCOUNT_JSON`

## Firestore

Ogni account usa `users/{uid}`. I token push sono salvati in:

`users/{uid}/pushTokens/{tokenId}`

Le regole consentono all'utente autenticato di accedere solo al proprio documento e ai propri token.

## GitHub Actions

Il workflow è:

`.github/workflows/hydro-push-reminders.yml`

Esegue il controllo ogni 5 minuti e può essere avviato manualmente da **Actions → Hydro Push Reminders → Run workflow**.

Il job usa Node.js 24 e il solo pacchetto `firebase-admin` per leggere Firestore e inviare i messaggi FCM.

> Nota: GitHub può ritardare occasionalmente l'avvio di un workflow pianificato. Per questo un promemoria può arrivare qualche minuto dopo l'orario teorico, ma il controllo resta ogni 5 minuti.

## Notifiche Web Push / FCM

Per attivare le notifiche:
1. accedere a Hydro;
2. aprire le impostazioni/promemoria;
3. autorizzare le notifiche;
4. verificare che compaia **Dispositivo registrato / ATTIVE**.

Il pulsante **Invia notifica di prova** ora esegue un vero test end-to-end: registra il dispositivo, crea una richiesta `pushTestRequests` e attende il successivo controllo di GitHub Actions (entro circa 5 minuti). Non serve più aprire la console Firebase per il test normale.

## iPhone

Per ricevere Web Push su iPhone/iPadOS, Hydro deve essere installato nella schermata Home tramite Safari. Il dispositivo deve inoltre essere online quando il messaggio viene consegnato.

## Offline e sincronizzazione

Hydro continua a registrare i dati sul dispositivo quando non c'è connessione. Quando la connessione torna disponibile, i dati vengono sincronizzati con Firestore. I promemoria automatici vengono calcolati da GitHub Actions leggendo i dati sincronizzati nel cloud.

## Regole Firestore

Per pubblicare le regole: 

```bash
firebase deploy --only firestore:rules
```

Il file `firebase.json` contiene solo la configurazione Firestore.
