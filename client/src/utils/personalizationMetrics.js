// 맞춤형 지표 계산 유틸리티

// 시간 파싱 헬퍼
const parseTime = (timeStr) => {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + (minutes || 0); // 분 단위로 변환
};

// 선호도 일치도 계산
export function calculatePreferenceMatch(schedule, userPreferences) {
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return 0;
  if (!userPreferences || Object.keys(userPreferences).length === 0) return 0;

  let matchedCount = 0;
  let totalChecks = 0;

  // 시간 선호도 체크
  if (userPreferences.timePreferences && userPreferences.timePreferences.length > 0) {
    userPreferences.timePreferences.forEach(pref => {
      totalChecks++;
      
      // 예: "오전에 집중형 활동 선호"
      if (pref.time === 'morning' && pref.preference === 'active') {
        const morningActivities = schedule
          .flatMap(day => day.activities || [])
          .filter(activity => {
            const time = parseTime(activity.start);
            return time >= 360 && time < 720; // 6시-12시
          });
        
        // 오전에 집중형 활동(난이도 상, 중요도 상)이 있는지 체크
        const hasActiveMorning = morningActivities.some(activity => 
          (activity.importance === '상' || activity.difficulty === '상') &&
          activity.type === 'task'
        );
        
        if (hasActiveMorning) matchedCount++;
      }
    });
  }

  // 활동 선호도 체크
  if (userPreferences.activityPreferences && userPreferences.activityPreferences.length > 0) {
    userPreferences.activityPreferences.forEach(pref => {
      totalChecks++;
      
      // 예: "운동을 더 하고 싶다"
      if (pref.activity === 'exercise' && pref.preference === 'increase') {
        const exerciseCount = schedule
          .flatMap(day => day.activities || [])
          .filter(activity => {
            const title = (activity.title || '').toLowerCase();
            return title.includes('운동') || 
                   title.includes('헬스') ||
                   title.includes('런닝') ||
                   title.includes('체육');
          }).length;
        
        // 주 3회 이상이면 증가로 간주
        if (exerciseCount >= 3) matchedCount++;
      }
    });
  }

  return totalChecks > 0 ? Math.round((matchedCount / totalChecks) * 100) : 0;
}

// 피드백 반영률 계산
export function calculateFeedbackReflectionRate(feedbacks, schedule) {
  if (!feedbacks || feedbacks.length === 0) return 0;
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return 0;

  let reflectedCount = 0;
  const totalFeedbacks = feedbacks.length;

  feedbacks.forEach(feedback => {
    const feedbackText = (feedback.userMessage || feedback.feedbackText || '').toLowerCase();
    
    // 예: "아침에 공부하는 게 좋아요" 피드백
    if (feedbackText.includes('아침') && (feedbackText.includes('공부') || feedbackText.includes('학습'))) {
      const hasMorningStudy = schedule.some(day =>
        (day.activities || []).some(activity => {
          const time = parseTime(activity.start);
          const isStudy = (activity.title || '').toLowerCase().includes('공부') || 
                         (activity.title || '').toLowerCase().includes('학습') ||
                         (activity.title || '').toLowerCase().includes('과제');
          return time >= 360 && time < 720 && isStudy; // 6시-12시
        })
      );
      
      if (hasMorningStudy) reflectedCount++;
    }
    
    // 예: "쉬는 시간이 너무 짧아요" 피드백
    if ((feedbackText.includes('쉬는') || feedbackText.includes('휴식')) && 
        (feedbackText.includes('짧') || feedbackText.includes('부족'))) {
      const hasLongBreak = schedule.some(day =>
        (day.activities || []).some(activity => {
          const title = (activity.title || '').toLowerCase();
          if (title.includes('휴식') || title.includes('쉬는') || title.includes('브레이크')) {
            const start = parseTime(activity.start);
            const end = parseTime(activity.end);
            if (start && end) {
              const duration = end - start;
              return duration >= 20; // 20분 이상
            }
          }
          return false;
        })
      );
      
      if (hasLongBreak) reflectedCount++;
    }

    // 예: "운동을 더 하고 싶어요" 피드백
    if (feedbackText.includes('운동') && (feedbackText.includes('더') || feedbackText.includes('많'))) {
      const exerciseCount = schedule
        .flatMap(day => day.activities || [])
        .filter(activity => {
          const title = (activity.title || '').toLowerCase();
          return title.includes('운동') || 
                 title.includes('헬스') ||
                 title.includes('런닝');
        }).length;
      
      if (exerciseCount >= 3) reflectedCount++;
    }
  });

  return totalFeedbacks > 0 ? Math.round((reflectedCount / totalFeedbacks) * 100) : 0;
}

// 선호도 추출 (기존 함수 재사용)
export function extractUserPreferencesFromHistory(allFeedbacks) {
  const preferences = {
    timePreferences: [],
    activityPreferences: [],
    workloadPreferences: [],
    generalFeedback: []
  };

  if (!allFeedbacks || !Array.isArray(allFeedbacks)) return preferences;

  allFeedbacks.forEach(feedback => {
    const userMessage = (feedback.userMessage || feedback.feedbackText || '').toLowerCase();
    
    // 시간 관련 선호도
    if (userMessage.includes('아침') || userMessage.includes('오전')) {
      preferences.timePreferences.push({
        time: 'morning',
        preference: userMessage.includes('부지런') || userMessage.includes('집중') ? 'active' : 'relaxed',
        feedback: feedback.userMessage || feedback.feedbackText
      });
    }
    
    if (userMessage.includes('쉬는') || userMessage.includes('휴식')) {
      preferences.timePreferences.push({
        time: 'break',
        preference: userMessage.includes('길') || userMessage.includes('많') ? 'longer' : 'shorter',
        feedback: feedback.userMessage || feedback.feedbackText
      });
    }
    
    // 활동 관련 선호도
    if (userMessage.includes('운동')) {
      preferences.activityPreferences.push({
        activity: 'exercise',
        preference: userMessage.includes('더') || userMessage.includes('많') ? 'increase' : 'decrease',
        feedback: feedback.userMessage || feedback.feedbackText
      });
    }
    
    if (userMessage.includes('공부') || userMessage.includes('학습')) {
      preferences.activityPreferences.push({
        activity: 'study',
        preference: userMessage.includes('더') || userMessage.includes('많') ? 'increase' : 'decrease',
        feedback: feedback.userMessage || feedback.feedbackText
      });
    }
  });

  return preferences;
}

