// 사용자 패턴 분석 및 맞춤화를 위한 서버 사이드 서비스

class UserAnalysisService {
  constructor() {
    // 사용자 패턴 분석을 위한 설정
    this.analysisWeights = {
      feedback: 0.4,      // 피드백 가중치
      lifestyle: 0.3,     // 생활 패턴 가중치
      tasks: 0.3          // 할 일 패턴 가중치
    };
  }

  // 사용자 패턴 종합 분석
  async analyzeUserPatterns(userId) {
    try {
      // 사용자 데이터 조회
      const userData = await this.getUserData(userId);
      
      // 각 영역별 패턴 분석
      const feedbackPatterns = this.analyzeFeedbackPatterns(userData.feedbacks);
      const lifestylePatterns = this.analyzeLifestylePatterns(userData.lifestylePatterns);
      const taskPatterns = this.analyzeTaskPatterns(userData.tasks);
      
      // 종합 점수 계산
      const overallScore = this.calculateOverallScore({
        feedback: feedbackPatterns,
        lifestyle: lifestylePatterns,
        tasks: taskPatterns
      });

      return {
        userId,
        patterns: {
          feedback: feedbackPatterns,
          lifestyle: lifestylePatterns,
          tasks: taskPatterns
        },
        overallScore,
        recommendations: this.generateRecommendations(feedbackPatterns, lifestylePatterns, taskPatterns),
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('사용자 패턴 분석 실패:', error);
      throw error;
    }
  }

  // 피드백 패턴 분석
  analyzeFeedbackPatterns(feedbacks) {
    if (!feedbacks || feedbacks.length === 0) {
      return { confidence: 0, patterns: {} };
    }

    const patterns = {
      timePreferences: {},
      workStyle: {},
      breakPreferences: {},
      satisfactionTrend: [],
      commonIssues: []
    };

    feedbacks.forEach(feedback => {
      const text = feedback.feedback_text.toLowerCase();
      
      // 시간 선호도 분석
      this.extractTimePreferences(text, patterns.timePreferences);
      
      // 작업 스타일 분석
      this.extractWorkStyle(text, patterns.workStyle);
      
      // 휴식 선호도 분석
      this.extractBreakPreferences(text, patterns.breakPreferences);
      
      // 만족도 트렌드 분석
      this.extractSatisfactionTrend(feedback, patterns.satisfactionTrend);
      
      // 공통 이슈 추출
      this.extractCommonIssues(text, patterns.commonIssues);
    });

    return {
      confidence: Math.min(feedbacks.length / 10, 1), // 피드백 수에 따른 신뢰도
      patterns
    };
  }

  // 생활 패턴 분석
  analyzeLifestylePatterns(lifestylePatterns) {
    if (!lifestylePatterns || lifestylePatterns.length === 0) {
      return { confidence: 0, patterns: {} };
    }

    const patterns = {
      sleepSchedule: this.extractSleepPattern(lifestylePatterns),
      mealTimes: this.extractMealTimes(lifestylePatterns),
      workHours: this.extractWorkHours(lifestylePatterns),
      exerciseSchedule: this.extractExerciseSchedule(lifestylePatterns),
      freeTime: this.extractFreeTime(lifestylePatterns)
    };

    return {
      confidence: Math.min(lifestylePatterns.length / 5, 1),
      patterns
    };
  }

  // 할 일 패턴 분석
  analyzeTaskPatterns(tasks) {
    if (!tasks || tasks.length === 0) {
      return { confidence: 0, patterns: {} };
    }

    const patterns = {
      importanceDistribution: this.calculateImportanceDistribution(tasks),
      difficultyDistribution: this.calculateDifficultyDistribution(tasks),
      deadlinePatterns: this.analyzeDeadlinePatterns(tasks),
      commonKeywords: this.extractCommonKeywords(tasks),
      completionRate: this.calculateCompletionRate(tasks)
    };

    return {
      confidence: Math.min(tasks.length / 20, 1),
      patterns
    };
  }

  // 종합 점수 계산
  calculateOverallScore(patternData) {
    const scores = {
      feedback: patternData.feedback.confidence * this.analysisWeights.feedback,
      lifestyle: patternData.lifestyle.confidence * this.analysisWeights.lifestyle,
      tasks: patternData.tasks.confidence * this.analysisWeights.tasks
    };

    return {
      overall: Object.values(scores).reduce((sum, score) => sum + score, 0),
      breakdown: scores
    };
  }

  // 맞춤형 추천 생성
  generateRecommendations(feedbackPatterns, lifestylePatterns, taskPatterns) {
    const recommendations = [];

    // 피드백 기반 추천
    if (feedbackPatterns.patterns.timePreferences) {
      const timePrefs = feedbackPatterns.patterns.timePreferences;
      if (timePrefs.morning > timePrefs.evening) {
        recommendations.push({
          type: 'schedule_optimization',
          title: '아침 시간 활용',
          description: '중요한 작업을 오전 시간대에 배치하는 것을 권장합니다.',
          priority: 'high'
        });
      }
    }

    // 생활 패턴 기반 추천
    if (lifestylePatterns.patterns.sleepSchedule) {
      recommendations.push({
        type: 'lifestyle_optimization',
        title: '수면 패턴 고려',
        description: '현재 수면 패턴을 고려하여 최적의 작업 시간을 제안합니다.',
        priority: 'medium'
      });
    }

    // 할 일 패턴 기반 추천
    if (taskPatterns.patterns.completionRate < 0.7) {
      recommendations.push({
        type: 'productivity_improvement',
        title: '완료율 향상',
        description: '할 일 완료율을 높이기 위해 더 현실적인 스케줄링을 제안합니다.',
        priority: 'high'
      });
    }

    return recommendations;
  }

  // 사용자 맞춤형 프롬프트 생성
  generatePersonalizedPrompt(userPatterns, basePrompt) {
    let personalizedPrompt = basePrompt;

    // 피드백 패턴 반영
    if (userPatterns.feedback && userPatterns.feedback.confidence > 0.3) {
      const feedback = userPatterns.feedback.patterns;
      
      if (feedback.timePreferences) {
        personalizedPrompt += this.generateTimePreferencePrompt(feedback.timePreferences);
      }
      
      if (feedback.workStyle) {
        personalizedPrompt += this.generateWorkStylePrompt(feedback.workStyle);
      }
    }

    // 생활 패턴 반영
    if (userPatterns.lifestyle && userPatterns.lifestyle.confidence > 0.3) {
      const lifestyle = userPatterns.lifestyle.patterns;
      
      if (lifestyle.sleepSchedule) {
        personalizedPrompt += this.generateSleepSchedulePrompt(lifestyle.sleepSchedule);
      }
    }

    return personalizedPrompt;
  }

  // 시간 선호도 프롬프트 생성
  generateTimePreferencePrompt(timePreferences) {
    let prompt = '\n\n[사용자 시간 선호도 분석 결과]\n';
    
    if (timePreferences.morning > timePreferences.evening) {
      prompt += '- 사용자는 아침 시간대를 선호합니다. 중요한 작업을 오전에 배치하세요.\n';
    } else if (timePreferences.evening > timePreferences.morning) {
      prompt += '- 사용자는 저녁 시간대를 선호합니다. 집중이 필요한 작업을 오후/저녁에 배치하세요.\n';
    }
    
    return prompt;
  }

  // 작업 스타일 프롬프트 생성
  generateWorkStylePrompt(workStyle) {
    let prompt = '\n[사용자 작업 스타일 분석 결과]\n';
    
    if (workStyle.continuous > workStyle.distributed) {
      prompt += '- 사용자는 연속 작업을 선호합니다. 관련된 작업들을 연속으로 배치하세요.\n';
    } else {
      prompt += '- 사용자는 분산 작업을 선호합니다. 작업을 여러 시간대로 나누어 배치하세요.\n';
    }
    
    return prompt;
  }

  // 수면 패턴 프롬프트 생성
  generateSleepSchedulePrompt(sleepSchedule) {
    let prompt = '\n[사용자 수면 패턴]\n';
    
    if (sleepSchedule.bedtime && sleepSchedule.wakeup) {
      prompt += `- 취침 시간: ${sleepSchedule.bedtime}\n`;
      prompt += `- 기상 시간: ${sleepSchedule.wakeup}\n`;
      prompt += '- 수면 시간을 고려하여 작업 시간을 조정하세요.\n';
    }
    
    return prompt;
  }

  // 헬퍼 메서드들
  extractTimePreferences(text, timePreferences) {
    if (text.includes('아침') || text.includes('오전')) {
      timePreferences.morning = (timePreferences.morning || 0) + 1;
    }
    if (text.includes('저녁') || text.includes('오후')) {
      timePreferences.evening = (timePreferences.evening || 0) + 1;
    }
    if (text.includes('야간') || text.includes('밤')) {
      timePreferences.night = (timePreferences.night || 0) + 1;
    }
  }

  extractWorkStyle(text, workStyle) {
    if (text.includes('연속') || text.includes('몰아서')) {
      workStyle.continuous = (workStyle.continuous || 0) + 1;
    }
    if (text.includes('분산') || text.includes('나누어')) {
      workStyle.distributed = (workStyle.distributed || 0) + 1;
    }
  }

  extractBreakPreferences(text, breakPreferences) {
    if (text.includes('쉬는') || text.includes('휴식')) {
      breakPreferences.needMore = (breakPreferences.needMore || 0) + 1;
    }
  }

  extractSatisfactionTrend(feedback, satisfactionTrend) {
    // 만족도 점수 계산 (간단한 예시)
    const text = feedback.feedback_text.toLowerCase();
    let score = 0;
    
    if (text.includes('좋') || text.includes('만족') || text.includes('완벽')) {
      score = 1;
    } else if (text.includes('괜찮') || text.includes('보통')) {
      score = 0.5;
    } else if (text.includes('안 좋') || text.includes('불만') || text.includes('문제')) {
      score = -1;
    }
    
    satisfactionTrend.push({
      date: feedback.created_at,
      score
    });
  }

  extractCommonIssues(text, commonIssues) {
    const issues = ['너무 빡빡', '시간 부족', '휴식 부족', '우선순위', '난이도'];
    
    issues.forEach(issue => {
      if (text.includes(issue)) {
        commonIssues.push(issue);
      }
    });
  }

  // 기타 헬퍼 메서드들...
  extractSleepPattern(patterns) {
    // 수면 패턴 추출 로직
    return {};
  }

  extractMealTimes(patterns) {
    // 식사 시간 추출 로직
    return [];
  }

  extractWorkHours(patterns) {
    // 근무 시간 추출 로직
    return {};
  }

  extractExerciseSchedule(patterns) {
    // 운동 스케줄 추출 로직
    return [];
  }

  extractFreeTime(patterns) {
    // 자유 시간 추출 로직
    return [];
  }

  calculateImportanceDistribution(tasks) {
    const distribution = {};
    tasks.forEach(task => {
      if (task.importance) {
        distribution[task.importance] = (distribution[task.importance] || 0) + 1;
      }
    });
    return distribution;
  }

  calculateDifficultyDistribution(tasks) {
    const distribution = {};
    tasks.forEach(task => {
      if (task.difficulty) {
        distribution[task.difficulty] = (distribution[task.difficulty] || 0) + 1;
      }
    });
    return distribution;
  }

  analyzeDeadlinePatterns(tasks) {
    const patterns = { urgent: 0, soon: 0, later: 0 };
    const today = new Date();
    
    tasks.forEach(task => {
      if (task.deadline) {
        const deadline = new Date(task.deadline);
        const daysDiff = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
        
        if (daysDiff <= 1) patterns.urgent++;
        else if (daysDiff <= 7) patterns.soon++;
        else patterns.later++;
      }
    });
    
    return patterns;
  }

  extractCommonKeywords(tasks) {
    const keywordCount = {};
    const commonKeywords = [
      '시험', '발표', '프로젝트', '과제', '회의', '보고서', '공부', '복습', '예습',
      '코딩', '프로그래밍', '디자인', '작업', '준비', '정리', '검토', '수정'
    ];

    tasks.forEach(task => {
      const text = (task.title + ' ' + (task.description || '')).toLowerCase();
      commonKeywords.forEach(keyword => {
        if (text.includes(keyword)) {
          keywordCount[keyword] = (keywordCount[keyword] || 0) + 1;
        }
      });
    });

    return Object.entries(keywordCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([keyword, count]) => ({ keyword, count }));
  }

  calculateCompletionRate(tasks) {
    const completed = tasks.filter(task => task.status === 'completed').length;
    return tasks.length > 0 ? completed / tasks.length : 0;
  }

  async getUserData(userId) {
    // 실제 구현에서는 데이터베이스에서 사용자 데이터를 조회
    // 여기서는 예시 구조만 제공
    return {
      feedbacks: [],
      lifestylePatterns: [],
      tasks: []
    };
  }
}

module.exports = new UserAnalysisService();
