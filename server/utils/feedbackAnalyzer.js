// 사용자 피드백 분석 및 AI 조언 생성 유틸리티 (ChatGPT API 활용)

const axios = require('axios');

class FeedbackAnalyzer {
    constructor() {
        this.feedbackPatterns = {
            timePreference: [
                { pattern: /(아침|오전|모닝)/, key: 'morning_work', value: 'prefer' },
                { pattern: /(저녁|밤|야간|늦은)/, key: 'evening_work', value: 'prefer' },
                { pattern: /(점심|오후)/, key: 'afternoon_work', value: 'prefer' },
                { pattern: /(주말|토요일|일요일)/, key: 'weekend_work', value: 'prefer' },
                { pattern: /(평일|월요일|화요일|수요일|목요일|금요일)/, key: 'weekday_work', value: 'prefer' }
            ],
            workloadPreference: [
                { pattern: /(너무 많|과부하|빡빡|힘들)/, key: 'workload', value: 'reduce' },
                { pattern: /(적당|적절|좋)/, key: 'workload', value: 'maintain' },
                { pattern: /(적|부족|더 필요)/, key: 'workload', value: 'increase' }
            ],
            breakPreference: [
                { pattern: /(휴식|쉬는 시간|브레이크)/, key: 'break_duration', value: 'increase' },
                { pattern: /(연속|몰입|집중)/, key: 'break_duration', value: 'reduce' }
            ],
            activityPreference: [
                { pattern: /(운동|스포츠|피트니스)/, key: 'exercise', value: 'prefer' },
                { pattern: /(공부|학습|시험)/, key: 'study', value: 'prefer' },
                { pattern: /(프로젝트|개발|코딩)/, key: 'project_work', value: 'prefer' },
                { pattern: /(회의|미팅)/, key: 'meetings', value: 'prefer' }
            ]
        };

        this.adviceTemplates = {
            productivity: [
                {
                    condition: { workload: 'reduce' },
                    title: '과부하 감지 - 휴식 시간 확보 필요',
                    content: '현재 일정이 너무 빡빡한 것 같습니다. 하루에 최소 1-2시간의 휴식 시간을 확보하여 집중력을 유지하는 것이 좋겠습니다.'
                },
                {
                    condition: { break_duration: 'increase' },
                    title: '휴식 시간 부족 - 브레이크 타임 추가',
                    content: '연속 작업으로 인한 피로를 방지하기 위해 작업 간 15-30분의 휴식 시간을 추가하는 것을 권장합니다.'
                }
            ],
            health: [
                {
                    condition: { exercise: 'prefer' },
                    title: '운동 시간 부족 - 건강 관리 필요',
                    content: '규칙적인 운동이 건강에 중요합니다. 주 3-4회, 30분 이상의 운동 시간을 일정에 포함하는 것이 좋겠습니다.'
                },
                {
                    condition: { evening_work: 'prefer' },
                    title: '야간 작업 패턴 - 수면 품질 주의',
                    content: '야간 작업이 많다면 수면 시간을 충분히 확보하고, 블루라이트 차단을 고려해보세요.'
                }
            ],
            time_management: [
                {
                    condition: { morning_work: 'prefer' },
                    title: '아침 시간 활용 - 생산성 향상 기회',
                    content: '아침 시간을 선호하신다면, 가장 중요한 작업을 아침에 배치하여 생산성을 극대화할 수 있습니다.'
                },
                {
                    condition: { weekend_work: 'prefer' },
                    title: '주말 활용 - 평일 부담 분산',
                    content: '주말을 활용하여 평일의 부담을 분산시키는 것은 좋은 전략입니다. 단, 충분한 휴식도 고려해주세요.'
                }
            ],
            stress_relief: [
                {
                    condition: { workload: 'reduce' },
                    title: '스트레스 관리 - 마음의 여유 확보',
                    content: '과도한 일정은 스트레스의 원인이 될 수 있습니다. 하루에 1-2시간의 자유 시간을 확보하여 마음의 여유를 가지세요.'
                }
            ]
        };
    }

