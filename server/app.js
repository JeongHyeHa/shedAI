const express = require('express');
const cors = require('cors');
const path = require('path');
const timeout = require('connect-timeout');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Firebase Admin SDK 초기화
const admin = require('firebase-admin');

// Firebase 초기화 (환경변수에서 서비스 계정 키 확인)
if (!admin.apps.length) {
    try {
        // 환경변수에서 서비스 계정 키가 있는지 확인
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId: process.env.FIREBASE_PROJECT_ID
            });
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            // 서비스 계정 파일 경로가 있는 경우
            admin.initializeApp({
                credential: admin.credential.applicationDefault(),
                projectId: process.env.FIREBASE_PROJECT_ID
            });
        } else {
            console.warn('[Firebase] 서비스 계정 키가 설정되지 않았습니다. Firestore 기능이 제한될 수 있습니다.');
        }
    } catch (error) {
        console.error('[Firebase] 초기화 실패:', error.message);
    }
}

const aiRoutes = require('./routes/aiRoutes');
const googleCalendarRoutes = require('./routes/googleCalendarRoutes');
const app = express();

// 미들웨어 설정
app.use(cors());
// Cross-Origin-Opener-Policy 헤더 설정 (Firebase Auth popup 오류 해결)
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});
app.use(timeout('330s')); // 응답 대기 허용 시간 (330초 = 5.5분) - 긴 프롬프트와 AI 응답 생성 시간을 고려
app.use(express.json({ limit: '25mb' }));

// 대화 세션 저장소 (메모리)
app.locals.conversationSessions = {};

// 라우트 설정
app.use('/api', aiRoutes);
app.use('/api/google-calendar', googleCalendarRoutes);

// 헬스 체크 (진단용) - 민감정보 노출 없음
app.get('/api/health', (req, res) => {
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
    res.json({
        ok: true,
        hasOpenAIKey,
        env: process.env.NODE_ENV || 'development',
        time: new Date().toISOString()
    });
});

// 정적 파일 서빙
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 에러 핸들러 추가
app.use((err, req, res, next) => {
    console.error('[Server Error]', err);
    res.status(err.status || 500).json({ 
        error: err.message || 'Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// 서버 종료 시 정리
process.on('SIGINT', () => {
    console.log('\n서버 종료 중...');
    process.exit(0);
});

module.exports = app;
