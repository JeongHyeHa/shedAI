import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, setLogLevel } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

// CRA 전용 환경변수만 사용 (REACT_APP_*)
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
};

// 환경변수 검증: 필수값이 하나라도 없으면 바로 throw (초기화 생략 금지)
const requiredKeys = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId,
};

let app = null;
let auth = null;
let db = null;
let analytics = null;

try {
  // 필수 키 누락 시 즉시 에러
  const missing = Object.entries(requiredKeys)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `[Firebase] 환경변수 누락: ${missing.join(', ')}. ` +
      `CRA(.env)에는 REACT_APP_* 접두사로 환경변수를 설정해야 합니다.`
    );
  }

  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false
  });
  try { setLogLevel('error'); } catch {}
  if (typeof window !== "undefined" && firebaseConfig.measurementId) {
    analytics = getAnalytics(app);
  }
} catch (e) {
  console.error("[Firebase] 초기화 실패:", e);
  throw e;
}

export { app, auth, db, analytics };
export default app;