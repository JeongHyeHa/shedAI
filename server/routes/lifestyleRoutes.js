const express = require('express');
const router = express.Router();
const database = require('../config/database');

// 생활 패턴 저장
router.post('/', async (req, res) => {
    try {
        const sessionId = req.body.session_id || req.body.sessionId;
        const { patterns } = req.body;
        
        if (!sessionId || !patterns) {
            return res.status(400).json({ error: '세션 ID와 생활 패턴이 필요합니다.' });
        }
        
        const user = await database.getOrCreateUser(sessionId);
        await database.saveLifestylePatterns(user.id, patterns);
        
        res.json({ success: true, message: '생활 패턴이 저장되었습니다.' });
    } catch (error) {
        console.error('생활 패턴 저장 실패:', error);
        res.status(500).json({ error: '생활 패턴 저장에 실패했습니다.' });
    }
});

module.exports = router;
