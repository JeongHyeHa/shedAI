import React from 'react';
import ReactDOM from 'react-dom/client';
// Firebase 초기화를 최우선으로 import (환경변수 검증 및 초기화)
import './config/firebase';
import App from './App';

// 브라우저 환경에서 process 폴리필 (라이브러리 호환성)
if (typeof window !== 'undefined' && typeof window.process === 'undefined') {
  // CRA의 실제 process.env 값을 보존
  window.process = { env: process.env || {} };
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
