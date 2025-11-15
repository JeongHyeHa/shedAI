import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { app } from '../config/firebase';
import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../config/firebase';

// VAPID 키 (Firebase Console > 프로젝트 설정 > 클라우드 메시징에서 가져오기)
// TODO: 환경변수로 이동 필요
const VAPID_KEY = process.env.REACT_APP_FCM_VAPID_KEY || '';

/**
 * FCM 서비스
 * Firebase Cloud Messaging을 사용한 푸시 알림 관리
 */
class FCMService {
  constructor() {
    this.messaging = null;
    this.token = null;
    this.deviceId = null;
    this.pendingToken = null;
    this.isInitialized = false;   // 중복 초기화 방지
    this.initializing = false;    // 초기화 진행 중 플래그
    this.mobileTokenListener = null;
    this.foregroundMessageListener = null; // 포어그라운드 메시지 리스너

    // 알림 중복 방지용 (최근 N초 안에 같은 알림 필터링)
    this.notificationHistory = [];
    this.notificationDedupWindowMs = 15000; // 15초

    // Auth 상태 변경 감지 (pendingToken → Firestore 저장용)
    this.authListenerAttached = false;
  }

  /**
   * Firebase Auth 상태 리스너 설정
   * - 로그인 되면 pendingToken이 있으면 Firestore에 저장
   */
  async attachAuthListener() {
    if (this.authListenerAttached) return;

    try {
      const { onAuthStateChanged } = await import('firebase/auth');
      const { auth } = await import('../config/firebase');

      this.authListenerAttached = true;

      onAuthStateChanged(auth, (user) => {
        if (user && this.pendingToken) {
          console.log('[FCM] 로그인 감지, pendingToken을 Firestore에 저장합니다.');
          const tokenToSave = this.pendingToken;
          this.pendingToken = null;
          // userId를 명시적으로 넘겨서 바로 저장
          this.saveTokenToFirestore(tokenToSave, user.uid).catch((e) => {
            console.error('[FCM] pendingToken 저장 실패:', e);
          });
        }
      });
    } catch (e) {
      console.warn('[FCM] Auth 리스너 설정 실패:', e);
    }
  }

  /**
   * 알림 중복 여부 체크
   * 같은 title + body + tag/type 조합이 짧은 시간 안에 다시 오면 true 반환
   */
  isDuplicateNotification(payload) {
    try {
      const title = payload?.notification?.title || '';
      const body = payload?.notification?.body || '';
      const tag = payload?.data?.tag || payload?.data?.type || '';
      const key = `${title}||${body}||${tag}`;
      const now = Date.now();

      // 오래된 기록 정리
      this.notificationHistory = (this.notificationHistory || []).filter(
        (item) => now - item.time < this.notificationDedupWindowMs
      );

      const exists = this.notificationHistory.some((item) => item.key === key);

      if (!exists) {
        this.notificationHistory.push({ key, time: now });
      }

      return exists;
    } catch (e) {
      // 어떤 이유로든 실패하면 중복 필터링은 포기하고 그대로 표시
      console.warn('[FCM] 중복 알림 체크 실패, 알림을 그대로 표시합니다:', e);
      return false;
    }
  }

  /**
   * FCM 초기화
   */
  async initialize() {
    // 이미 초기화되었으면 바로 true
    if (this.isInitialized) {
      return true;
    }

    // 다른 곳에서 초기화 중이면 완료될 때까지 대기
    if (this.initializing) {
      while (this.initializing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return this.isInitialized;
    }

    this.initializing = true;

    try {
      // Auth 리스너 먼저 붙여서 pendingToken 처리 가능하게
      await this.attachAuthListener();

      // Capacitor 플랫폼 확인 (Android/iOS)
      let platform = 'web';
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (Capacitor && typeof Capacitor.getPlatform === 'function') {
          platform = Capacitor.getPlatform();
        } else if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
          platform = window.Capacitor.getPlatform();
        }
      } catch (e) {
        console.warn('[FCM] Capacitor 플랫폼 확인 실패, 웹으로 간주:', e);
        platform = 'web';
      }

      // 모바일(Android/iOS)인 경우: 네이티브에서 토큰/메시지를 전달해줌
      if (platform === 'android' || platform === 'ios') {
        this.setupMobileTokenListener();

        this.isInitialized = true;
        this.initializing = false;
        return true;
      }

      // ----- 여기부터 웹 전용 -----

      // 브라우저 알림 지원 확인
      if (typeof window === 'undefined' || !('Notification' in window)) {
        console.warn('[FCM] 이 브라우저는 알림을 지원하지 않습니다.');
        this.initializing = false;
        return false;
      }

      // Service Worker 지원 확인
      if (!('serviceWorker' in navigator)) {
        console.warn('[FCM] 이 브라우저는 Service Worker를 지원하지 않습니다.');
        this.initializing = false;
        return false;
      }

      if (!VAPID_KEY) {
        console.warn(
          '[FCM] VAPID 키가 설정되지 않았습니다. 웹 푸시가 동작하지 않을 수 있습니다. (REACT_APP_FCM_VAPID_KEY 확인 필요)'
        );
        // 그래도 개발용으로는 계속 진행
      }

      // Messaging 인스턴스 생성
      this.messaging = getMessaging(app);

      // 알림 권한 요청
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('[FCM] 알림 권한이 거부되었습니다.');
        this.initializing = false;
        return false;
      }

