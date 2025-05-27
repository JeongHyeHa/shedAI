const express = require('express');
const app = express();
const path = require('path');
const axios = require('axios');
const fs = require('fs'); 
const cors = require('cors');
require('dotenv').config();  

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

// GPT 프롬프트로 시간표 생성
app.post('/api/generate-schedule', async (req, res) => {
    const { prompt, conversationContext = [] } = req.body;
    const sessionId = req.body.sessionId || 'default';  // 세션 ID
    
    if (!prompt) {
        return res.status(400).send("프롬프트가 누락되었습니다.");
    }

    console.log('받은 프롬프트:', prompt);
    
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
        msg.role === 'user' && msg.content === prompt)) {
        conversationSessions[sessionId].push({ role: 'user', content: prompt });
    }
    
    console.log(`대화 세션 [${sessionId}]: ${conversationSessions[sessionId].length}개 메시지`);

    try {
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