const aiService = require('../services/aiService');
const database = require('../config/database');
const feedbackAnalyzer = require('../utils/feedbackAnalyzer');

class FeedbackController {
    // 피드백 저장 및 분석
    async saveFeedback(req, res) {
        try {
            const sessionId = req.body.session_id || req.body.sessionId;
            const { scheduleSessionId, feedbackText } = req.body;
            
            if (!sessionId || !scheduleSessionId || !feedbackText) {
                return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
            }
            
            const user = await database.getOrCreateUser(sessionId);
            
            // 기존 사용자 데이터 조회
            const userData = await database.getUserDataSummary(user.id);
            
            // AI를 사용한 피드백 분석
            const aiAnalysis = await aiService.analyzeFeedback(feedbackText, userData);
            
            // 피드백 타입 분류 (기본 분류 + AI 분석 결과 활용)
            const feedbackType = feedbackAnalyzer.classifyFeedbackType(feedbackText);
            const specificActivities = feedbackAnalyzer.extractSpecificActivities(feedbackText);
            const timePeriod = feedbackAnalyzer.extractTimePeriod(feedbackText);
            
            // 피드백 저장
            await database.saveUserFeedback(
                scheduleSessionId, 
                feedbackType, 
                feedbackText, 
                specificActivities, 
                timePeriod
            );

            // AI가 추출한 사용자 선호도 저장
            if (aiAnalysis.preferences && aiAnalysis.preferences.length > 0) {
                for (const pref of aiAnalysis.preferences) {
                    await database.saveUserPreference(
                        user.id,
                        pref.type,
                        pref.key,
                        pref.value,
                        pref.confidence || 0.8
                    );
                }
            }

            // AI 조언 저장
            if (aiAnalysis.advice && aiAnalysis.advice.length > 0) {
                for (const adviceItem of aiAnalysis.advice.slice(0, 2)) {
                    await database.saveAIAdvice(
                        user.id,
                        adviceItem.type,
                        adviceItem.title,
                        adviceItem.content,
                        {
                            priority: adviceItem.priority,
                            analysis: aiAnalysis.analysis
                        }
                    );
                }
            }

            res.json({ 
                success: true, 
                message: '피드백이 저장되었습니다.',
                feedbackType,
                analysis: aiAnalysis.analysis,
                advice: aiAnalysis.advice?.slice(0, 2) || []
            });
        } catch (error) {
            console.error('피드백 저장 실패:', error);
            res.status(500).json({ error: '피드백 저장에 실패했습니다.' });
        }
    }

    // AI 조언 조회
    async getAdvice(req, res) {
        try {
            const { sessionId } = req.params;
            const user = await database.getOrCreateUser(sessionId);
            const advice = await database.getAIAdvice(user.id, 5);
            
            res.json({ advice });
        } catch (error) {
            console.error('AI 조언 조회 실패:', error);
            res.status(500).json({ error: 'AI 조언 조회에 실패했습니다.' });
        }
    }
}

module.exports = new FeedbackController();
