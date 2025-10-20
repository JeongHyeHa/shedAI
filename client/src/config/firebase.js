import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

// 환경변수 검증: 로컬 개발에서 값이 없으면 초기화를 건너뛰고 친절한 오류만 출력
const requiredKeys = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.appId
];

let app = null;
let auth = null;
let db = null;
let analytics = null;

try {
  if (requiredKeys.every(Boolean)) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    // analytics는 브라우저 환경/HTTPS/measurementId가 있을 때만
    if (typeof window !== "undefined" && firebaseConfig.measurementId) {
      analytics = getAnalytics(app);
    }
  } else {
    // 값이 비어있으면 런타임 크래시 대신 경고만 출력
    // 실제 사용 지점에서 null 체크로 안내 메시지를 띄우는 것을 권장
    // console.warn 사용 시 콘솔에만 노출
    console.warn(
      "[Firebase] 환경변수가 설정되지 않았습니다. client/.env.local에 REACT_APP_FIREBASE_* 값을 설정하세요."
    );
  }
} catch (e) {
  console.error("[Firebase] 초기화 실패:", e);
}

export { app, auth, db, analytics };
export default app;