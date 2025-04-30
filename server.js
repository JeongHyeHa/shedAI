
const express = require('express');
const app = express();
const path = require('path');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();    

app.use(express.static('public'));
app.use(express.json());

// 지시문 파일 호출
const systemPrompt = fs.readFileSync(path.join(__dirname, 'prompts/systemPrompt.txt'), 'utf-8');

// 기본 시간표
app.get('/api/schedule', (req, res) => {
    res.json([]);
});

// 프롬프트로  GPT 호출
app.post('/api/generate-schedule', async (req, res) => {
    const { prompt } = req.body;
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
                max_tokens: 5000
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                }
            }
        );

        console.log('GPT 응답:', gptResponse.data.choices[0].message.content);

        // GPT 응답을 JSON으로 파싱해서 전송
        const fullText = gptResponse.data.choices[0].message.content;
        const startIndex = fullText.indexOf('{');
        const endIndex = fullText.lastIndexOf('}');
        const jsonString = fullText.substring(startIndex, endIndex + 1);

        const generatedSchedule = JSON.parse(jsonString);

        res.json(generatedSchedule);
    } catch (error) {
        console.error('GPT 호출 실패:', error.response?.data || error.message);
        res.status(500).send('시간표 생성 실패');
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 실행
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});