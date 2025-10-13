import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { STORAGE_KEYS } from '../constants/ui';

class AuthService {
  constructor() {
    this.auth = getAuth();
    this.googleProvider = new GoogleAuthProvider();
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
        createdAt: new Date(),
        lastLoginAt: new Date()
      });
      
      // 새 사용자이므로 로컬스토리지 초기화
      this.clearLocalStorage();
      
      return userCredential.user;
    } catch (error) {
      throw new Error(this.getErrorMessage(error.code));
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
      throw new Error(this.getErrorMessage(error.code));
    }
  }

  // Google 로그인
  async signInWithGoogle() {
    try {
      const result = await signInWithPopup(this.auth, this.googleProvider);
      
      // Firestore에 사용자 프로필 생성 (없는 경우)
      const isNewUser = await this.createUserProfileIfNotExists(result.user.uid, {
        email: result.user.email,
        displayName: result.user.displayName,
        createdAt: new Date(),
        lastLoginAt: new Date()
      });
      
      // 새 사용자이면 로컬스토리지 초기화
      if (isNewUser) {
        this.clearLocalStorage();
      }
      
      return result.user;
    } catch (error) {
      throw new Error(this.getErrorMessage(error.code));
    }
  }

  // 로그아웃
  async signOut() {
    try {
      await signOut(this.auth);
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
    await setDoc(userRef, { lastLoginAt: new Date() }, { merge: true });
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
