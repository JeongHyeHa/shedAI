const aiService = require('../services/aiService');

class AIController {
    // GPT-4o 이미지 처리
    async processImage(req, res) {
        try {
            const { image, prompt } = req.body;
            
            if (!image) {
                return res.status(400).json({ error: '이미지가 필요합니다.' });
            }

            const result = await aiService.processImage(image, prompt);
            res.json({ text: result });
        } catch (error) {
            console.error('GPT-4o 이미지 처리 실패:', error);
            res.status(500).json({ error: '이미지 처리에 실패했습니다.' });
        }
    }

    // Whisper 음성 인식
    async transcribeAudio(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ error: '오디오 파일이 필요합니다.' });
            }

            const result = await aiService.transcribeAudio(req.file.buffer);
            res.json({ text: result });
        } catch (error) {
            console.error('Whisper 음성 인식 실패:', error);
            res.status(500).json({ error: '음성 인식에 실패했습니다.' });
        }
    }

    // 대화형 피드백 분석
    async analyzeConversationalFeedback(req, res) {
        try {
            const { conversationalFeedbacks } = req.body;
            
            if (!conversationalFeedbacks || !Array.isArray(conversationalFeedbacks)) {
                return res.status(400).json({ error: '대화형 피드백 데이터가 필요합니다.' });
            }

            const result = await aiService.analyzeConversationalFeedback(conversationalFeedbacks);
            res.json(result);
        } catch (error) {
            console.error('대화형 피드백 분석 실패:', error);
            res.status(500).json({ error: '피드백 분석에 실패했습니다.' });
        }
    }
}

module.exports = new AIController();
