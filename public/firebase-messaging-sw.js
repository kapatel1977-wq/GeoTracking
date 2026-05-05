importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC2FqDiXwzAS451UqEfdpJEmN2BeyGYL7Q",
  authDomain: "gen-lang-client-0831905038.firebaseapp.com",
  projectId: "gen-lang-client-0831905038",
  storageBucket: "gen-lang-client-0831905038.firebasestorage.app",
  messagingSenderId: "980455917678",
  appId: "1:980455917678:web:bd0c70fd7a9603d5c9fe7f"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.ico'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
