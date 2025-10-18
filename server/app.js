const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Firebase Admin SDK 초기화 (환경변수가 있을 때만)
let admin = null;
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    try {
        admin = require('firebase-admin');
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
                })
            });
            console.log('Firebase Admin SDK 초기화 완료');
        }
    } catch (error) {
        console.warn('Firebase Admin SDK 초기화 실패:', error.message);
        admin = null;
    }
} else {
    console.warn('Firebase 환경변수가 설정되지 않아 Admin SDK를 사용하지 않습니다.');
}

const aiRoutes = require('./routes/aiRoutes');
const app = express();

// 미들웨어 설정
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// 대화 세션 저장소 (메모리)
app.locals.conversationSessions = {};

// 라우트 설정
app.use('/api', aiRoutes);

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