      // Service Worker 등록
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

      // Service Worker가 활성화될 때까지 대기
      await navigator.serviceWorker.ready;

      // Firebase 설정을 Service Worker에 전달
      if (registration.active) {
        registration.active.postMessage({
          type: 'FIREBASE_CONFIG',
          config: {
            apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
            authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
            projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
            storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.REACT_APP_FIREBASE_APP_ID,
            measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
          }
        });
      }

      // 디바이스 ID 생성 또는 가져오기
      this.deviceId = this.getOrCreateDeviceId();

      // FCM 토큰 가져오기 및 Firestore 저장
      await this.getFCMToken();

      // 포어그라운드 메시지 수신 리스너 설정
      this.setupForegroundMessageListener();

      this.isInitialized = true;
      this.initializing = false;
      return true;
    } catch (error) {
      console.error('[FCM] 초기화 실패:', error);
      this.initializing = false;
      return false;
    }
  }

  /**
   * 모바일 플랫폼 (Android/iOS) 토큰 리스너 설정
   */
  setupMobileTokenListener() {
    // 이미 등록된 리스너가 있으면 제거 (중복 방지)
    if (this.mobileTokenListener) {
      window.removeEventListener('fcm-token-received', this.mobileTokenListener);
    }

    // Android/iOS에서 전달된 토큰 리스닝
    this.mobileTokenListener = async (event) => {
      try {
        const { token, platform } = event.detail || {};

        if (!token) {
          console.error('[FCM] 모바일에서 전달된 토큰이 없습니다.');
          return;
        }

        this.token = token;
        this.deviceId = this.getOrCreateDeviceId();

        // Firestore에 저장 (로그인 안 되어 있으면 pendingToken으로 보관)
        await this.saveTokenToFirestore(token);

        // 로그인 후에 pendingToken이 저장되도록 Auth 리스너도 이미 붙어 있음
      } catch (error) {
        console.error('[FCM] 모바일 토큰 Firestore 저장 실패:', error);
      }
    };

    // 리스너 등록
    window.addEventListener('fcm-token-received', this.mobileTokenListener);

    // 이미 전달된 토큰이 있을 수 있으므로 window 전역에서 확인
    if (window.__pendingFCMToken) {
      const pendingEvent = {
        detail: window.__pendingFCMToken
      };
      this.mobileTokenListener(pendingEvent);
      delete window.__pendingFCMToken;
    }

    // Android에서 전달된 메시지 → JS 이벤트로 전달
    // (여기서 Notification을 직접 띄우지는 않음. 실제 푸시는 네이티브/OS가 처리)
    window.addEventListener('fcm-message-received', (event) => {
      const payload = event.detail;
      window.dispatchEvent(new CustomEvent('fcm-message', { detail: payload }));
    });
  }

  /**
   * 디바이스 ID 가져오기 또는 생성
   */
  getOrCreateDeviceId() {
    let deviceId = null;

    try {
      deviceId = localStorage.getItem('fcm_device_id');
    } catch (e) {
      // SSR 등 localStorage 없는 환경에서는 무시
    }

    if (!deviceId) {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      try {
        localStorage.setItem('fcm_device_id', deviceId);
      } catch (e) {
        // 실패해도 동작에는 큰 지장 없음
      }
    }

    return deviceId;
  }

  /**
   * FCM 토큰 가져오기 및 저장 (웹용)
   */
  async getFCMToken() {
    try {
      if (!this.messaging) {
        console.error('[FCM] Messaging이 초기화되지 않았습니다.');
        return null;
      }

      this.token = await getToken(this.messaging, {
        vapidKey: VAPID_KEY || undefined,
        serviceWorkerRegistration: await navigator.serviceWorker.ready
      });

      if (!this.token) {
        console.warn('[FCM] FCM 토큰을 가져올 수 없습니다.');
        return null;
      }

      // 토큰을 Firestore에 저장
      await this.saveTokenToFirestore(this.token);

      return this.token;
    } catch (error) {
      console.error('[FCM] 토큰 가져오기 실패:', error);
      return null;
    }
  }

  /**
   * 토큰을 Firestore에 저장
   * users/{uid}/devices/{deviceId}.fcmToken
   */
  async saveTokenToFirestore(token, userId = null) {
    try {
      // userId가 없으면 현재 로그인한 사용자 가져오기
      if (!userId) {
        const { auth } = await import('../config/firebase');
        const currentUser = auth.currentUser;

        if (!currentUser) {
          console.warn('[FCM] 로그인한 사용자가 없습니다. 토큰은 나중에 저장됩니다.');
          // 로그인하지 않았으면 토큰을 임시로 저장
          if (token) {
            this.pendingToken = token;
          }
          return;
        }
        userId = currentUser.uid;
      }

      if (!token && this.pendingToken) {
        token = this.pendingToken;
        this.pendingToken = null;
      }

      if (!token) {
        console.warn('[FCM] 저장할 토큰이 없습니다.');
        return;
      }

      if (!this.deviceId) {
        this.deviceId = this.getOrCreateDeviceId();
      }

      // 디바이스 정보 저장
      const deviceRef = doc(db, 'users', userId, 'devices', this.deviceId);

      // 플랫폼 확인
      let platformName = 'web';
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (Capacitor && typeof Capacitor.getPlatform === 'function') {
          const platform = Capacitor.getPlatform();
          platformName = platform === 'android' ? 'android' : platform === 'ios' ? 'ios' : 'web';
        } else if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
          const platform = window.Capacitor.getPlatform();
          platformName = platform === 'android' ? 'android' : platform === 'ios' ? 'ios' : 'web';
        }
      } catch (e) {
        console.warn('[FCM] 플랫폼 확인 실패, 웹으로 간주:', e);
        platformName = 'web';
      }

      const deviceData = {
        fcmToken: token,
        platform: platformName,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'mobile',
        updatedAt: serverTimestamp()
      };

      await setDoc(deviceRef, deviceData, { merge: true });
    } catch (error) {
      console.error('[FCM] 토큰 저장 실패:', error);
    }
  }

  /**
   * 포어그라운드 메시지 수신 리스너 설정 (웹)
   */
  setupForegroundMessageListener() {
    if (!this.messaging) return;

    // 이미 리스너가 등록되어 있으면 재사용
    if (this.foregroundMessageListener) {
      return;
    }

    this.foregroundMessageListener = onMessage(this.messaging, (payload) => {
      // 중복 알림 필터링
      if (this.isDuplicateNotification(payload)) {
        console.log('[FCM] 중복 알림 감지, 브라우저 알림 표시 생략');
        // 그래도 앱 내부용 이벤트는 날려준다
        window.dispatchEvent(new CustomEvent('fcm-message', { detail: payload }));
        return;
      }

      // 브라우저 알림 표시
      if (payload.notification && Notification.permission === 'granted') {
        const notificationTitle = payload.notification.title || '알림';
        const notificationOptions = {
          body: payload.notification.body || '',
          icon: payload.notification.icon || undefined, // 아이콘 없으면 기본값 사용
          badge: undefined, // 배지 없으면 기본값 사용
          tag: payload.data?.type || payload.data?.tag || 'default',
          data: payload.data || {}
        };

        try {
          new Notification(notificationTitle, notificationOptions);
        } catch (e) {
          console.warn('[FCM] Notification 생성 실패:', e);
        }
      }

      // React 컴포넌트 등에서 쓸 수 있게 커스텀 이벤트 발생
      window.dispatchEvent(new CustomEvent('fcm-message', { detail: payload }));
    });
  }

  /**
   * 토큰 삭제 (로그아웃 시)
   */
  async deleteToken(userId) {
    try {
      if (!this.deviceId) {
        console.warn('[FCM] deviceId가 없어 토큰 삭제를 건너뜁니다.');
        return;
      }

      const deviceRef = doc(db, 'users', userId, 'devices', this.deviceId);
      await deleteDoc(deviceRef);

      this.deviceId = null;
      this.token = null;
      this.pendingToken = null;
    } catch (error) {
      console.error('[FCM] 토큰 삭제 실패:', error);
    }
  }

  /**
   * 오래된/무효한 토큰 정리 (fcmToken이 null인 디바이스 삭제)
   */
  async cleanupInvalidTokens(userId) {
    try {
      const devicesRef = collection(db, 'users', userId, 'devices');
      const q = query(devicesRef, where('fcmToken', '==', null));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        return;
      }

      const deletePromises = [];
      snapshot.forEach((docSnapshot) => {
        deletePromises.push(deleteDoc(docSnapshot.ref));
      });

      await Promise.all(deletePromises);
    } catch (error) {
      console.error('[FCM] 무효 토큰 정리 실패:', error);
    }
  }

  /**
   * 현재 토큰 가져오기
   */
  getToken() {
    return this.token;
  }
}

// 싱글톤 인스턴스
const fcmService = new FCMService();

export default fcmService;
