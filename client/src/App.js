// src/App.js
import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import CalendarPage from "./routes/CalendarPageRefactored";
import LoginForm from "./components/Auth/LoginForm";
import SignUpForm from "./components/Auth/SignUpForm";
import "./components/Auth/Auth.css";

// 인증이 필요한 컴포넌트
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontSize: '18px'
      }}>
        로딩 중...
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return children;
}

// 인증 페이지 (로그인/회원가입)
function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);

  return (
    <div>
      {isLogin ? (
        <LoginForm onSwitchToSignUp={() => setIsLogin(false)} />
      ) : (
        <SignUpForm onSwitchToLogin={() => setIsLogin(true)} />
      )}
    </div>
  );
}

// 메인 앱 컴포넌트
function AppContent() {
  const { user, signOut } = useAuth();
  const [showUserInfo, setShowUserInfo] = useState(false);

  // 사용자 정보 팝업을 3초 후에 숨기기
  useEffect(() => {
    if (user) {
      setShowUserInfo(true);
      const timer = setTimeout(() => {
        setShowUserInfo(false);
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [user]);

  return (
    <div>
      {/* 사용자 정보 팝업 (3초 후 사라짐) */}
      {user && showUserInfo && (
        <div style={{ 
          position: 'fixed', 
          top: '20px', 
          right: '20px', 
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: 'white',
          padding: '12px',
          borderRadius: '8px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          animation: 'fadeOut 0.5s ease-in-out 2.5s forwards'
        }}>
          <div className="user-info">
            <div className="user-avatar">
              {user.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="user-details">
              <h3>{user.displayName || '사용자'}</h3>
              <p>{user.email}</p>
            </div>
          </div>
        </div>
      )}

      {/* 로그아웃 버튼 (항상 표시) */}
      {user && (
        <div style={{ 
          position: 'fixed', 
          top: '20px', 
          right: '20px', 
          zIndex: 1001
        }}>
          <button className="logout-button" onClick={signOut}>
            로그아웃
          </button>
        </div>
      )}

      <Router>
        <Routes>
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <CalendarPage />
              </ProtectedRoute>
            } 
          />
        </Routes>
      </Router>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
