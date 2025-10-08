// AI 기반 사용자 패턴 분석 및 맞춤화를 위한 유틸리티 함수들

// AI에게 사용자 데이터를 넘겨서 패턴 분석 요청
export const analyzeUserPatternsWithAI = async (userData) => {
  const analysisPrompt = `
당신은 사용자 행동 패턴을 분석하는 전문가입니다.

다음 사용자 데이터를 분석하여 패턴을 찾고, 맞춤형 조언을 제공해주세요:

[사용자 데이터]
- 생활 패턴: ${JSON.stringify(userData.lifestylePatterns || [])}
- 할 일 목록: ${JSON.stringify(userData.tasks || [])}
- 피드백 이력: ${JSON.stringify(userData.feedbacks || [])}
- 스케줄 이력: ${JSON.stringify(userData.schedules || [])}

다음 JSON 형식으로 분석 결과를 반환해주세요:

{
  "patterns": {
    "timePreferences": {
      "preferredTimeOfDay": "morning/afternoon/evening/night",
      "reasoning": "분석 근거"
    },
    "workStyle": {
      "style": "continuous/distributed/mixed",
      "reasoning": "분석 근거"
    },
    "breakPreferences": {
      "needMoreBreaks": true/false,
      "reasoning": "분석 근거"
    },
    "productivityPatterns": {
      "mostProductiveTimes": ["시간대1", "시간대2"],
      "commonChallenges": ["도전1", "도전2"],
      "reasoning": "분석 근거"
    }
  },
  "insights": [
    {
      "type": "strength",
      "title": "강점",
      "description": "사용자의 강점 설명",
      "confidence": 0.8
    },
    {
      "type": "improvement",
      "title": "개선점",
      "description": "개선이 필요한 부분",
      "confidence": 0.7
    }
  ],
  "recommendations": [
    {
      "category": "schedule_optimization",
      "title": "스케줄 최적화 제안",
      "description": "구체적인 제안 내용",
      "priority": "high/medium/low"
    }
  ],
  "personalizedAdvice": [
    {
      "type": "encouragement",
      "message": "격려 메시지"
    },
    {
      "type": "tip",
      "message": "실용적인 팁"
    }
  ]
}

분석할 때 다음을 고려해주세요:
1. 사용자의 시간 선호도 (아침형/저녁형 등)
2. 작업 스타일 (연속 작업 선호/분산 작업 선호)
3. 휴식 패턴과 필요성
4. 생산성 패턴과 도전 과제
5. 피드백에서 나타나는 만족도와 불만사항
6. 할 일 완료 패턴과 우선순위 선호도

사용자에게 도움이 되는 구체적이고 실용적인 조언을 제공해주세요.
`;

  try {
    // AI API 호출 (실제 구현에서는 apiService 사용)
    const response = await fetch('/api/ai/analyze-patterns', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: analysisPrompt,
        userData
      })
    });

    if (!response.ok) {
      throw new Error('AI 분석 요청 실패');
    }

    const result = await response.json();
    return result.analysis;
  } catch (error) {
    console.error('AI 패턴 분석 실패:', error);
    return null;
  }
};

