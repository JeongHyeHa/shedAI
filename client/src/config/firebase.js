import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

// 환경 변수 디버깅
console.log('🔍 환경 변수 상태:', {
  API_KEY: process.env.REACT_APP_FIREBASE_API_KEY ? '✅ 로드됨' : '❌ 없음',
  AUTH_DOMAIN: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN ? '✅ 로드됨' : '❌ 없음',
  PROJECT_ID: process.env.REACT_APP_FIREBASE_PROJECT_ID ? '✅ 로드됨' : '❌ 없음'
});

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// 서비스 export
export const auth = getAuth(app);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);
export default app;