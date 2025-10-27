// AuthContext.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../config/firebase';
import authService from '../services/authService'; // 메서드 호출용(가입/로그인 등)

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    // Firebase 초기화가 실패했다면 여기서 바로 잡힘
    if (!auth) {
      setAuthError(new Error('Firebase 초기화 실패: .env 환경변수를 확인하세요.'));
      setLoading(false);
      return () => {};
    }

    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      setUser(fbUser);
      setLoading(false);
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
      const user = await authService.signInWithGoogle();
      return user;
    } catch (error) {
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await authService.signOutUser();
    } catch (error) {
      throw error;
    }
  };

  const value = {
    user,
    loading,
    authError,
    signUp,
    signIn,
    signInWithGoogle,
    signOut
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
