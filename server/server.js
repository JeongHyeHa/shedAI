const app = require('./app');

// 서버 실행
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`서버 실행됨: http://localhost:${PORT}`);
});