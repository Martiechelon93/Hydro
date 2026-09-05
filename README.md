# Hydro 8.4.11

PWA per il monitoraggio dell'idratazione, con account Firebase, sincronizzazione Firestore, offline e notifiche Web Push/FCM.

## Novità 8.4.11
- Notifiche push FCM già testate con successo su iPhone.
- Nuova Cloud Function `pushScheduler` per i promemoria automatici.
- Controllo ogni 5 minuti degli utenti con promemoria attivi.
- Fascia attiva attuale: 08:00–22:00.
- Rispetta l'intervallo scelto in Hydro (30/45/60/90/120 minuti).
- Modalità smart: modifica l'intervallo in base al consumo, come nell'app.
- Dopo una registrazione recente evita di inviare subito un altro promemoria.
- Supporto a più dispositivi/token per lo stesso account.
- Rimuove automaticamente token FCM non più validi.
- La versione installata è sempre visibile nelle Impostazioni: **8.4.11**.

## Configurazione Firebase

La Web App Firebase è già configurata nel file `index.html`.

Sono utilizzati:
1. **Authentication → Email/Password** per gli account.
2. **Cloud Firestore** per dati e token push.
3. **Firebase Cloud Messaging** per le notifiche.
4. **Cloud Functions** per l'invio automatico dei promemoria.

Non inserire mai nel repository chiavi private o file JSON di Service Account.

## Firestore

Ogni account usa `users/{uid}`. I token push sono salvati in:

`users/{uid}/pushTokens/{tokenId}`

Le regole devono consentire all'utente autenticato di accedere solo al proprio documento e ai propri token.

## Notifiche Web Push / FCM

Il flusso automatico è:

**Hydro → token FCM → Firestore → Cloud Function → FCM → iPhone**

La chiave VAPID pubblica è presente nel client. La chiave privata non deve mai essere inserita in Hydro o in GitHub.

### Pubblicazione delle regole

```bash
firebase deploy --only firestore:rules
```

### Pubblicazione della Cloud Function

Dalla cartella principale del progetto:

```bash
firebase login
firebase use hydro-f2428
firebase deploy --only functions:pushScheduler,functions:pushHealth
```

La funzione `pushScheduler` viene eseguita ogni 5 minuti e controlla gli utenti con `remOn=true`. Usa il fuso orario salvato nel profilo e la fascia 08:00–22:00.

> Le funzioni pianificate usano Cloud Scheduler e richiedono un progetto Firebase/Google Cloud con fatturazione attiva (piano Blaze). Il costo dipende dall'utilizzo; un singolo job di scheduler è sufficiente per tutti gli utenti di Hydro.

### Test push già eseguito

Per verificare FCM manualmente:
1. accedere a Hydro;
2. autorizzare le notifiche;
3. verificare `pushTokens` in Firestore;
4. usare **Invia messaggio di prova** nella console Firebase Cloud Messaging;
5. incollare il token FCM nel pannello di test.

Questo test è già stato completato con ricezione corretta della notifica su iPhone.

## GitHub Pages

Hydro può continuare a essere pubblicato su GitHub Pages in HTTPS. La PWA resta utilizzabile offline; per ricevere nuove notifiche automatiche il dispositivo deve essere online.

## iPhone

Per Web Push su iPhone/iPadOS:
1. aprire Hydro in Safari;
2. aggiungerlo alla schermata Home;
3. accedere all'account;
4. autorizzare le notifiche;
5. verificare che in Impostazioni compaia **Dispositivo registrato / ATTIVE**.

Se Apple Watch è configurato per inoltrare le notifiche dell'iPhone, può mostrarle secondo le impostazioni di iOS/watchOS.

## Offline e sincronizzazione

Hydro continua a registrare i dati localmente e usa Firestore per la sincronizzazione dell'account. Le notifiche automatiche vengono calcolate lato server, quindi richiedono la connessione del dispositivo al momento della consegna.
