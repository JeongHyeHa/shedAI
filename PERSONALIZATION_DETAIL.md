# 1번: 다양한 데이터셋 테스트 및 사용자 맞춤형 검증 - 상세 설명

## 🎯 핵심 질문: "shedAI가 정말 나에게 맞춤형 스케줄을 제공하고 있을까?"

현재 시스템은 피드백을 받아서 맞춤형 스케줄을 만든다고 하지만, **실제로 얼마나 맞춤형인지, 얼마나 개선되었는지 보여주는 화면이 없습니다.**

이 기능은 **"맞춤형이 정말 효과가 있다는 것을 보여주는 대시보드"**를 만드는 것입니다.

---

## 📊 실제 사용 시나리오 예시

### 시나리오 1: 사용자가 처음 사용할 때

**사용자 A (학생)**
- 처음 가입: 피드백 0개
- 스케줄 생성: AI가 기본 스케줄 생성
- 만족도: 3/5

**3일 후 (피드백 3개 입력 후)**
- 피드백 1: "아침에 공부하는 게 좋아요"
- 피드백 2: "쉬는 시간이 너무 짧아요"
- 피드백 3: "운동을 더 하고 싶어요"
- 스케줄 생성: AI가 피드백을 반영한 맞춤형 스케줄 생성
- 만족도: 4.5/5

**현재 시스템:**
- ✅ 피드백을 받아서 맞춤형 스케줄 생성
- ❌ 하지만 "3일 전과 비교해서 얼마나 개선되었는지" 보여주지 않음

**구현할 기능:**
- "맞춤형 효과 대시보드" 화면에서:
  - 📈 "3일 전 만족도: 3/5 → 지금: 4.5/5 (+50% 개선)"
  - 📊 "피드백 반영률: 87%" (아침 공부 배치율, 쉬는 시간 증가율 등)
  - 🎯 "선호도 일치도: 92%" (사용자가 원하는 시간대에 원하는 활동이 배치된 비율)

---

## 🎨 실제 화면 예시

### 화면 1: "나의 맞춤형 진화" 페이지

```
┌─────────────────────────────────────────────────┐
│  나의 맞춤형 진화                                │
│  ─────────────────────────────────────────────   │
│                                                  │
│  📅 가입일: 2024년 1월 1일                       │
│  📊 총 피드백: 12개                              │
│  ⭐ 현재 만족도: 4.5/5 (처음: 3.0/5)            │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │ 만족도 변화 그래프                        │   │
│  │                                          │   │
│  │  5.0 ┤                          ●       │   │
│  │  4.5 ┤                    ●             │   │
│  │  4.0 ┤              ●                   │   │
│  │  3.5 ┤        ●                           │   │
│  │  3.0 ┤  ●                                 │   │
│  │      └─────────────────────────────────  │   │
│  │       1일  3일  7일  14일  30일          │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
│  🎯 AI가 학습한 나의 선호도:                     │
│  ┌─────────────────────────────────────────┐   │
│  │ • 오전 시간대: 집중형 활동 선호 (87% 일치) │   │
│  │ • 쉬는 시간: 20분 이상 선호 (95% 일치)    │   │
│  │ • 운동 시간: 오후 6시 이후 (92% 일치)    │   │
│  │ • 주말 업무: 절대 배치 안 함 (100% 준수)  │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
│  📈 피드백 반영 통계:                            │
│  • "아침 공부" 피드백 → 87%의 스케줄에 반영     │
│  • "쉬는 시간" 피드백 → 평균 25분으로 증가      │
│  • "운동" 피드백 → 주 3회 이상 배치            │
└─────────────────────────────────────────────────┘
```

### 화면 2: "맞춤형 vs 일반 스케줄 비교"

사용자가 "맞춤형 기능 끄기" 버튼을 눌러서 비교할 수 있음

