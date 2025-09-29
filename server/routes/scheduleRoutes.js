const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/scheduleController');

// 기본 시간표
router.get('/', scheduleController.getSchedule);

// GPT 프롬프트로 시간표 생성
router.post('/generate', scheduleController.generateSchedule);

module.exports = router;
