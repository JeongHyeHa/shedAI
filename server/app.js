const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// 데이터베이스 연결
const database = require('./config/database');

// 라우트 import
const scheduleRoutes = require('./routes/scheduleRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const aiRoutes = require('./routes/aiRoutes');
const lifestyleRoutes = require('./routes/lifestyleRoutes');

const app = express();

// 미들웨어 설정
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// 대화 세션 저장소 (메모리)
app.locals.conversationSessions = {};

// 라우트 설정
app.use('/api/schedule', scheduleRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api', aiRoutes);
app.use('/api/lifestyle-patterns', lifestyleRoutes);

// 정적 파일 서빙
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 종료 시 데이터베이스 연결 정리
process.on('SIGINT', () => {
    console.log('\n서버 종료 중...');
    database.close();
    process.exit(0);
});

module.exports = app;