```
┌─────────────────────────────────────────────────┐
│  맞춤형 vs 일반 스케줄 비교                       │
│  ─────────────────────────────────────────────   │
│                                                  │
│  [맞춤형 ON] [맞춤형 OFF]  ← 토글 버튼           │
│                                                  │
│  ┌─────────────────┬─────────────────┐          │
│  │ 맞춤형 스케줄  │ 일반 스케줄      │          │
│  ├─────────────────┼─────────────────┤          │
│  │                 │                 │          │
│  │ 09:00 수학      │ 09:00 수학      │          │
│  │ 10:30 휴식 30분 │ 10:30 휴식 10분 │          │
│  │ 11:00 영어      │ 11:00 영어      │          │
│  │ 12:00 점심      │ 12:00 점심      │          │
│  │ 14:00 운동      │ 14:00 과제      │          │
│  │                 │                 │          │
│  ├─────────────────┼─────────────────┤          │
│  │ 만족도: 4.5/5   │ 만족도: 3.0/5   │          │
│  │ 선호도 일치: 92%│ 선호도 일치: 45%│          │
│  │ 시간 효율: 8.5h │ 시간 효율: 7.2h │          │
│  └─────────────────┴─────────────────┘          │
│                                                  │
│  💡 맞춤형 스케줄이 더 나은 이유:                 │
│  • 쉬는 시간이 30분으로 충분히 배치됨            │
│  • 운동 시간이 원하는 시간대에 배치됨            │
│  • 오전 집중 시간을 최대한 활용                  │
└─────────────────────────────────────────────────┘
```

### 화면 3: "다양한 사용자 프로필 테스트 결과"

```
┌─────────────────────────────────────────────────┐
│  다양한 사용자 프로필에서 검증됨                 │
│  ─────────────────────────────────────────────   │
│                                                  │
│  📊 테스트된 프로필별 만족도:                    │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │ 프로필 1: 대학생                        │   │
│  │ • 평균 만족도: 4.3/5                    │   │
│  │ • 선호도 일치: 89%                      │   │
│  │ • 테스트 인원: 50명                     │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │ 프로필 2: 직장인                        │   │
│  │ • 평균 만족도: 4.5/5                    │   │
│  │ • 선호도 일치: 91%                      │   │
│  │ • 테스트 인원: 45명                     │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │ 프로필 3: 프리랜서                      │   │
│  │ • 평균 만족도: 4.2/5                    │   │
│  │ • 선호도 일치: 87%                      │   │
│  │ • 테스트 인원: 30명                     │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
│  📈 전체 평균:                                   │
│  • 평균 만족도: 4.3/5                           │
│  • 평균 선호도 일치: 89%                        │
│  • 피드백 반영률: 85%                           │
└─────────────────────────────────────────────────┘
```

---

## 🔧 구체적인 구현 방법

### 1단계: 데이터 수집 시스템

#### 1.1 만족도 데이터 수집
```javascript
// client/src/components/Modals/SatisfactionModal.jsx
// 스케줄 생성 후 만족도 평가 모달

const SatisfactionModal = ({ scheduleId, onClose }) => {
  const [satisfaction, setSatisfaction] = useState(0);
  
  const handleSubmit = async () => {
    // 만족도 저장
    await firestoreService.saveSatisfaction({
      userId: user.uid,
      scheduleId,
      satisfaction, // 1-5 점수
      timestamp: new Date(),
      feedbackCount: currentFeedbackCount, // 현재 피드백 개수
      preferencesCount: currentPreferencesCount // 현재 선호도 개수
    });
    
    onClose();
  };
  
  return (
    <Modal>
      <h2>이 스케줄에 만족하시나요?</h2>
      <StarRating value={satisfaction} onChange={setSatisfaction} />
      <button onClick={handleSubmit}>제출</button>
    </Modal>
  );
};
```

#### 1.2 선호도 일치도 계산
```javascript
// client/src/utils/personalizationMetrics.js
// 선호도 일치도 계산 로직

export function calculatePreferenceMatch(schedule, userPreferences) {
  let matchedCount = 0;
  let totalChecks = 0;
  
  // 시간 선호도 체크
  userPreferences.timePreferences.forEach(pref => {
    totalChecks++;
    
    // 예: "오전에 집중형 활동 선호"
    if (pref.time === 'morning' && pref.preference === 'active') {
      const morningActivities = schedule
        .flatMap(day => day.activities)
        .filter(activity => {
          const hour = parseInt(activity.start.split(':')[0]);
          return hour >= 6 && hour < 12;
        });
      
      // 오전에 집중형 활동(난이도 상, 중요도 상)이 있는지 체크
      const hasActiveMorning = morningActivities.some(activity => 
        activity.importance === '상' || activity.difficulty === '상'
      );
      
      if (hasActiveMorning) matchedCount++;
    }
  });
  
  // 활동 선호도 체크
  userPreferences.activityPreferences.forEach(pref => {
    totalChecks++;
    
    // 예: "운동을 더 하고 싶다"
    if (pref.activity === 'exercise' && pref.preference === 'increase') {
      const exerciseCount = schedule
        .flatMap(day => day.activities)
        .filter(activity => 
          activity.title.includes('운동') || 
          activity.title.includes('헬스') ||
          activity.title.includes('런닝')
        ).length;
      
      // 주 3회 이상이면 증가로 간주
      if (exerciseCount >= 3) matchedCount++;
    }
  });
  
  return totalChecks > 0 ? (matchedCount / totalChecks) * 100 : 0;
}
```

