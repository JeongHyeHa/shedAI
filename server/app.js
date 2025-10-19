const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Firebase Admin SDK는 필요할 때만 초기화 (지연 로딩)

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
