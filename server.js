
const express = require('express');
const app = express();
const path = require('path');

app.use(express.static('public'));

// ✨ 시간표 데이터 (미리 작성된 고정 데이터)
const scheduleData = [
    { title: '운동', start: '2025-04-28T19:00:00', end: '2025-04-28T20:00:00' },
    { title: 'OPIC 준비', start: '2025-04-28T20:00:00', end: '2025-04-28T22:00:00' },
    { title: 'AI 프로젝트 정리', start: '2025-04-29T10:00:00', end: '2025-04-29T12:00:00' }
];

// 📢 `/api/schedule`로 GET 요청이 오면 시간표 데이터 응답
app.get('/api/schedule', (req, res) => {
    res.json(scheduleData);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