#### 1.3 피드백 반영률 계산
```javascript
// client/src/utils/personalizationMetrics.js
// 피드백이 실제 스케줄에 반영되었는지 계산

export function calculateFeedbackReflectionRate(feedbacks, schedule) {
  let reflectedCount = 0;
  let totalFeedbacks = feedbacks.length;
  
  feedbacks.forEach(feedback => {
    const feedbackText = feedback.userMessage.toLowerCase();
    
    // 예: "아침에 공부하는 게 좋아요" 피드백
    if (feedbackText.includes('아침') && feedbackText.includes('공부')) {
      // 스케줄에 오전(6-12시)에 공부 관련 활동이 있는지 체크
      const hasMorningStudy = schedule.some(day =>
        day.activities.some(activity => {
          const hour = parseInt(activity.start.split(':')[0]);
          const isStudy = activity.title.includes('공부') || 
                         activity.title.includes('학습') ||
                         activity.title.includes('과제');
          return hour >= 6 && hour < 12 && isStudy;
        })
      );
      
      if (hasMorningStudy) reflectedCount++;
    }
    
    // 예: "쉬는 시간이 너무 짧아요" 피드백
    if (feedbackText.includes('쉬는') && feedbackText.includes('짧')) {
      // 스케줄의 휴식 시간이 20분 이상인지 체크
      const hasLongBreak = schedule.some(day =>
        day.activities.some(activity => {
          if (activity.title.includes('휴식') || activity.title.includes('쉬는')) {
            const start = parseTime(activity.start);
            const end = parseTime(activity.end);
            const duration = (end - start) / (1000 * 60); // 분 단위
            return duration >= 20;
          }
          return false;
        })
      );
      
      if (hasLongBreak) reflectedCount++;
    }
  });
  
  return totalFeedbacks > 0 ? (reflectedCount / totalFeedbacks) * 100 : 0;
}
```

### 2단계: 대시보드 컴포넌트 구현

#### 2.1 맞춤형 진화 대시보드
```javascript
// client/src/components/Report/PersonalizationDashboard.jsx

const PersonalizationDashboard = () => {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState(null);
  const [satisfactionHistory, setSatisfactionHistory] = useState([]);
  
  useEffect(() => {
    loadMetrics();
  }, [user]);
  
  const loadMetrics = async () => {
    // 1. 만족도 히스토리 로드
    const history = await firestoreService.getSatisfactionHistory(user.uid);
    setSatisfactionHistory(history);
    
    // 2. 현재 스케줄과 선호도 로드
    const userData = await firestoreService.getUserDataForAI(user.uid, user);
    const currentSchedule = await firestoreService.getCurrentSchedule(user.uid);
    const preferences = extractUserPreferencesFromHistory(userData.allFeedbackHistory);
    
    // 3. 지표 계산
    const metrics = {
      satisfaction: {
        current: history[history.length - 1]?.satisfaction || 0,
        first: history[0]?.satisfaction || 0,
        improvement: history.length > 1 
          ? ((history[history.length - 1].satisfaction - history[0].satisfaction) / history[0].satisfaction) * 100
          : 0
      },
      preferenceMatch: calculatePreferenceMatch(currentSchedule, preferences),
      feedbackReflection: calculateFeedbackReflectionRate(
        userData.allFeedbackHistory,
        currentSchedule
      ),
      totalFeedbacks: userData.allFeedbackHistory.length
    };
    
    setMetrics(metrics);
  };
  
  if (!metrics) return <Loading />;
  
  return (
    <div className="personalization-dashboard">
      <h2>나의 맞춤형 진화</h2>
      
      {/* 만족도 변화 그래프 */}
      <SatisfactionChart data={satisfactionHistory} />
      
      {/* 주요 지표 카드 */}
      <div className="metrics-cards">
        <MetricCard
          title="만족도 개선"
          value={`${metrics.satisfaction.current}/5`}
          change={`처음: ${metrics.satisfaction.first}/5`}
          improvement={`+${metrics.satisfaction.improvement.toFixed(0)}%`}
        />
        
        <MetricCard
          title="선호도 일치도"
          value={`${metrics.preferenceMatch.toFixed(0)}%`}
          description="원하는 시간대에 원하는 활동이 배치된 비율"
        />
        
        <MetricCard
          title="피드백 반영률"
          value={`${metrics.feedbackReflection.toFixed(0)}%`}
          description={`${metrics.totalFeedbacks}개 피드백 중 반영된 비율`}
        />
      </div>
      
      {/* 학습된 선호도 목록 */}
      <LearnedPreferences preferences={preferences} />
    </div>
  );
};
```

