/* Hydro Web Push / Firebase Cloud Messaging service worker. */
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAzoriZ9E6_aGI1DKVs7WfKhQwMwhTwGvg",
  authDomain: "hydro-f2428.firebaseapp.com",
  projectId: "hydro-f2428",
  storageBucket: "hydro-f2428.firebasestorage.app",
  messagingSenderId: "311768311646",
  appId: "1:311768311646:web:4a255236e2dca3128411cf"
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  const title = d.title || '💧 È ora di bere!';
  const body = d.body || 'Bevi un po’ d’acqua.';
  const tag = d.type === 'hydro_test' ? 'hydro-test' : 'hydro-reminder';
  self.registration.showNotification(title, {
    body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag,
    data: { url: d.url || './' }
  });
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.location.origin).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list => {
    for(const client of list){ if('focus' in client) return client.focus(); }
    if(clients.openWindow) return clients.openWindow(target);
  }));
});