// AI 기반 맞춤형 프롬프트 생성
export const generatePersonalizedPromptWithAI = async (userData, basePrompt) => {
  const personalizationPrompt = `
당신은 사용자 맞춤형 스케줄 생성을 위한 프롬프트를 만드는 전문가입니다.

[사용자 데이터]
- 생활 패턴: ${JSON.stringify(userData.lifestylePatterns || [])}
- 할 일 목록: ${JSON.stringify(userData.tasks || [])}
- 피드백 이력: ${JSON.stringify(userData.feedbacks || [])}
- 스케줄 이력: ${JSON.stringify(userData.schedules || [])}

[기본 프롬프트]
${basePrompt}

위 사용자 데이터를 분석하여, 기본 프롬프트에 사용자 맞춤형 지침을 추가해주세요.

다음 형식으로 맞춤화된 프롬프트를 반환해주세요:

{
  "personalizedPrompt": "맞춤화된 전체 프롬프트",
  "userSpecificGuidelines": [
    "사용자별 특별 지침 1",
    "사용자별 특별 지침 2"
  ],
  "reasoning": "맞춤화 근거 설명"
}

사용자의 다음 패턴을 고려해주세요:
1. 시간 선호도 (아침형/저녁형)
2. 작업 스타일 (연속/분산)
3. 휴식 필요성
4. 생산성 패턴
5. 과거 피드백에서 나타난 선호도
6. 할 일 완료 패턴

사용자가 "와, 정말 내 상황에 맞는 일정이다!"라고 느낄 수 있도록 구체적이고 개인화된 지침을 추가해주세요.
`;

  try {
    const response = await fetch('/api/ai/personalize-prompt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: personalizationPrompt,
        userData,
        basePrompt
      })
    });

    if (!response.ok) {
      throw new Error('AI 프롬프트 맞춤화 실패');
    }

    const result = await response.json();
    return result.personalizedPrompt;
  } catch (error) {
    console.error('AI 프롬프트 맞춤화 실패:', error);
    return basePrompt; // 실패 시 기본 프롬프트 반환
  }
};

// AI 기반 사용자 조언 생성
export const generatePersonalizedAdviceWithAI = async (userData) => {
  const advicePrompt = `
당신은 사용자에게 맞춤형 조언을 제공하는 전문가입니다.

[사용자 데이터]
- 생활 패턴: ${JSON.stringify(userData.lifestylePatterns || [])}
- 할 일 목록: ${JSON.stringify(userData.tasks || [])}
- 피드백 이력: ${JSON.stringify(userData.feedbacks || [])}
- 스케줄 이력: ${JSON.stringify(userData.schedules || [])}

위 데이터를 분석하여 사용자에게 도움이 되는 맞춤형 조언을 제공해주세요.

다음 JSON 형식으로 조언을 반환해주세요:

{
  "advice": [
    {
      "type": "encouragement",
      "title": "격려 제목",
      "message": "격려 메시지",
      "priority": "high/medium/low"
    },
    {
      "type": "tip",
      "title": "팁 제목", 
      "message": "실용적인 팁",
      "priority": "high/medium/low"
    },
    {
      "type": "warning",
      "title": "주의사항 제목",
      "message": "주의할 점",
      "priority": "high/medium/low"
    }
  ],
  "insights": [
    {
      "category": "productivity",
      "title": "생산성 인사이트",
      "description": "사용자의 생산성 패턴 분석 결과",
      "confidence": 0.8
    }
  ],
  "recommendations": [
    {
      "category": "schedule_optimization",
      "title": "스케줄 최적화 제안",
      "description": "구체적인 개선 제안",
      "actionable": true
    }
  ]
}

다음 사항을 고려해주세요:
1. 사용자의 강점을 인정하고 격려
2. 개선이 필요한 부분에 대한 실용적인 조언
3. 과거 피드백에서 나타난 패턴 반영
4. 구체적이고 실행 가능한 제안
5. 사용자의 상황에 맞는 조언

친근하고 도움이 되는 톤으로 조언해주세요.
`;

  try {
    const response = await fetch('/api/ai/generate-advice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: advicePrompt,
        userData
      })
    });

    if (!response.ok) {
      throw new Error('AI 조언 생성 실패');
    }

    const result = await response.json();
    return result.advice;
  } catch (error) {
    console.error('AI 조언 생성 실패:', error);
    return {
      advice: [{
        type: 'tip',
        title: '기본 조언',
        message: '규칙적인 생활 패턴을 유지하시고, 충분한 휴식을 취하세요.',
        priority: 'medium'
      }],
      insights: [],
      recommendations: []
    };
  }
};
