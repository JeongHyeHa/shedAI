// Firebase Cloud Messaging Service Worker
// 이 파일은 public 폴더에 있어야 합니다.

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase 설정 (클라이언트에서 전달받음)
let firebaseConfig = null;
let firebaseApp = null;
let messaging = null;

// 클라이언트로부터 Firebase 설정 수신
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FIREBASE_CONFIG') {
    firebaseConfig = event.data.config;
    
    // Firebase 초기화
    if (!firebaseApp) {
      firebaseApp = firebase.initializeApp(firebaseConfig);
      messaging = firebase.messaging();
      console.log('[firebase-messaging-sw.js] Firebase 초기화 완료');
    }
  }
});

// 기본 설정 (개발용 - 실제로는 클라이언트에서 전달받음)
// TODO: 실제 프로젝트 설정으로 교체 필요
if (!firebaseConfig) {
  firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID",
    measurementId: "YOUR_MEASUREMENT_ID"
  };
  
  firebaseApp = firebase.initializeApp(firebaseConfig);
  messaging = firebase.messaging();
}


// 백그라운드 메시지 수신 처리
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification?.title || '알림';
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: payload.notification?.icon || undefined, // 아이콘 없으면 기본값 사용
    badge: undefined, // 배지 없으면 기본값 사용
    tag: payload.data?.type || 'default',
    data: payload.data || {},
    requireInteraction: false,
    silent: false,
  };

  // 알림 표시
  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// 알림 클릭 처리
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Notification click received.');
  
  event.notification.close();

  // 알림 데이터에서 URL 가져오기
  const urlToOpen = event.notification.data?.url || '/';
  
  // 클라이언트 열기 또는 새 창 열기
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // 이미 열려있는 클라이언트가 있으면 포커스
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // 새 창 열기
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

