const axios = require('axios');

class AIService {
    constructor() {
        this.openaiApiKey = process.env.OPENAI_API_KEY;
    }

    // 스케줄 생성
    async generateSchedule(messages) {
        try {
            // 현재 날짜 정보 생성
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const date = now.getDate();
            const dayOfWeek = now.getDay(); // 0=일요일, 1=월요일, ..., 6=토요일
            const koreanDays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
            const currentDayName = koreanDays[dayOfWeek];
            
            // 스케줄 생성에 특화된 시스템 프롬프트 추가
            const systemPrompt = {
                role: 'system',
                content: `당신은 사용자의 생활패턴과 할 일을 바탕으로 시간표를 설계하는 전문가입니다.

**중요한 날짜 정보:**
- 현재 날짜: ${year}년 ${month}월 ${date}일 (${currentDayName})
- 오늘은 ${currentDayName}입니다.
- 스케줄은 오늘(${currentDayName})부터 시작하여 생성해주세요.

다음 규칙을 따라 스케줄을 생성해주세요:
- 기본적으로 2주간(14일)의 상세한 일정을 생성하되, 사용자가 "한 달", "두 달" 등으로 요청하면 그에 맞게 확장해주세요
- **사용자가 명시적으로 입력한 활동만** 스케줄에 포함하세요. 추론이나 가정으로 추가 활동을 만들지 마세요
- Eisenhower 매트릭스로 우선순위 판단
- 마감일 이후엔 일정 배치 금지
- 고난이도 작업 후 휴식 블록 배치
- 한국어 시간 표현을 정확히 해석 (새벽 1시 = 01:00, 저녁 6시 = 18:00 등)
- 각 요일별로 일관된 패턴을 유지하되, 주간별로 약간의 변화를 주어주세요
- 평일/주말 구분을 정확히 하고, 현재 날짜를 기준으로 스케줄을 생성해주세요

**자연어 파싱 및 처리:**
- 사용자의 모든 자연어 입력을 정확히 해석하여 스케줄에 반영
- "평일 오전 8시~오후 5시 회사" → 평일(월~금) 08:00-17:00에 회사 업무
- "주말 새벽 3시~오전 10시 수면" → 주말(토,일) 03:00-10:00에 수면
- "평일 저녁 8시~10시 자기계발" → 평일(월~금) 20:00-22:00에 자기계발
- "매일 23시~8시 취침" → 매일 23:00-08:00에 취침
- "내일 목욕탕 가기", "다음주 월요일 회의", "오늘 운동" 등도 정확히 분석
- 시간이 명시되지 않은 경우에만 적절한 시간대에 배치 (업무는 9-17시, 개인활동은 18-22시 등)
- "내일"은 실제 내일 날짜로, "다음주", "다다음주"는 해당 주차로 정확히 계산

**필수 데이터 부족 시:**
스케줄 생성에 필요한 정보가 부족하면 다음 메시지를 반환하세요:
"스케줄 생성에 실패했습니다. 다음 정보를 제공해주세요: 마감일, 중요도, 난이도, 긴급도"

- 결과는 반드시 다음 JSON 형식으로 반환:

{
  "schedule": [
    {
      "day": 1,
      "weekday": "월요일",
      "activities": [
        {
          "title": "활동 제목",
          "start": "HH:mm",
          "end": "HH:mm",
          "type": "lifestyle|task"
        }
      ]
    }
  ],
  "notes": "전체 스케줄에 대한 설명"
}

JSON만 반환하고 다른 텍스트는 포함하지 마세요.`
            };

            // 시스템 프롬프트를 맨 앞에 추가
            const enhancedMessages = [systemPrompt, ...messages];

            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4o-mini', // 더 빠른 모델로 변경
                    messages: enhancedMessages,
                    temperature: 0.7,
                    max_tokens: 2000, // 토큰 수 줄임
                    response_format: { type: 'json_object' }
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.openaiApiKey}`
                    },
                    timeout: 60000 // 60초 타임아웃으로 증가
                }
            );

            const content = response.data.choices?.[0]?.message?.content;
            
            if (!content) {
                throw new Error('AI 응답이 비어있습니다.');
            }
            
            // JSON 파싱 - 더 강화된 처리
            try {
                console.log('AI 원본 응답 길이:', content.length);
                
                // 여러 JSON 객체가 있을 수 있으므로 가장 큰 것 찾기
                let bestJson = null;
                let maxLength = 0;
                
                // { 로 시작하는 모든 JSON 객체 찾기
                let start = 0;
                while (start < content.length) {
                    const jsonStart = content.indexOf('{', start);
                    if (jsonStart === -1) break;
                    
                    // 이 위치에서 시작하는 JSON 객체의 끝 찾기
                    let braceCount = 0;
                    let jsonEnd = -1;
                    
                    for (let i = jsonStart; i < content.length; i++) {
                        if (content[i] === '{') braceCount++;
                        else if (content[i] === '}') {
                            braceCount--;
                            if (braceCount === 0) {
                                jsonEnd = i;
                                break;
                            }
                        }
                    }
                    
                    if (jsonEnd !== -1) {
                        const jsonString = content.substring(jsonStart, jsonEnd + 1);
                        if (jsonString.length > maxLength) {
                            bestJson = jsonString;
                            maxLength = jsonString.length;
                        }
                    }
                    
                    start = jsonStart + 1;
                }
                
                if (!bestJson) {
                    throw new Error('유효한 JSON 객체를 찾을 수 없습니다.');
                }
                
                console.log('추출된 JSON 길이:', bestJson.length);
                
                // JSON 파싱
                let parsed;
                try {
                    parsed = JSON.parse(bestJson);
                } catch (jsonError) {
                    console.error('JSON.parse 실패:', jsonError.message);
                    console.error('문제가 있는 JSON 부분:', jsonString.substring(Math.max(0, jsonString.length - 200)));
                    
                    // JSON이 불완전한 경우, 마지막 완전한 객체를 찾아서 파싱 시도
                    const lines = jsonString.split('\n');
                    let validJson = '';
                    let braceCount = 0;
                    let inString = false;
                    let escapeNext = false;
                    
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        for (let j = 0; j < line.length; j++) {
                            const char = line[j];
                            
                            if (escapeNext) {
                                escapeNext = false;
                                continue;
                            }
                            
                            if (char === '\\') {
                                escapeNext = true;
                                continue;
                            }
                            
                            if (char === '"' && !escapeNext) {
                                inString = !inString;
                            }
                            
                            if (!inString) {
                                if (char === '{') braceCount++;
                                if (char === '}') braceCount--;
                            }
                            
                            validJson += char;
                            
                            // 완전한 JSON 객체를 찾았으면 중단
                            if (braceCount === 0 && validJson.trim().length > 0) {
                                break;
                            }
                        }
                        
                        if (braceCount === 0 && validJson.trim().length > 0) {
                            break;
                        }
                        
                        if (i < lines.length - 1) {
                            validJson += '\n';
                        }
                    }
                    
                    console.log('수정된 JSON 길이:', validJson.length);
                    parsed = JSON.parse(validJson);
                }
                
                // 필수 필드 검증
                if (!parsed.schedule || !Array.isArray(parsed.schedule)) {
                    throw new Error('스케줄 데이터가 올바르지 않습니다.');
                }
                
                console.log('JSON 파싱 성공, 스케줄 개수:', parsed.schedule.length);
                return parsed;
            } catch (parseError) {
                console.error('AI 응답 JSON 파싱 실패:', parseError);
                console.error('원본 응답:', content);
                throw new Error('AI 응답을 파싱할 수 없습니다.');
            }
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            console.error('GPT 호출 실패:', { status, data, message: error.message });
            throw new Error('시간표 생성 실패: ' + (error.response?.data?.error?.message || error.message));
        }
    }

    // 피드백 분석
    async analyzeFeedback(feedbackText, userData) {
        try {
            const messages = [
                {
                    role: 'system',
                    content: FEEDBACK_PROMPT.system
                },
                {
                    role: 'user',
                    content: FEEDBACK_PROMPT.user(feedbackText, userData)
                }
            ];

            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4o',
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 1500
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.openaiApiKey}`
                    }
                }
            );

            const aiResponse = response.data.choices[0].message.content;
            
            // JSON 응답 파싱
            try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                } else {
                    return this.fallbackAnalysis(feedbackText);
                }
            } catch (parseError) {
                console.error('AI 응답 파싱 실패:', parseError);
                return this.fallbackAnalysis(feedbackText);
            }
        } catch (error) {
            console.error('AI 피드백 분석 실패:', error);
            return this.fallbackAnalysis(feedbackText);
        }
    }

    // 이미지 처리
    async processImage(image, prompt) {
        try {
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
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('GPT-4o 이미지 처리 실패:', error.response?.data || error.message);
            throw new Error('이미지 처리에 실패했습니다.');
        }
    }

    // 음성 인식
    async transcribeAudio(audioBuffer) {
        try {
            const formData = new FormData();
            const blob = new Blob([audioBuffer], { type: 'audio/wav' });
            formData.append('file', blob, 'audio.wav');
            formData.append('model', 'whisper-1');
            formData.append('language', 'ko');

            const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'multipart/form-data'
                }
            });

            return response.data.text;
        } catch (error) {
            console.error('Whisper 음성 인식 실패:', error.response?.data || error.message);
            throw new Error('음성 인식에 실패했습니다.');
        }
    }

  // 대화형 피드백 분석 (전체 히스토리 기반)
  async analyzeConversationalFeedback(conversationalFeedbacks) {
    try {
      const conversationText = conversationalFeedbacks.map(feedback => 
        `사용자: ${feedback.userMessage}\nAI: ${feedback.aiResponse}`
      ).join('\n\n');

      // 사용자 피드백에서 반복되는 패턴과 선호도 추출
      const timePatterns = this.extractTimePatterns(conversationalFeedbacks);
      const activityPatterns = this.extractActivityPatterns(conversationalFeedbacks);
      const workloadPatterns = this.extractWorkloadPatterns(conversationalFeedbacks);

      const prompt = `
사용자와의 대화 기록을 분석하여 사용자의 선호도와 패턴을 추출해주세요.

대화 기록:
${conversationText}

추출된 패턴들:
- 시간 관련: ${JSON.stringify(timePatterns)}
- 활동 관련: ${JSON.stringify(activityPatterns)}
- 작업량 관련: ${JSON.stringify(workloadPatterns)}

다음 JSON 형식으로 분석 결과를 반환해주세요:
{
  "preferences": [
    {
      "preferenceType": "time_preference|activity_preference|workload_preference",
      "preferenceKey": "구체적인 키워드",
      "preferenceValue": "prefer|avoid|reduce|increase|maintain",
      "confidence": 0.0-1.0,
      "reasoning": "분석 근거",
      "originalFeedback": "원본 피드백 텍스트"
    }
  ],
  "insights": [
    {
      "type": "strength|improvement|pattern",
      "title": "인사이트 제목",
      "description": "구체적인 설명",
      "confidence": 0.0-1.0,
      "basedOn": "어떤 피드백에서 추출되었는지"
    }
  ],
  "analysis": "전체적인 분석 결과",
  "recommendations": [
    {
      "type": "schedule_optimization|time_management|productivity",
      "title": "추천 제목",
      "description": "구체적인 추천 내용",
      "priority": "high|medium|low",
      "reasoning": "추천 근거"
    }
  ],
  "memoryPoints": [
    {
      "key": "기억해야 할 핵심 포인트",
      "value": "구체적인 내용",
      "importance": "high|medium|low",
      "lastMentioned": "언급된 날짜"
    }
  ]
}

분석할 때 다음을 고려해주세요:
1. 사용자의 감정과 톤 (긍정적/부정적/중립적)
2. 반복되는 불만사항이나 선호사항
3. 시간대, 활동, 작업량에 대한 언급
4. AI의 응답에 대한 사용자의 반응
5. 대화의 맥락과 흐름
6. 사용자가 강조하거나 반복해서 언급한 내용
7. 구체적인 요청사항이나 불만사항
`;

      const response = await this.callGPT(prompt);
      return response;
    } catch (error) {
      console.error('대화형 피드백 분석 실패:', error);
      return this.fallbackConversationalAnalysis(conversationalFeedbacks);
    }
  }

  // 시간 관련 패턴 추출
  extractTimePatterns(feedbacks) {
    const patterns = [];
    feedbacks.forEach(feedback => {
      const message = feedback.userMessage?.toLowerCase() || '';
      if (message.includes('아침') || message.includes('오전')) {
        patterns.push({
          time: 'morning',
          sentiment: message.includes('부지런') ? 'positive' : 'negative',
          feedback: feedback.userMessage
        });
      }
      if (message.includes('쉬는시간') || message.includes('휴식')) {
        patterns.push({
          time: 'break',
          sentiment: message.includes('길') ? 'positive' : 'negative',
          feedback: feedback.userMessage
        });
      }
    });
    return patterns;
  }

  // AI 조언 생성
  async generateDailyAdvice(userData, activityAnalysis) {
    try {
      const systemPrompt = {
        role: 'system',
        content: `당신은 사용자의 일일 활동 패턴을 분석하여 개인화된 조언을 제공하는 AI 어시스턴트입니다.

사용자의 활동 데이터를 바탕으로 다음과 같은 조언을 제공해주세요:
1. 활동 비중 분석 (어떤 활동이 많은지, 부족한지)
2. 균형 잡힌 라이프스타일을 위한 구체적인 제안
3. 개선이 필요한 영역과 해결방안
4. 격려와 동기부여 메시지

**중요**: 활동 분류를 정확히 파악하고, 각 카테고리별로 구체적인 조언을 제공하세요.
- work(업무): 업무 관련 활동
- study(공부): 학습, 자기계발, 공부 관련 활동  
- exercise(운동): 신체 활동, 운동 관련
- reading(독서): 독서, 읽기 활동
- hobby(취미): 여가, 취미 활동
- others(기타): 기타 활동

         조언은 친근하고 실용적이며, 사용자가 실제로 실행할 수 있는 구체적인 내용으로 작성해주세요.
         
         **응답 형식**:
         - 각 조언 항목은 번호와 함께 명확히 구분해주세요
         - 각 항목 내에서도 적절한 줄바꿈을 사용하여 가독성을 높여주세요
         - 이모지를 적절히 사용하여 친근함을 표현해주세요
         
         한국어로 응답하고, 300자 이내로 작성해주세요.`
      };

      const userPrompt = {
        role: 'user',
        content: `사용자 활동 분석 데이터:
- 활동 비중 (시간 단위): ${JSON.stringify(activityAnalysis)}
- 생활 패턴: ${userData.lifestylePatterns?.join(', ') || '없음'}
- 최근 스케줄: ${userData.lastSchedule ? '있음' : '없음'}

**분석 요청사항**:
1. 각 활동 카테고리별 시간 비중을 분석해주세요
2. 가장 많은 시간을 소요한 활동과 가장 적은 시간을 소요한 활동을 파악해주세요
3. 균형 잡힌 라이프스타일을 위해 개선이 필요한 영역을 제안해주세요
4. 구체적이고 실행 가능한 조언을 제공해주세요

위 데이터를 바탕으로 개인화된 AI 조언을 생성해주세요.`
      };

      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [systemPrompt, userPrompt],
          temperature: 0.7,
          max_tokens: 300
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.openaiApiKey}`
          },
          timeout: 10000
        }
      );

      return response.data.choices?.[0]?.message?.content;
    } catch (error) {
      console.error('AI 조언 생성 실패:', error);
      return '오늘 하루도 수고하셨습니다! 내일도 화이팅하세요! 💪';
    }
  }

  // 활동 관련 패턴 추출
  extractActivityPatterns(feedbacks) {
    const patterns = [];
    feedbacks.forEach(feedback => {
      const message = feedback.userMessage?.toLowerCase() || '';
      if (message.includes('운동')) {
        patterns.push({
          activity: 'exercise',
          sentiment: message.includes('더') ? 'positive' : 'negative',
          feedback: feedback.userMessage
        });
      }
      if (message.includes('공부') || message.includes('학습')) {
        patterns.push({
          activity: 'study',
          sentiment: message.includes('더') ? 'positive' : 'negative',
          feedback: feedback.userMessage
        });
      }
    });
    return patterns;
  }

  // 작업량 관련 패턴 추출
  extractWorkloadPatterns(feedbacks) {
    const patterns = [];
    feedbacks.forEach(feedback => {
      const message = feedback.userMessage?.toLowerCase() || '';
      if (message.includes('너무') || message.includes('많이')) {
        patterns.push({
          workload: 'heavy',
          sentiment: 'negative',
          feedback: feedback.userMessage
        });
      }
      if (message.includes('적당') || message.includes('좋')) {
        patterns.push({
          workload: 'moderate',
          sentiment: 'positive',
          feedback: feedback.userMessage
        });
      }
    });
    return patterns;
  }

    // GPT 호출 (공통 메서드)
    async callGPT(prompt) {
        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: '당신은 사용자 행동 패턴을 분석하는 전문가입니다. 대화 기록을 분석하여 사용자의 선호도와 패턴을 정확히 추출해주세요.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 2000
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.openaiApiKey}`
                    }
                }
            );

            const aiResponse = response.data.choices[0].message.content;
            
            // JSON 응답 파싱
            try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('JSON 형식이 아닙니다.');
                }
            } catch (parseError) {
                console.error('AI 응답 파싱 실패:', parseError);
                throw new Error('AI 응답을 파싱할 수 없습니다.');
            }
        } catch (error) {
            console.error('GPT 호출 실패:', error.response?.data || error.message);
            throw new Error('AI 분석에 실패했습니다.');
        }
    }

    // 기본 분석 결과 (AI 실패 시)
    fallbackAnalysis(feedbackText) {
        return {
            preferences: [],
            advice: [],
            analysis: "기본 분석을 수행했습니다."
        };
    }

    // 대화형 피드백 기본 분석 (AI 실패 시)
    fallbackConversationalAnalysis(conversationalFeedbacks) {
        return {
            preferences: [],
            insights: [],
            analysis: "대화형 피드백 기본 분석을 수행했습니다.",
            recommendations: []
        };
    }
}

module.exports = new AIService();
