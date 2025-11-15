// AuthContext.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../config/firebase';
import authService from '../services/authService'; // 메서드 호출용(가입/로그인 등)
import fcmService from '../services/fcmService';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [googleCalendarAccessToken, setGoogleCalendarAccessToken] = useState(null);

  useEffect(() => {
    // Firebase 초기화가 실패했다면 여기서 바로 잡힘
    if (!auth) {
      setAuthError(new Error('Firebase 초기화 실패: .env 환경변수를 확인하세요.'));
      setLoading(false);
      return () => {};
    }

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser);
      setLoading(false);
      
      // 로그인 시 FCM 초기화 및 토큰 저장
      if (fbUser) {
        try {
          await fcmService.initialize();
          console.log('[AuthContext] FCM 초기화 완료');
          
          // pendingToken이 있으면 저장
          if (fcmService.pendingToken) {
            await fcmService.saveTokenToFirestore(fcmService.pendingToken, fbUser.uid);
            console.log('[AuthContext] 대기 중이던 FCM 토큰 저장 완료');
          }
        } catch (error) {
          console.error('[AuthContext] FCM 초기화 실패:', error);
        }
      }
    }, (err) => {
      setAuthError(err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signUp = async (email, password, displayName) => {
    try {
      const user = await authService.signUp(email, password, displayName);
      return user;
    } catch (error) {
      throw error;
    }
  };

  const signIn = async (email, password) => {
    try {
      const user = await authService.signIn(email, password);
      return user;
    } catch (error) {
      throw error;
    }
  };

  const signInWithGoogle = async () => {
    try {
      const result = await authService.signInWithGoogle();
      // accessToken이 있으면 저장
      if (result.accessToken) {
        setGoogleCalendarAccessToken(result.accessToken);
        // localStorage에도 저장 (새로고침 대비)
        try {
          localStorage.setItem('shedAI:googleCalendarAccessToken', result.accessToken);
        } catch (e) {
          console.warn('[AuthContext] localStorage 저장 실패:', e);
        }
      }
      return result.user;
    } catch (error) {
      throw error;
    }
  };
  
  // Google Calendar accessToken 가져오기
  const getGoogleCalendarAccessToken = async () => {
    try {
      // 먼저 localStorage에서 확인
      const stored = localStorage.getItem('shedAI:googleCalendarAccessToken');
      if (stored) {
        setGoogleCalendarAccessToken(stored);
        return stored;
      }
      
      // 없으면 재인증으로 가져오기
      const token = await authService.getGoogleCalendarAccessToken();
      if (token) {
        setGoogleCalendarAccessToken(token);
        try {
          localStorage.setItem('shedAI:googleCalendarAccessToken', token);
        } catch (e) {
          console.warn('[AuthContext] localStorage 저장 실패:', e);
        }
      }
      return token;
    } catch (error) {
      console.error('[AuthContext] Google Calendar accessToken 가져오기 실패:', error);
      return null;
    }
  };

  const signOut = async () => {
    try {
      // 로그아웃 시 FCM 토큰 삭제
      if (user) {
        await fcmService.deleteToken(user.uid);
      }
      await authService.signOutUser();
    } catch (error) {
      throw error;
    }
  };

  // 로그인 시 localStorage에서 accessToken 복원
  useEffect(() => {
    if (user) {
      try {
        const stored = localStorage.getItem('shedAI:googleCalendarAccessToken');
        if (stored) {
          setGoogleCalendarAccessToken(stored);
        }
      } catch (e) {
        console.warn('[AuthContext] localStorage 읽기 실패:', e);
      }
    } else {
      // 로그아웃 시 토큰 제거
      setGoogleCalendarAccessToken(null);
      try {
        localStorage.removeItem('shedAI:googleCalendarAccessToken');
      } catch (e) {
        console.warn('[AuthContext] localStorage 삭제 실패:', e);
      }
    }
  }, [user]);

  const value = {
    user,
    loading,
    authError,
    googleCalendarAccessToken,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    getGoogleCalendarAccessToken
  };

  return (
    <AuthContext.Provider value={value}>
      {authError ? (
        <div style={{
          padding: '20px',
          background: '#ffeaea',
          color: '#b10000',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center'
        }}>
          <h2 style={{ marginBottom: '12px' }}>Firebase 초기화 에러</h2>
          <p style={{ marginBottom: '8px', fontSize: '16px' }}>
            {String(authError.message)}
          </p>
          <p style={{ fontSize: '14px', color: '#666', marginTop: '12px' }}>
            .env 파일을 확인하고 dev 서버를 재시작해주세요.
          </p>
        </div>
      ) : (
        !loading && children
      )}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
