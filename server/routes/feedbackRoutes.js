const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');

// 사용자 피드백 저장
router.post('/', feedbackController.saveFeedback);

// AI 조언 조회
router.get('/advice/:sessionId', feedbackController.getAdvice);

module.exports = router;
