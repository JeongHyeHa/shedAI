// authService.js
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { STORAGE_KEYS } from '../constants/ui';

class AuthService {
  constructor() {
    if (!auth || !db) {
      throw new Error('Firebase가 초기화되지 않았습니다. .env 환경변수를 확인하세요.');
    }
    this.auth = auth;
    this.googleProvider = new GoogleAuthProvider();
    // Google Calendar 연동을 위한 scope 추가
    this.googleProvider.addScope('https://www.googleapis.com/auth/calendar');
  }

  // 🔧 새 사용자일 때 로컬 스토리지 정리
  clearLocalStorage() {
    try {
      // 프로젝트에서 관리하는 키들을 정리
      // 'shedAI:' 접두사로 시작하는 모든 키 제거
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('shedAI:')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      // STORAGE_KEYS에 명시된 키도 제거
      if (STORAGE_KEYS && typeof STORAGE_KEYS === 'object') {
        Object.values(STORAGE_KEYS).forEach((k) => {
          if (typeof k === 'string') localStorage.removeItem(k);
        });
      }
      
      console.log('[AuthService] 로컬 스토리지 정리 완료');
    } catch (e) {
      console.warn('[AuthService] clearLocalStorage 실패:', e);
    }
  }

  // 회원가입
  async signUp(email, password, displayName) {
    try {
      const userCredential = await createUserWithEmailAndPassword(
        this.auth, 
        email, 
        password
      );
      
      // 사용자 프로필 업데이트
      await updateProfile(userCredential.user, {
        displayName: displayName
      });
      
      // Firestore에 사용자 프로필 생성
      await this.createUserProfile(userCredential.user.uid, {
        email,
        displayName,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp()
      });
      
      // 새 사용자이므로 로컬스토리지 초기화
      this.clearLocalStorage();
      
      return userCredential.user;
    } catch (error) {
      throw new Error(this.getErrorMessage(error?.code));
    }
  }

  // 로그인
  async signIn(email, password) {
    try {
      const userCredential = await signInWithEmailAndPassword(
        this.auth, 
        email, 
        password
      );
      
      // 마지막 로그인 시간 업데이트
      await this.updateLastLogin(userCredential.user.uid);
      
      return userCredential.user;
    } catch (error) {
      throw new Error(this.getErrorMessage(error?.code));
    }
  }

  // Google 로그인
  async signInWithGoogle() {
    try {
      // Cross-Origin-Opener-Policy 오류를 무시하기 위한 설정
      const originalError = console.error;
      const suppressedErrors = [];
      console.error = (...args) => {
        const errorMsg = args.join(' ');
        // COOP 관련 오류는 무시
        if (errorMsg.includes('Cross-Origin-Opener-Policy') || 
            errorMsg.includes('window.closed') ||
            errorMsg.includes('window.close')) {
          suppressedErrors.push(errorMsg);
          return;
        }
        originalError.apply(console, args);
      };

      try {
        const result = await signInWithPopup(this.auth, this.googleProvider);
        
        // Google Calendar accessToken 추출
        const credential = GoogleAuthProvider.credentialFromResult(result);
        const accessToken = credential?.accessToken;
        
        // Firestore에 사용자 프로필 생성 (없는 경우)
        const isNewUser = await this.createUserProfileIfNotExists(result.user.uid, {
          email: result.user.email,
          displayName: result.user.displayName,
          createdAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
          ...(accessToken && { googleCalendarAccessToken: accessToken }) // accessToken 저장 (선택적)
        });
        
        // 새 사용자이면 로컬스토리지 초기화
        if (isNewUser) {
          this.clearLocalStorage();
        }
        
        // accessToken을 반환하여 Context에서 사용할 수 있도록 함
        return { 
          user: result.user, 
          accessToken 
        };
      } finally {
        console.error = originalError;
      }
    } catch (error) {
      throw new Error(this.getErrorMessage(error?.code));
    }
  }
  
  // Google Calendar accessToken 가져오기 (재인증 필요 시)
  async getGoogleCalendarAccessToken() {
    try {
      const user = this.auth.currentUser;
      if (!user) return null;
      
      // 현재 사용자의 Google credential에서 accessToken 가져오기
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/calendar');
      
      // Cross-Origin-Opener-Policy 오류를 무시하기 위한 설정
      const originalError = console.error;
      console.error = (...args) => {
        const errorMsg = args.join(' ');
        // COOP 관련 오류는 무시
        if (errorMsg.includes('Cross-Origin-Opener-Policy') || 
            errorMsg.includes('window.closed') ||
            errorMsg.includes('window.close')) {
          return;
        }
        originalError.apply(console, args);
      };

      try {
        // 재인증이 필요한 경우를 대비해 credential을 다시 가져옴
        const result = await signInWithPopup(this.auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        return credential?.accessToken || null;
      } finally {
        console.error = originalError;
      }
    } catch (error) {
      console.error('[AuthService] Google Calendar accessToken 가져오기 실패:', error);
      return null;
    }
  }

  // 로그아웃
  async signOutUser() {
    try {
      await fbSignOut(this.auth);
    } catch (error) {
      throw new Error('로그아웃 실패');
    }
  }

  // 인증 상태 감지
  onAuthStateChanged(callback) {
    return onAuthStateChanged(this.auth, callback);
  }

  // 현재 사용자 가져오기
  getCurrentUser() {
    return this.auth.currentUser;
  }

  // Firestore에 사용자 프로필 생성
  async createUserProfile(userId, userData) {
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, userData);
  }

  // 사용자 프로필이 없으면 생성
  async createUserProfileIfNotExists(userId, userData) {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      await setDoc(userRef, userData);
      return true; // 새 사용자
    } else {
      // 기존 사용자의 경우 마지막 로그인 시간만 업데이트
      await this.updateLastLogin(userId);
      return false; // 기존 사용자
    }
  }

  // 마지막 로그인 시간 업데이트
  async updateLastLogin(userId) {
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, { lastLoginAt: serverTimestamp() }, { merge: true });
  }

  // 에러 메시지 변환
  getErrorMessage(errorCode) {
    switch (errorCode) {
      case 'auth/email-already-in-use':
        return '이미 사용 중인 이메일입니다.';
      case 'auth/weak-password':
        return '비밀번호는 6자 이상이어야 합니다.';
      case 'auth/invalid-email':
        return '유효하지 않은 이메일입니다.';
      case 'auth/user-not-found':
        return '등록되지 않은 이메일입니다.';
      case 'auth/wrong-password':
        return '잘못된 비밀번호입니다.';
      case 'auth/too-many-requests':
        return '너무 많은 시도로 인해 일시적으로 차단되었습니다.';
      default:
        return '인증 중 오류가 발생했습니다.';
    }
  }
}

export default new AuthService();
