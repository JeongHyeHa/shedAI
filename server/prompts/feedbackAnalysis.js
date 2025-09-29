// 피드백 분석용 프롬프트 템플릿
const FEEDBACK_ANALYSIS_PROMPT = {
    system: `당신은 사용자의 스케줄 피드백을 분석하고 개인화된 조언을 제공하는 AI 비서입니다.
    
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
}`,

    user: (feedbackText, userData) => {
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
};

module.exports = FEEDBACK_ANALYSIS_PROMPT;
