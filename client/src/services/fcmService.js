import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { app } from '../config/firebase';
import { doc, setDoc, getDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
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
    this.isInitialized = false; // 중복 초기화 방지
    this.initializing = false; // 초기화 진행 중 플래그
    this.mobileTokenListener = null;
    this.foregroundMessageListener = null; // 포어그라운드 메시지 리스너
  }

  /**
   * FCM 초기화
   */
  async initialize() {
    // 이미 초기화되었거나 초기화 중이면 건너뛰기
    if (this.isInitialized) {
      console.log('[FCM] 이미 초기화되었습니다.');
      return true;
    }
    
    if (this.initializing) {
      console.log('[FCM] 초기화가 진행 중입니다. 대기...');
      // 초기화 완료까지 대기
      while (this.initializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.isInitialized;
    }
    
    this.initializing = true;
    
    try {
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
      
      if (platform === 'android' || platform === 'ios') {
        // 모바일 플랫폼: Android/iOS에서 전달된 토큰 리스닝
        // 이벤트 리스너를 먼저 등록 (토큰이 먼저 도착할 수 있음)
        this.setupMobileTokenListener();
        console.log('[FCM] 모바일 토큰 리스너 등록 완료, 플랫폼:', platform);
        return true;
      }

      // 웹 플랫폼: 기존 로직
      // 브라우저 지원 확인
      if (!('Notification' in window)) {
        console.warn('[FCM] 이 브라우저는 알림을 지원하지 않습니다.');
        return false;
      }

      // Service Worker 지원 확인
      if (!('serviceWorker' in navigator)) {
        console.warn('[FCM] 이 브라우저는 Service Worker를 지원하지 않습니다.');
        return false;
      }

      // Messaging 인스턴스 생성
      this.messaging = getMessaging(app);

      // 알림 권한 요청
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('[FCM] 알림 권한이 거부되었습니다.');
        return false;
      }

      // Service Worker 등록 (Firebase 설정 전달)
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      console.log('[FCM] Service Worker 등록 완료:', registration.scope);
      
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
            measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
          }
        });
      }

      // 디바이스 ID 생성 또는 가져오기
      this.deviceId = this.getOrCreateDeviceId();

      // FCM 토큰 가져오기
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
    
    // Android에서 전달된 토큰 리스닝
    this.mobileTokenListener = async (event) => {
      try {
        const { token, platform } = event.detail;
        console.log('[FCM] 모바일에서 토큰 수신:', token, platform);
        
        if (!token) {
          console.error('[FCM] 토큰이 없습니다.');
          return;
        }
        
        this.token = token;
        this.deviceId = this.getOrCreateDeviceId();
        
        // Firestore에 저장
        await this.saveTokenToFirestore(token);
        console.log('[FCM] 모바일 토큰 Firestore 저장 완료');
        
        // 저장 후 무효한 토큰 정리 (선택사항, 백그라운드에서 실행)
        // 현재 사용자 ID 가져오기
        try {
          const { getAuth } = await import('firebase/auth');
          const { auth } = await import('../config/firebase');
          if (auth.currentUser) {
            // 비동기로 실행 (저장을 막지 않음)
            this.cleanupInvalidTokens(auth.currentUser.uid).catch(err => {
              console.warn('[FCM] 무효 토큰 정리 실패 (무시 가능):', err);
            });
          }
        } catch (e) {
          // 정리 실패는 무시
        }
      } catch (error) {
        console.error('[FCM] 모바일 토큰 Firestore 저장 실패:', error);
      }
    };
    
    // 리스너를 먼저 등록 (토큰이 먼저 도착할 수 있으므로)
    window.addEventListener('fcm-token-received', this.mobileTokenListener);
    console.log('[FCM] 모바일 토큰 리스너 등록됨');
    
    // 이미 전달된 토큰이 있을 수 있으므로 window 객체에서 확인
    if (window.__pendingFCMToken) {
      console.log('[FCM] 대기 중인 토큰 발견, 즉시 처리...');
      const pendingEvent = {
        detail: window.__pendingFCMToken
      };
      this.mobileTokenListener(pendingEvent);
      delete window.__pendingFCMToken;
    }

    // Android에서 전달된 메시지 리스닝
    window.addEventListener('fcm-message-received', (event) => {
      const payload = event.detail;
      console.log('[FCM] 모바일에서 메시지 수신:', payload);
      
      // 커스텀 이벤트 발생 (컴포넌트에서 사용 가능)
      window.dispatchEvent(new CustomEvent('fcm-message', { detail: payload }));
    });
  }

  /**
   * 디바이스 ID 가져오기 또는 생성
   */
  getOrCreateDeviceId() {
    let deviceId = localStorage.getItem('fcm_device_id');
    if (!deviceId) {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('fcm_device_id', deviceId);
    }
    return deviceId;
  }

  /**
   * FCM 토큰 가져오기 및 저장
   */
  async getFCMToken() {
    try {
      if (!this.messaging) {
        console.error('[FCM] Messaging이 초기화되지 않았습니다.');
        return null;
      }

      // FCM 토큰 가져오기
      this.token = await getToken(this.messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: await navigator.serviceWorker.ready,
      });

      if (!this.token) {
        console.warn('[FCM] FCM 토큰을 가져올 수 없습니다.');
        return null;
      }

      console.log('[FCM] FCM 토큰:', this.token);

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
      console.log('[FCM] saveTokenToFirestore 호출, token:', token ? token.substring(0, 20) + '...' : 'null', 'userId:', userId);
      
      // userId가 없으면 현재 로그인한 사용자 가져오기
      if (!userId) {
        const { getAuth } = await import('firebase/auth');
        const { auth } = await import('../config/firebase');
        const currentUser = auth.currentUser;
        if (!currentUser) {
          console.warn('[FCM] 로그인한 사용자가 없습니다. 토큰은 나중에 저장됩니다.');
          // 로그인하지 않았으면 토큰을 임시로 저장해두고, 로그인 시 저장
          this.pendingToken = token;
          return;
        }
        userId = currentUser.uid;
        console.log('[FCM] 현재 사용자 ID:', userId);
      }
      
      // pendingToken이 있으면 사용
      if (this.pendingToken && !token) {
        token = this.pendingToken;
        this.pendingToken = null;
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
          platformName = platform === 'android' ? 'android' : (platform === 'ios' ? 'ios' : 'web');
        } else if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
          const platform = window.Capacitor.getPlatform();
          platformName = platform === 'android' ? 'android' : (platform === 'ios' ? 'ios' : 'web');
        }
      } catch (e) {
        console.warn('[FCM] 플랫폼 확인 실패, 웹으로 간주:', e);
        platformName = 'web';
      }
      
      const deviceData = {
        fcmToken: token,
        platform: platformName,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'mobile',
        updatedAt: serverTimestamp(),
      };
      
      console.log('[FCM] Firestore에 저장할 데이터:', {
        ...deviceData,
        fcmToken: token ? token.substring(0, 20) + '...' : null,
        updatedAt: 'serverTimestamp()'
      });
      
      await setDoc(deviceRef, deviceData, { merge: true });

      console.log('[FCM] 토큰이 Firestore에 저장되었습니다. 경로: users/' + userId + '/devices/' + this.deviceId);
    } catch (error) {
      console.error('[FCM] 토큰 저장 실패:', error);
    }
  }

  /**
   * 포어그라운드 메시지 수신 리스너 설정
   */
  setupForegroundMessageListener() {
    if (!this.messaging) return;
    
    // 이미 리스너가 등록되어 있으면 건너뛰기
    if (this.foregroundMessageListener) {
      console.log('[FCM] 포어그라운드 메시지 리스너가 이미 등록되어 있습니다.');
      return;
    }

    this.foregroundMessageListener = onMessage(this.messaging, (payload) => {
      console.log('[FCM] 포어그라운드 메시지 수신:', payload);

      // 브라우저 알림 표시
      if (payload.notification) {
        const notificationTitle = payload.notification.title || '알림';
        const notificationOptions = {
          body: payload.notification.body || '',
          icon: payload.notification.icon || undefined, // 아이콘 없으면 기본값 사용
          badge: undefined, // 배지 없으면 기본값 사용
          tag: payload.data?.type || 'default',
          data: payload.data || {},
        };

        new Notification(notificationTitle, notificationOptions);
      }

      // 커스텀 이벤트 발생 (컴포넌트에서 사용 가능)
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
      // 문서를 완전히 삭제 (fcmToken: null로 설정하는 것보다 깔끔함)
      await deleteDoc(deviceRef);

      console.log('[FCM] 토큰이 삭제되었습니다. deviceId:', this.deviceId);
      
      // deviceId 초기화
      this.deviceId = null;
      this.token = null;
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
        console.log('[FCM] 정리할 무효 토큰이 없습니다.');
        return;
      }
      
      const deletePromises = [];
      snapshot.forEach((docSnapshot) => {
        deletePromises.push(deleteDoc(docSnapshot.ref));
      });
      
      await Promise.all(deletePromises);
      console.log(`[FCM] ${deletePromises.length}개의 무효 토큰이 정리되었습니다.`);
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

