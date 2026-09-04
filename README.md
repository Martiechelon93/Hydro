# Hydro 8.0.1

PWA statica per il monitoraggio dell'idratazione.

## Novità 8.0.1
- Account multipli con Firebase Authentication (email + password).
- Recupero password tramite Firebase.
- Sincronizzazione dei dati personali con Cloud Firestore.
- Pulsante **Modifica** per correggere le registrazioni di consumo (quantità, bevanda, calorie e orario).
- Possibilità di modificare anche le bevande personalizzate.
- Foto profilo: resta locale senza account; con account viene inclusa nella sincronizzazione.
- Backup Excel (.xlsx).
- Interfaccia azzurra stile iOS, goccia animata e PWA.
- Versione mostrata nelle Impostazioni: **8.0.1**.

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

## Notifiche
La versione mantiene la gestione delle autorizzazioni/notifica di prova già presente. Le notifiche push in background personalizzate (ad esempio promemoria individuali anche con app chiusa) richiedono una configurazione aggiuntiva di Firebase Cloud Messaging e un componente server/Cloud Functions per l'invio.


## Nota sicurezza Firebase
La Web API key presente nella configurazione client è una Firebase API key pubblica. Firebase documenta che queste chiavi identificano il progetto/app e non autorizzano l'accesso ai dati; l'autorizzazione è gestita da Firebase Authentication e Firestore Security Rules. Non inserire mai nel repository chiavi private di Service Account, client secret o credenziali server.