#### 2.2 비교 테스트 기능
```javascript
// client/src/components/Report/ComparisonTest.jsx
// 맞춤형 ON/OFF 비교 테스트

const ComparisonTest = () => {
  const [mode, setMode] = useState('personalized'); // 'personalized' | 'general'
  const [personalizedSchedule, setPersonalizedSchedule] = useState(null);
  const [generalSchedule, setGeneralSchedule] = useState(null);
  
  const generateSchedule = async (usePersonalization) => {
    if (usePersonalization) {
      // 맞춤형 스케줄 생성 (기존 로직)
      const schedule = await generatePersonalizedSchedule(basePrompt, context);
      setPersonalizedSchedule(schedule);
    } else {
      // 일반 스케줄 생성 (피드백 무시)
      const schedule = await generateGeneralSchedule(basePrompt);
      setGeneralSchedule(schedule);
    }
  };
  
  return (
    <div className="comparison-test">
      <h2>맞춤형 vs 일반 스케줄 비교</h2>
      
      <div className="toggle-buttons">
        <button 
          onClick={() => generateSchedule(true)}
          className={mode === 'personalized' ? 'active' : ''}
        >
          맞춤형 스케줄
        </button>
        <button 
          onClick={() => generateSchedule(false)}
          className={mode === 'general' ? 'active' : ''}
        >
          일반 스케줄
        </button>
      </div>
      
      <div className="comparison-grid">
        <ScheduleView 
          schedule={personalizedSchedule}
          title="맞춤형 스케줄"
          metrics={calculateMetrics(personalizedSchedule)}
        />
        <ScheduleView 
          schedule={generalSchedule}
          title="일반 스케줄"
          metrics={calculateMetrics(generalSchedule)}
        />
      </div>
      
      <ComparisonTable 
        personalized={calculateMetrics(personalizedSchedule)}
        general={calculateMetrics(generalSchedule)}
      />
    </div>
  );
};
```

### 3단계: 다양한 프로필 테스트 데이터

