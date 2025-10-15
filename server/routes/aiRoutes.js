const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const multer = require('multer');

// multer 설정 (파일 업로드용)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024 // 25MB 제한
    }
});

// GPT-4o 이미지 처리
router.post('/gpt4o-image', aiController.processImage);

// Whisper 음성 인식
router.post('/whisper-audio', upload.single('audio'), aiController.transcribeAudio);

// 대화형 피드백 분석
router.post('/analyze-conversational-feedback', aiController.analyzeConversationalFeedback);

// 스케줄 생성 엔드포인트
router.post('/schedule/generate', aiController.generateSchedule);

// OpenAI 연결 진단
router.get('/debug/openai', aiController.debugOpenAI);

module.exports = router;