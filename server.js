
const express = require('express');
const app = express();
const path = require('path');
const axios = require('axios');
require('dotenv').config();     // .env 파일 사용

app.use(express.static('public'));
app.use(express.json());

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
                    {
                        role: 'system',
                        content: `
너는 shedAI Smart Scheduler야.
사용자는 자유롭게 자연어로 생활 패턴과 할 일을 입력한다.
너는 반드시 다음 절차를 따른다:

1. 사용자의 입력에서 [생활 패턴]과 [할 일 목록]을 분리해 구조화한다. 정리 후에는 이를 바탕으로 시간표 JSON을 생성한다.
2. 생활 패턴(수면, 식사, 학교 일정, 회사 일정 등)을 고정 시간으로 먼저 배치한다.
3. 할 일 목록은 중요도와 마감일을 고려해 남는 시간대에 균형 있게 배치한다.
4. 반드시 start(시작시간), end(종료시간), title(제목)을 갖는 activities 배열로 작성한다.
5. 모든 결과는 **JSON으로 출력**하고, **모든 title과 내용은 한국어로 작성**한다.
6. JSON 포맷 오류 없이 정확히 출력할 것.

출력 포맷 예시:

{
  "schedule": [
    {
      "day": 1,
      "activities": [
        { "start": "01:00", "end": "06:00", "title": "수면" },
        { "start": "10:00", "end": "12:00", "title": "임베디드 소프트웨어 수업" },
        { "start": "13:00", "end": "17:00", "title": "정보처리기사 실기 준비" },
        { "start": "17:00", "end": "18:00", "title": "저녁 식사" },
        { "start": "20:00", "end": "22:00", "title": "AI 프롬프트 개발" }
      ]
    }
  ]
}
`
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 2000
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