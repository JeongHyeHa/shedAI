import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

// 번들러 감지
const isVite =
  typeof import.meta !== "undefined" &&
  typeof import.meta.env !== "undefined" &&
  import.meta.env !== null;

// ⚠️ CRA는 process.env.REACT_APP_* "직접 접근"만 치환됨.
// 중간에 객체로 빼서 ENV.REACT_APP_* 식으로 읽으면 주입 안 됨.
const cfgFromVite = isVite ? {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
} : null;

const cfgFromCRA = !isVite ? {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
} : null;

const firebaseConfig = (isVite ? cfgFromVite : cfgFromCRA);

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
      `.env에 Vite는 VITE_*, CRA는 REACT_APP_* 접두사를 사용해 설정하세요.`
    );
  }

  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false
  });
  if (typeof window !== "undefined" && firebaseConfig.measurementId) {
    analytics = getAnalytics(app);
  }
  console.log("[Firebase] 초기화 성공");
} catch (e) {
  console.error("[Firebase] 초기화 실패:", e);
  // 초기화 실패 시, 아래 export들이 null이 되지 않도록 명확히 에러를 다시 던지면
  // 상위에서 잡거나 앱이 즉시 실패하여 원인 파악이 쉬워짐.
  throw e;
}

export { app, auth, db, analytics };
export default app;