#### 3.1 테스트 프로필 생성
```javascript
// server/test/testProfiles.js
// 다양한 사용자 프로필 시뮬레이션

const testProfiles = [
  {
    id: 'student-1',
    type: '대학생',
    lifestyle: [
      '평일 9시-18시 수업',
      '주말 자유시간',
      '평일 저녁 7시-9시 운동'
    ],
    tasks: [
      { title: '중간고사 준비', deadline: '2024-03-15', importance: '상', difficulty: '상' },
      { title: '프로젝트 과제', deadline: '2024-03-20', importance: '상', difficulty: '중' },
      { title: '독서 리포트', deadline: '2024-03-25', importance: '중', difficulty: '하' }
    ],
    simulatedFeedbacks: [
      { day: 1, message: '아침에 공부하는 게 좋아요', satisfaction: 3 },
      { day: 3, message: '쉬는 시간이 너무 짧아요', satisfaction: 3.5 },
      { day: 7, message: '운동을 더 하고 싶어요', satisfaction: 4 },
      { day: 14, message: '주말에는 절대 공부 안 해요', satisfaction: 4.5 }
    ]
  },
  {
    id: 'office-worker-1',
    type: '직장인',
    lifestyle: [
      '평일 9시-18시 근무',
      '평일 저녁 7시-9시 운동',
      '주말 오전 10시-12시 독서'
    ],
    tasks: [
      { title: '프로젝트 보고서', deadline: '2024-03-15', importance: '상', difficulty: '상' },
      { title: '팀 회의 준비', deadline: '2024-03-18', importance: '중', difficulty: '중' }
    ],
    simulatedFeedbacks: [
      { day: 1, message: '저녁에 운동 시간 확보해주세요', satisfaction: 3 },
      { day: 5, message: '주말에는 업무 안 해요', satisfaction: 4 },
      { day: 10, message: '점심 시간은 자유롭게 해주세요', satisfaction: 4.5 }
    ]
  }
  // ... 더 많은 프로필
];

// 테스트 실행 함수
async function runProfileTest(profile) {
  const results = [];
  
  for (const feedback of profile.simulatedFeedbacks) {
    // 1. 스케줄 생성
    const schedule = await generateScheduleWithFeedback(
      profile.lifestyle,
      profile.tasks,
      profile.simulatedFeedbacks.slice(0, feedback.day)
    );
    
    // 2. 만족도 평가
    const satisfaction = feedback.satisfaction;
    
    // 3. 선호도 일치도 계산
    const preferences = extractPreferencesFromFeedbacks(
      profile.simulatedFeedbacks.slice(0, feedback.day)
    );
    const matchRate = calculatePreferenceMatch(schedule, preferences);
    
    // 4. 피드백 반영률 계산
    const reflectionRate = calculateFeedbackReflectionRate(
      profile.simulatedFeedbacks.slice(0, feedback.day),
      schedule
    );
    
    results.push({
      day: feedback.day,
      satisfaction,
      preferenceMatch: matchRate,
      feedbackReflection: reflectionRate
    });
  }
  
  return {
    profileId: profile.id,
    profileType: profile.type,
    results,
    averageSatisfaction: results.reduce((sum, r) => sum + r.satisfaction, 0) / results.length,
    averagePreferenceMatch: results.reduce((sum, r) => sum + r.preferenceMatch, 0) / results.length
  };
}

// 모든 프로필 테스트 실행
async function runAllProfileTests() {
  const testResults = [];
  
  for (const profile of testProfiles) {
    const result = await runProfileTest(profile);
    testResults.push(result);
  }
  
  // 전체 통계 계산
  const overallStats = {
    totalProfiles: testProfiles.length,
    averageSatisfaction: testResults.reduce((sum, r) => sum + r.averageSatisfaction, 0) / testResults.length,
    averagePreferenceMatch: testResults.reduce((sum, r) => sum + r.averagePreferenceMatch, 0) / testResults.length
  };
  
  return { testResults, overallStats };
}
```

---

## 💡 왜 이렇게 구현하는가?

### 문제점 해결
1. **현재**: "맞춤형 스케줄을 만든다"고 하지만, 실제로 얼마나 맞춤형인지 알 수 없음
2. **해결**: 만족도, 선호도 일치도, 피드백 반영률을 수치로 보여줌

### 사용자 가치
- **"내가 입력한 피드백이 정말 반영되고 있구나"**를 시각적으로 확인
- **"시간이 지나면서 점점 더 나에게 맞는 스케줄이 되고 있구나"**를 그래프로 확인
- **"맞춤형 기능이 정말 효과가 있구나"**를 비교 테스트로 확인

### 마케팅 가치
- **"다양한 사용자 프로필에서 검증됨"**이라는 신뢰성 제공
- **실제 데이터 기반의 성능 지표**를 공개하여 경쟁력 어필
- **사용자 후기와 통계**를 결합하여 설득력 있는 마케팅 자료

---

## 📝 요약

**"1번: 다양한 데이터셋 테스트 및 사용자 맞춤형 검증"**은:

1. **사용자가 보는 것**: 
   - 내 만족도가 시간이 지나면서 어떻게 개선되었는지 그래프
   - 내 피드백이 얼마나 반영되었는지 퍼센트
   - 맞춤형 vs 일반 스케줄 비교 화면

2. **개발자가 하는 것**:
   - 만족도 데이터 수집
   - 선호도 일치도 계산 로직
   - 다양한 프로필로 자동 테스트
   - 대시보드 컴포넌트 구현

3. **왜 필요한가**:
   - 맞춤형 기능이 정말 효과가 있다는 것을 증명
   - 사용자가 자신의 선택이 옳았다는 확신 제공
   - 마케팅 자료로 활용

**결론**: 단순히 "맞춤형 기능이 있다"가 아니라, **"맞춤형 기능이 얼마나 효과적인지 수치로 보여주는 대시보드"**를 만드는 것입니다.


