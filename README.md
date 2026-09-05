# Hydro 8.4.5

PWA statica per il monitoraggio dell'idratazione.

## Novità 8.3.2
- Account multipli con Firebase Authentication (email + password).
- Recupero password tramite Firebase.
- Sincronizzazione dei dati personali con Cloud Firestore.
- Pulsante **Modifica** per correggere le registrazioni di consumo (quantità, bevanda, calorie e orario).
- Possibilità di modificare anche le bevande personalizzate.
- Foto profilo: resta locale senza account; con account viene inclusa nella sincronizzazione.
- Backup Excel (.xlsx).
- Interfaccia azzurra stile iOS, goccia animata e PWA.
- Versione mostrata nelle Impostazioni: **8.3.2**.

## Configurazione Firebase

La Web App Firebase è già configurata nel file `index.html`. Prima della pubblicazione assicurati che siano attivi:

1. **Authentication → Sign-in method → Email/Password**.
2. **Cloud Firestore Database**.

Esempio di struttura (usa i valori forniti dal tuo progetto Firebase):

```js
const FIREBASE_CONFIG={
  apiKey:"...",
  authDomain:"...",
  projectId:"...",
  storageBucket:"...",
  messagingSenderId:"...",
  appId:"..."
};
```

La configurazione Web Firebase destinata al client non contiene una password amministrativa. **Non inserire mai chiavi private/service-account nel file HTML.** La sicurezza dei dati è affidata alle Security Rules di Firestore.

## Firestore

Hydro usa un documento per utente nella collection `users`, con ID uguale al Firebase UID. Il documento contiene il payload di Hydro (`goal`, `data`, `drinks`, `hydroPrefs`).

Attiva le regole di sicurezza e consenti a ogni utente autenticato di leggere/scrivere esclusivamente il proprio documento:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Comportamento della sincronizzazione
- Senza account: Hydro continua a funzionare interamente in locale.
- Primo accesso a un account senza dati cloud: i dati locali vengono associati all'account.
- Account già usato: vengono caricati i dati presenti su Firestore.
- Le modifiche successive vengono sincronizzate automaticamente con un breve ritardo.

## GitHub Pages
Il progetto può continuare a essere pubblicato su GitHub Pages. Firebase Authentication e Firestore funzionano con la PWA servita in HTTPS.

## Notifiche Web Push / Apple Watch
La versione 8.3.2 prepara Hydro per **Firebase Cloud Messaging (FCM)**, così i promemoria possono essere inviati anche quando la PWA non è aperta. Il flusso è: Hydro → token Web Push → Firestore → Cloud Function programmata → FCM → iPhone → eventuale mirroring su Apple Watch. FCM richiede una coppia di chiavi VAPID per il client web.

### 1. Genera la chiave VAPID
In Firebase Console apri **Project settings → Cloud Messaging → Web Push certificates → Generate key pair**. Copia la **chiave pubblica**. È sufficiente inserirla in Hydro nelle Impostazioni → Web Push; non è una chiave segreta.

### 2. Pubblica le regole Firestore aggiornate
Il file `firestore.rules` incluso nel pacchetto aggiunge la sotto-collection `users/{uid}/pushTokens/{tokenId}`. Puoi pubblicarla con:

```bash
firebase deploy --only firestore:rules
```

### 3. Pubblica la Cloud Function
La cartella `functions/` contiene `sendHydroReminders`, che controlla ogni 15 minuti gli utenti con promemoria attivi e invia una notifica se è trascorso l'intervallo impostato. Per pubblicarla:

```bash
firebase login
firebase use hydro-f2428
firebase deploy --only functions:sendHydroReminders
```

La funzione usa le credenziali server gestite da Firebase/Google Cloud: **non inserire service-account JSON nel repository**. Le funzioni pianificate richiedono il servizio di scheduling di Firebase/Google Cloud e possono richiedere un piano Firebase/Cloud con fatturazione attiva.

### 4. Su iPhone
1. Apri Hydro con Safari.
2. Aggiungi Hydro alla schermata Home.
3. Accedi al tuo account.
4. In Impostazioni incolla la chiave VAPID pubblica e salvala.
5. Premi **ATTIVA** nelle notifiche.
6. Accetta il permesso.
7. Usa **Invia notifica di prova** per verificare il permesso locale.
8. Se Apple Watch è configurato per ricevere le notifiche dell'app iPhone, potrà mostrarle quando iOS inoltra la notifica.

> Importante: la notifica di prova mostrata immediatamente da Hydro è locale. La notifica ricorrente con app chiusa arriva invece dalla Cloud Function tramite FCM.


## Nota sicurezza Firebase
La Web API key presente nella configurazione client è una Firebase API key pubblica. Firebase documenta che queste chiavi identificano il progetto/app e non autorizzano l'accesso ai dati; l'autorizzazione è gestita da Firebase Authentication e Firestore Security Rules. Non inserire mai nel repository chiavi private di Service Account, client secret o credenziali server.


## Funzioni ereditate da 8.2.2
- Registrazione e accesso Firebase con gestione dettagliata degli errori.
- Sincronizzazione cloud separata dalla creazione dell'account.
- Protezione dal trasferimento accidentale dei dati locali tra account diversi.
- Verifica della connessione Firebase dall'app.
- Inserimento manuale mantenuto come unico metodo per quantità personalizzate.

## Struttura aggiunta in 8.3.2
- `firebase-messaging-sw.js`: service worker FCM per notifiche in background.
- `functions/index.js`: invio programmato dei promemoria.
- `functions/package.json`: dipendenze backend.
- `firebase.json`: configurazione Functions + Firestore rules.
- `firestore.rules`: accesso ai token limitato al proprietario dell'account.

## Offline
La persistenza locale e Firestore offline restano attivi. L'uso quotidiano di Hydro non richiede una connessione continua; la registrazione/login iniziale e la ricezione di nuove notifiche push richiedono invece la rete.
