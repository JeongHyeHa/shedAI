const express = require('express');
const app = express();
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();  

// 데이터베이스 및 유틸리티 모듈 import
const database = require('./db/database');
const feedbackAnalyzer = require('./utils/feedbackAnalyzer');
const promptEnhancer = require('./utils/promptEnhancer');

// multer 설정 (파일 업로드용) - 크기 제한 추가
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB 제한
  }
});

app.use(cors());    // CORS 허용
app.use(express.json({ limit: '10mb' }));    // JSON 크기 제한 추가
//app.use(express.static('public'));  

// 대화 세션 저장소
const conversationSessions = {};

// 기본 시간표
app.get('/api/schedule', (req, res) => {
    res.json([]);
});

// 생활 패턴 저장 API
app.post('/api/lifestyle-patterns', async (req, res) => {
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

// 사용자 피드백 저장 API
app.post('/api/feedback', async (req, res) => {
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
        
        // 세션 초기화 또는 조회
        if (!conversationSessions[sessionId]) {
            conversationSessions[sessionId] = [];
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
            
            📤 출력 형식 필수 지침 (※ 이 부분이 매우 중요)
            - 출력은 반드시 아래와 같은 JSON 형식 하나만 반환하세요.
            - 각 day별로 하나의 객체가 있어야 하며, 각 객체는 반드시 아래 필드를 포함해야 합니다:
              - day: 오늘 기준 상대 날짜 번호 (정수, 오름차순)
              - weekday: 해당 요일 이름 (예: "수요일")
              - activities: 배열 형태로 활동 목록
                - 각 활동은 start, end, title, type 필드 포함
                  - type은 "lifestyle" 또는 "task" 중 하나
            - 절대 활동별로 days 배열을 반환하지 마세요!
            - 반드시 day별로 activities를 묶어서 반환하세요.
            
            예시:
            {
              "schedule": [
                {
                  "day": 3,
                  "weekday": "수요일",
                  "activities": [
                    { "start": "06:00", "end": "07:00", "title": "회사 준비", "type": "lifestyle" },
                    { "start": "08:00", "end": "17:00", "title": "근무", "type": "lifestyle" },
                    { "start": "19:00", "end": "21:00", "title": "정보처리기사 실기 개념 암기", "type": "task" }
                  ]
                }
              ],
              "notes": ["설명..."]
            }
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

// GPT-4o 이미지 처리 API
app.post('/api/gpt4o-image', async (req, res) => {
    try {
        const { image, prompt } = req.body;
        
        if (!image) {
            return res.status(400).json({ error: '이미지가 필요합니다.' });
        }

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: '당신은 이미지에서 텍스트를 정확히 추출하고 해석하는 전문가입니다. 시간표나 일정 정보를 명확하게 정리해주세요.'
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: prompt || '이 이미지에서 시간표나 일정 정보를 텍스트로 추출해주세요.'
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: image,
                                detail: 'high'
                            }
                        }
                    ]
                }
            ],
            max_tokens: 1000,
            temperature: 0.1
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const result = response.data.choices[0].message.content;
        res.json({ text: result });
    } catch (error) {
        console.error('GPT-4o 이미지 처리 실패:', error.response?.data || error.message);
        res.status(500).json({ error: '이미지 처리에 실패했습니다.' });
    }
});

// Whisper 음성 인식 API
app.post('/api/whisper-transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '오디오 파일이 필요합니다.' });
        }

        const formData = new FormData();

        const blob = new Blob([req.file.buffer], { type: 'audio/wav' });
        formData.append('file', blob, 'audio.wav');
        formData.append('model', 'whisper-1');
        formData.append('language', 'ko');

        const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'multipart/form-data'
            }
        });

        res.json({ text: response.data.text });
    } catch (error) {
        console.error('Whisper 음성 인식 실패:', error.response?.data || error.message);
        res.status(500).json({ error: '음성 인식에 실패했습니다.' });
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