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

// GPT-4o 이미지 처리 (임시 비활성화)
// router.post('/gpt4o-image', aiController.processImage);

// Whisper 음성 인식
router.post('/whisper-audio', upload.single('audio'), aiController.transcribeAudio);
router.post('/whisper-transcribe', upload.single('audio'), aiController.transcribeAudio);

// 대화형 피드백 분석
router.post('/analyze-conversational-feedback', aiController.analyzeConversationalFeedback);
// 호환 경로(클라에서 /api/ai/... 로 호출하는 경우)
router.post('/ai/analyze-conversational-feedback', aiController.analyzeConversationalFeedback);

// 스케줄 생성 엔드포인트
router.post('/schedule/generate', aiController.generateSchedule);
// 생활패턴/할일 저장 엔드포인트
router.post('/lifestyle-patterns', aiController.saveLifestylePatterns);
router.post('/tasks/:sessionId', aiController.createTask);
router.post('/users/:sessionId/tasks', aiController.createTask);
// 정식 경로 (클라이언트가 사용하는 형태)
router.post('/users/:userId/sessions/:sessionId/tasks', aiController.createTask);

// 할 일 조회 엔드포인트
router.get('/tasks/:sessionId', aiController.getTasks);
// 호환 경로 (/api/users/:sessionId/tasks)
router.get('/users/:sessionId/tasks', aiController.getTasks);
// 정식 경로 (클라이언트가 사용하는 형태)
router.get('/users/:userId/sessions/:sessionId/tasks', aiController.getTasks);

// 할 일 삭제 엔드포인트
router.delete('/tasks/:sessionId/:taskId', aiController.deleteTask);
router.delete('/users/:sessionId/tasks/:taskId', aiController.deleteTask);
// 정식 경로 (클라이언트가 사용하는 형태)
router.delete('/users/:userId/sessions/:sessionId/tasks/:taskId', aiController.deleteTask);

// 할 일 활성화/비활성화 토글 엔드포인트
router.patch('/tasks/:sessionId/:taskId/toggle', aiController.toggleTaskStatus);
router.patch('/users/:sessionId/tasks/:taskId/toggle', aiController.toggleTaskStatus);
// 정식 경로 (클라이언트가 사용하는 형태)
router.patch('/users/:userId/sessions/:sessionId/tasks/:taskId/toggle', aiController.toggleTaskStatus);

// 피드백 저장 엔드포인트
router.post('/feedback', aiController.saveFeedback);

// AI 조언 생성 엔드포인트
router.post('/advice/generate', aiController.generateAdvice);

// OpenAI 연결 진단
router.get('/debug/openai', aiController.debugOpenAI);

module.exports = router;