    // ChatGPT API를 사용한 피드백 분석 및 조언 생성
    async analyzeFeedbackWithAI(feedbackText, userData) {
        try {
            const analysisPrompt = this.buildAnalysisPrompt(feedbackText, userData);
            
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: `당신은 사용자의 스케줄 피드백을 분석하고 개인화된 조언을 제공하는 AI 비서입니다.
                            
분석해야 할 내용:
1. 피드백에서 사용자의 선호도와 불만사항 추출
2. 기존 사용자 데이터와 연관성 분석
3. 구체적이고 실용적인 개선 조언 제공
4. 사용자의 건강과 생산성을 고려한 권장사항

응답 형식:
{
  "preferences": [
    {
      "type": "time_preference|activity_preference|workload_preference",
      "key": "구체적인 키워드",
      "value": "prefer|avoid|reduce|increase|maintain",
      "confidence": 0.0-1.0
    }
  ],
  "advice": [
    {
      "type": "productivity|health|time_management|stress_relief",
      "title": "조언 제목",
      "content": "구체적인 조언 내용",
      "priority": "high|medium|low"
    }
  ],
  "analysis": "피드백에 대한 종합적인 분석"
}`
                        },
                        {
                            role: 'user',
                            content: analysisPrompt
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 1500
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
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
                    // JSON이 아닌 경우 기본 분석 결과 반환
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

    // AI 분석을 위한 프롬프트 구성
    buildAnalysisPrompt(feedbackText, userData) {
        let prompt = `사용자 피드백: "${feedbackText}"

현재 사용자 정보:`;

        // 기존 선호도 정보 추가
        if (userData.preferences && userData.preferences.length > 0) {
            prompt += '\n\n기존 선호도:';
            userData.preferences.forEach(pref => {
                prompt += `\n- ${pref.preference_type}: ${pref.preference_key} = ${pref.preference_value} (신뢰도: ${Math.round(pref.confidence_score * 100)}%)`;
            });
        }

        // 최근 피드백 정보 추가
        if (userData.recentFeedbacks && userData.recentFeedbacks.length > 0) {
            prompt += '\n\n최근 피드백:';
            userData.recentFeedbacks.slice(0, 3).forEach(feedback => {
                prompt += `\n- ${feedback.feedback_type}: ${feedback.feedback_text}`;
            });
        }

        prompt += `

위 정보를 바탕으로 다음을 분석해주세요:
1. 새로운 피드백에서 발견되는 사용자 선호도나 패턴
2. 기존 데이터와의 연관성
3. 구체적이고 실용적인 개선 조언
4. 사용자의 건강과 생산성을 고려한 권장사항

JSON 형식으로 응답해주세요.`;

        return prompt;
    }

    // AI 분석 실패 시 기본 분석 결과
    fallbackAnalysis(feedbackText) {
        const preferences = this.analyzeFeedback(feedbackText);
        const advice = this.generateBasicAdvice(preferences);
        
        return {
            preferences,
            advice,
            analysis: "기본 분석을 수행했습니다."
        };
    }

    // 피드백에서 사용자 선호도 추출 (기본 패턴 매칭)
    analyzeFeedback(feedbackText) {
        const preferences = [];

        Object.entries(this.feedbackPatterns).forEach(([type, patterns]) => {
            patterns.forEach(({ pattern, key, value }) => {
                if (pattern.test(feedbackText)) {
                    preferences.push({
                        type: type,
                        key: key,
                        value: value,
                        confidence: 0.8
                    });
                }
            });
        });

        return preferences;
    }

    // 기본 조언 생성
    generateBasicAdvice(preferences) {
        const advice = [];

        preferences.forEach(pref => {
            if (pref.type === 'workloadPreference' && pref.value === 'reduce') {
                advice.push({
                    type: 'productivity',
                    title: '과부하 해결 방안',
                    content: '일정을 조정하여 과부하를 줄이는 것이 좋겠습니다. 하루에 충분한 휴식 시간을 확보하세요.',
                    priority: 'high'
                });
            }
            
            if (pref.type === 'timePreference') {
                if (pref.key === 'morning_work') {
                    advice.push({
                        type: 'time_management',
                        title: '아침 시간 활용',
                        content: '아침 시간을 선호하신다면, 중요한 작업을 아침에 배치하여 생산성을 극대화하세요.',
                        priority: 'medium'
                    });
                }
                if (pref.key === 'evening_work') {
                    advice.push({
                        type: 'health',
                        title: '야간 작업 관리',
                        content: '야간 작업이 많다면 수면 시간을 충분히 확보하고, 블루라이트 차단을 고려해보세요.',
                        priority: 'medium'
                    });
                }
            }
        });

        return advice;
    }

    // 피드백 텍스트에서 시간대 추출
    extractTimePeriod(feedbackText) {
        const timePatterns = {
            'morning': /(아침|오전|모닝|06:00|07:00|08:00|09:00|10:00|11:00)/,
            'afternoon': /(점심|오후|12:00|13:00|14:00|15:00|16:00|17:00)/,
            'evening': /(저녁|밤|야간|18:00|19:00|20:00|21:00|22:00|23:00)/,
            'weekend': /(주말|토요일|일요일|토|일)/,
            'weekday': /(평일|월요일|화요일|수요일|목요일|금요일|월|화|수|목|금)/
        };

        for (const [period, pattern] of Object.entries(timePatterns)) {
            if (pattern.test(feedbackText)) {
                return period;
            }
        }

        return null;
    }

    // 피드백에서 구체적인 활동 추출
    extractSpecificActivities(feedbackText) {
        const activities = [];
        
        const activityPatterns = [
            /(수면|잠|취침)/,
            /(운동|스포츠|피트니스|헬스)/,
            /(공부|학습|시험|과제)/,
            /(회의|미팅|프로젝트)/,
            /(식사|아침|점심|저녁)/,
            /(업무|일|작업)/,
            /(휴식|쉬는 시간|브레이크)/
        ];

        activityPatterns.forEach(pattern => {
            const matches = feedbackText.match(pattern);
            if (matches) {
                activities.push(matches[1]);
            }
        });

        return activities;
    }

    // 피드백 타입 분류
    classifyFeedbackType(feedbackText) {
        const positivePatterns = /(좋|만족|적절|괜찮|성공|완료|달성)/;
        const negativePatterns = /(나쁘|불만|부적절|문제|실패|어려|힘들)/;
        const suggestionPatterns = /(제안|권장|추천|바람|원하|희망)/;
        const complaintPatterns = /(불평|항의|지적|비판|개선|수정)/;

        if (positivePatterns.test(feedbackText)) return 'positive';
        if (negativePatterns.test(feedbackText)) return 'negative';
        if (suggestionPatterns.test(feedbackText)) return 'suggestion';
        if (complaintPatterns.test(feedbackText)) return 'complaint';

        return 'neutral';
    }

    // ChatGPT API를 사용한 AI 조언 생성 (기존 메서드 대체)
    async generateAdvice(userPreferences, recentFeedbacks) {
        try {
            const advicePrompt = this.buildAdvicePrompt(userPreferences, recentFeedbacks);
            
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: `당신은 사용자의 스케줄 데이터를 분석하여 개인화된 조언을 제공하는 AI 비서입니다.
                            
조언 생성 기준:
1. 사용자의 선호도와 패턴을 고려
2. 최근 피드백에서 발견된 문제점 해결
3. 건강과 생산성 균형 고려
4. 구체적이고 실용적인 제안

응답 형식:
{
  "advice": [
    {
      "type": "productivity|health|time_management|stress_relief",
      "title": "조언 제목",
      "content": "구체적인 조언 내용",
      "priority": "high|medium|low"
    }
  ]
}`
                        },
                        {
                            role: 'user',
                            content: advicePrompt
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 1000
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                    }
                }
            );

            const aiResponse = response.data.choices[0].message.content;
            
            try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const result = JSON.parse(jsonMatch[0]);
                    return result.advice || [];
                }
            } catch (parseError) {
                console.error('AI 조언 응답 파싱 실패:', parseError);
            }
        } catch (error) {
            console.error('AI 조언 생성 실패:', error);
        }

        // AI 실패 시 기본 조언 반환
        return this.generateBasicAdvice(userPreferences);
    }

    // AI 조언 생성을 위한 프롬프트 구성
    buildAdvicePrompt(userPreferences, recentFeedbacks) {
        let prompt = '사용자 데이터 분석을 바탕으로 개인화된 조언을 생성해주세요.\n\n';

        if (userPreferences && userPreferences.length > 0) {
            prompt += '사용자 선호도:\n';
            userPreferences.forEach(pref => {
                prompt += `- ${pref.preference_type}: ${pref.preference_key} = ${pref.preference_value}\n`;
            });
        }

        if (recentFeedbacks && recentFeedbacks.length > 0) {
            prompt += '\n최근 피드백:\n';
            recentFeedbacks.slice(0, 3).forEach(feedback => {
                prompt += `- ${feedback.feedback_type}: ${feedback.feedback_text}\n`;
            });
        }

        prompt += '\n위 정보를 바탕으로 구체적이고 실용적인 조언을 제공해주세요.';

        return prompt;
    }
}

module.exports = new FeedbackAnalyzer(); 