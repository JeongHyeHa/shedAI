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
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).send("프롬프트가 누락되었습니다.");
      }

    console.log('받은 프롬프트:', prompt);

    try {
        const gptResponse = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
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

        // GPT 응답을 JSON으로 파싱해서 전송: {} 블록만 추출 
        const startIndex = fullText.indexOf('{');
        const endIndex = fullText.lastIndexOf('}');
        if (startIndex === -1 || endIndex === -1) {
            throw new Error("GPT 응답에서 유효한 JSON을 찾을 수 없습니다.");
        }

        const jsonString = fullText.substring(startIndex, endIndex + 1);
        const generatedSchedule = JSON.parse(jsonString);

        res.json(generatedSchedule);
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