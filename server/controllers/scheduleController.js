const aiService = require('../services/aiService');
const database = require('../config/database');
const promptEnhancer = require('../utils/promptEnhancer');
const SCHEDULE_PROMPT = require('../prompts/scheduleGeneration');

class ScheduleController {
    // 스케줄 생성
    async generateSchedule(req, res) {
        const sessionId = req.body.session_id || req.body.sessionId || 'default';
        const { prompt, conversationContext = [] } = req.body;
        
        if (!prompt) {
            return res.status(400).send("프롬프트가 누락되었습니다.");
        }

        console.log('받은 프롬프트:', prompt);
        
        try {
            // 사용자 데이터 조회
            const user = await database.getOrCreateUser(sessionId);
            const userData = await database.getUserDataSummary(user.id);
            
            // 프롬프트 강화
            let enhancedPrompt = promptEnhancer.enhancePromptWithPreferences(prompt, userData);
            enhancedPrompt = promptEnhancer.addCustomGuidelinesToPrompt(enhancedPrompt, userData);
            
            // 대화 세션 관리
            const conversationSessions = req.app.locals.conversationSessions || {};
            if (!conversationSessions[sessionId]) {
                conversationSessions[sessionId] = [];
            }
            
            // 클라이언트에서 받은 새 메시지만 세션에 추가
            if (conversationContext.length > 0) {
                const lastMessage = conversationContext[conversationContext.length - 1];
                if (lastMessage && !conversationSessions[sessionId].some(msg => 
                    msg.role === lastMessage.role && msg.content === lastMessage.content)) {
                    conversationSessions[sessionId].push(lastMessage);
                }
            }
            
            // 새 프롬프트가 세션에 없으면 추가
            if (!conversationSessions[sessionId].some(msg => 
                msg.role === 'user' && msg.content === enhancedPrompt)) {
                conversationSessions[sessionId].push({ role: 'user', content: enhancedPrompt });
            }
            
            // 메시지는 세션에서 가져오기 (최대 최근 10개 메시지만 사용)
            const messages = conversationSessions[sessionId].slice(-10);
            
            // 시스템 메시지 추가
            messages.push({
                role: 'system',
                content: SCHEDULE_PROMPT.system
            });
            
            const fullText = await aiService.generateSchedule(messages);
            console.log('GPT 응답:', fullText);
            
            // GPT 응답을 세션에 추가
            conversationSessions[sessionId].push({ role: 'assistant', content: fullText });
            req.app.locals.conversationSessions = conversationSessions;

            // JSON 형식인지 확인
            try {
                const jsonPattern = /\{[\s\S]*\}/g;
                const jsonMatches = fullText.match(jsonPattern);
                
                if (!jsonMatches || jsonMatches.length === 0) {
                    console.log('GPT가 JSON 대신 텍스트 응답을 반환했습니다:', fullText);
                    return res.json({
                        textResponse: fullText,
                        isJsonResponse: false
                    });
                }

                // 가장 큰 JSON 블록 찾기
                let largestJsonString = '';
                for (const match of jsonMatches) {
                    if (match.length > largestJsonString.length) {
                        largestJsonString = match;
                    }
                }
                
                // JSON 파싱 시도
                try {
                    const generatedSchedule = JSON.parse(largestJsonString);
                    
                    // 스케줄 세션 저장
                    if (generatedSchedule.schedule) {
                        const lifestyleContext = userData.lifestylePatterns.join('\n');
                        const taskContext = prompt;
                        
                        const scheduleSessionId = await database.saveScheduleSession(
                            user.id,
                            sessionId,
                            generatedSchedule.schedule,
                            lifestyleContext,
                            taskContext
                        );
                        
                        generatedSchedule.scheduleSessionId = scheduleSessionId;
                    }
                    
                    res.json({
                        ...generatedSchedule,
                        isJsonResponse: true
                    });
                } catch (innerJsonError) {
                    console.log('내부 JSON 파싱 실패, 전체 텍스트 응답 전송:', fullText);
                    res.json({
                        textResponse: fullText,
                        isJsonResponse: false
                    });
                }
            } catch (jsonError) {
                console.log('JSON 파싱 실패, 텍스트 응답 전송:', fullText);
                res.json({
                    textResponse: fullText,
                    isJsonResponse: false
                });
            }
        } catch (error) {
            console.error('스케줄 생성 실패:', error);
            res.status(500).send('시간표 생성 실패: ' + error.message);
        }
    }

    // 기본 시간표 조회
    async getSchedule(req, res) {
        res.json([]);
    }
}

module.exports = new ScheduleController();
