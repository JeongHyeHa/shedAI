const express = require('express');
const app = express();
const path = require('path');
const axios = require('axios');
const fs = require('fs'); 
const cors = require('cors');
require('dotenv').config();  

// 데이터베이스 및 유틸리티 모듈 import
const database = require('./db/database');
const feedbackAnalyzer = require('./utils/feedbackAnalyzer');
const promptEnhancer = require('./utils/promptEnhancer');

app.use(cors());    // CORS 허용
app.use(express.json());    
//app.use(express.static('public'));  

// 대화 세션 저장소
const conversationSessions = {};

// 지시문 파일 호출
let systemPrompt = '';
try {
  systemPrompt = fs.readFileSync(path.join(__dirname, 'prompts/systemPrompt.txt'), 'utf-8');
} catch (err) {
  console.error("❌ systemPrompt.txt 파일을 찾을 수 없습니다:", err.message);
}

// 기본 시간표
app.get('/api/schedule', (req, res) => {
    res.json([]);
});

// 생활 패턴 저장 API
app.post('/api/lifestyle-patterns', async (req, res) => {
    try {
        const { sessionId, patterns } = req.body;
        
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

// 사용자 피드백 저장 API
app.post('/api/feedback', async (req, res) => {
    try {
        const { sessionId, scheduleSessionId, feedbackText } = req.body;
        
        if (!sessionId || !scheduleSessionId || !feedbackText) {
            return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
        }

        const user = await database.getOrCreateUser(sessionId);
        
        // 기존 사용자 데이터 조회
        const userData = await database.getUserDataSummary(user.id);
        
        // AI를 사용한 피드백 분석
        const aiAnalysis = await feedbackAnalyzer.analyzeFeedbackWithAI(feedbackText, userData);
        
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
});

// AI 조언 조회 API
app.get('/api/advice/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const user = await database.getOrCreateUser(sessionId);
        const advice = await database.getAIAdvice(user.id, 5);
        
        res.json({ advice });
    } catch (error) {
        console.error('AI 조언 조회 실패:', error);
        res.status(500).json({ error: 'AI 조언 조회에 실패했습니다.' });
    }
});

// GPT 프롬프트로 시간표 생성
app.post('/api/generate-schedule', async (req, res) => {
    const { prompt, conversationContext = [] } = req.body;
    const sessionId = req.body.sessionId || 'default';  // 세션 ID
    
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
        
        // 세션 초기화 또는 조회
        if (!conversationSessions[sessionId]) {
            conversationSessions[sessionId] = [
                { role: 'system', content: systemPrompt }
            ];
        }
        
        // 클라이언트에서 받은 새 메시지만 세션에 추가
        if (conversationContext.length > 0) {
            // 마지막 메시지만 가져오기
            const lastMessage = conversationContext[conversationContext.length - 1];
            // 중복 방지를 위해 기존 대화에 없을 경우만 추가
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
        
        console.log(`대화 세션 [${sessionId}]: ${conversationSessions[sessionId].length}개 메시지`);

        // 메시지는 세션에서 가져오기 (최대 최근 10개 메시지만 사용)
        const messages = conversationSessions[sessionId].slice(-10);
        
        // 시스템 메시지에 추가 제약 조건 추가
        const additionalInstructions = {
            role: 'system',
            content: `
            중요한 제약 조건:
            1. 응답은 반드시 JSON 형식으로 제공해야 합니다.
            2. 기존 일정이 여러 날짜에 걸쳐있다면 (예: day:12까지), 새 일정도 최소한 같은 날짜까지 생성해야 합니다.
            3. 절대로 day:7이나 day:8까지만 일정을 생성하지 마세요.
            4. JSON 응답은 반드시 {} 중괄호로 시작하고 끝나야 하며, 다른 텍스트를 포함하지 않아야 합니다.
            5. 일정 생성이 필요한 경우가 아니라면 일반 텍스트로 응답하세요.
            `
        };
        
        messages.push(additionalInstructions);
        
        const gptResponse = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o',
                messages: messages,
                temperature: 0.7,
                max_tokens: 8000
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                }
            }
        );

        const fullText = gptResponse.data.choices[0].message.content;
        console.log('GPT 응답:', fullText);
        
        // GPT 응답을 세션에 추가
        conversationSessions[sessionId].push({ role: 'assistant', content: fullText });

        // JSON 형식인지 확인
        try {
          // 정규식을 사용하여 JSON 블록만 추출
          const jsonPattern = /\{[\s\S]*\}/g;
          const jsonMatches = fullText.match(jsonPattern);
          
          if (!jsonMatches || jsonMatches.length === 0) {
            console.log('GPT가 JSON 대신 텍스트 응답을 반환했습니다:', fullText);
            res.json({
              textResponse: fullText,
              isJsonResponse: false
            });
            return;
          }

          // 가장 큰 JSON 블록 찾기 (여러 개가 있을 경우)
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
                const taskContext = prompt; // 현재 프롬프트를 태스크 컨텍스트로 사용
                
                const scheduleSessionId = await database.saveScheduleSession(
                    user.id,
                    sessionId,
                    generatedSchedule.schedule,
                    lifestyleContext,
                    taskContext
                );
                
                // 응답에 스케줄 세션 ID 추가
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
        console.error('GPT 호출 실패:', error.response?.data || error.message);
        res.status(500).send('시간표 생성 실패: ' + (error.response?.data?.error?.message || error.message));
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 실행
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`서버 실행됨: http://localhost:${PORT}`);
});

// 서버 종료 시 데이터베이스 연결 정리
process.on('SIGINT', () => {
    console.log('\n서버 종료 중...');
    database.close();
    process.exit(0);
});