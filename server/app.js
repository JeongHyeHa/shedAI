const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const aiRoutes = require('./routes/aiRoutes');
const app = express();

// 미들웨어 설정
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// 대화 세션 저장소 (메모리)
app.locals.conversationSessions = {};

// 라우트 설정
app.use('/api', aiRoutes);

// 정적 파일 서빙
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 종료 시 정리
process.on('SIGINT', () => {
    console.log('\n서버 종료 중...');
    process.exit(0);
});

module.exports = app;
