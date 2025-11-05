# shedAI 추가 구현 계획 및 개선 방향

## 📋 목차
1. [다양한 데이터셋 테스트 및 사용자 맞춤형 검증](#1-다양한-데이터셋-테스트-및-사용자-맞춤형-검증)
2. [모든 플랫폼 지원 (웹, 안드로이드, iOS)](#2-모든-플랫폼-지원-웹-안드로이드-ios)
3. [일정 공유/알림 기능](#3-일정-공유알림-기능)
4. [직접 일정 수정 기능](#4-직접-일정-수정-기능)
5. [기존 스케줄러 대비 우위 시각화](#5-기존-스케줄러-대비-우위-시각화)

---

## 1. 다양한 데이터셋 테스트 및 사용자 맞춤형 검증

### 🎯 구현할 기능
- **사용자 맞춤형 효과 검증 대시보드**
- **다양한 사용자 프로필 시뮬레이션**
- **맞춤형 개선 추적 시스템**

### 🔧 구현 방법

#### 1.1 맞춤형 효과 검증 대시보드
```javascript
// client/src/components/Report/PersonalizationDashboard.jsx
// 사용자 맞춤형 효과를 시각화하는 컴포넌트
```

**기능:**
- 피드백 히스토리 기반 선호도 추출 통계
- 맞춤형 스케줄 생성 전후 만족도 비교
- 시간대별 활동 선호도 히트맵
- AI 추천 정확도 추적

**데이터 수집:**
```javascript
// client/src/hooks/usePersonalizationTracking.js
// 사용자 맞춤형 데이터 추적 훅
- 피드백 반영 전후 스케줄 만족도
- 선호도 패턴 변화 추적
- 맞춤형 개선 지표 (시간 절약, 만족도 증가 등)
```

#### 1.2 다양한 사용자 프로필 테스트 데이터셋
```javascript
// server/test/testProfiles.js
// 다양한 사용자 프로필 시뮬레이션 데이터
const testProfiles = [
  {
    type: '학생',
    lifestyle: ['평일 9시-18시 수업', '주말 자유시간'],
    tasks: ['중간고사', '과제', '프로젝트'],
    preferences: { morning: 'active', break: 'longer' }
  },
  {
    type: '직장인',
    lifestyle: ['평일 9시-18시 근무', '저녁 운동'],
    tasks: ['회의', '보고서', '프로젝트'],
    preferences: { evening: 'active', break: 'shorter' }
  },
  // ... 더 많은 프로필
];
```

**테스트 시나리오:**
- 각 프로필별 스케줄 생성 품질 평가
- 맞춤형 개선 효과 측정
- 다양한 피드백 패턴 시뮬레이션

#### 1.3 A/B 테스트 시스템
```javascript
// server/services/abTestService.js
// 맞춤형 vs 일반 스케줄 비교 테스트
- 사용자 그룹 분할 (맞춤형 ON/OFF)
- 만족도, 시간 효율성, 완료율 비교
- 통계적 유의성 검증
```

### 💡 왜 필요한가?
- **사용자 신뢰 확보**: 맞춤형 기능이 실제로 효과가 있다는 것을 데이터로 증명
- **개선 방향 제시**: 어떤 부분이 잘 맞춤되는지, 개선이 필요한지 파악
- **마케팅 자료**: "다양한 사용자 프로필에서 검증됨"이라는 신뢰성 제공
- **기술적 검증**: AI 모델의 맞춤형 성능을 정량적으로 평가

---

## 2. 모든 플랫폼 지원 (웹, 안드로이드, iOS)

### 🎯 구현할 기능
- **React Native 모바일 앱**
- **PWA (Progressive Web App)**
- **크로스 플랫폼 코드 공유**

### 🔧 구현 방법

#### 2.1 React Native 앱 개발
```bash
# 프로젝트 구조
shedAI/
├── client/          # 기존 React 웹 앱
├── mobile/          # React Native 앱
│   ├── ios/
│   ├── android/
│   └── src/
│       ├── components/
│       ├── screens/
│       └── services/
└── shared/          # 공통 코드
    ├── utils/
    ├── services/
    └── types/
```

**기술 스택:**
- **React Native**: 크로스 플랫폼 모바일 앱
- **React Native Paper**: Material Design 컴포넌트
- **React Native Calendar**: 모바일 캘린더 뷰
- **Expo**: 개발 환경 및 배포 (선택사항)

**공통 코드 공유:**
```javascript
// shared/services/apiService.js
// 웹과 모바일에서 공통으로 사용하는 API 서비스
// shared/utils/scheduleUtils.js
// 스케줄 처리 로직 공유
```

#### 2.2 PWA (Progressive Web App)
```javascript
// client/public/manifest.json
{
  "name": "shedAI",
  "short_name": "shedAI",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#4CAF50",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}

// client/src/serviceWorker.js
// 오프라인 지원 및 푸시 알림
```

**PWA 기능:**
- 홈 화면에 추가 가능
- 오프라인 모드 지원
- 푸시 알림 (알림 기능과 연동)
- 앱처럼 동작

#### 2.3 모바일 전용 기능
```javascript
// mobile/src/services/notificationService.js
// 네이티브 푸시 알림
- React Native Push Notification
- 로컬 알림 (스케줄 시간 알림)

// mobile/src/services/calendarSync.js
// 기기 캘린더 연동
- react-native-calendar-events
- iOS Calendar, Android Calendar 연동
```

### 💡 왜 필요한가?
- **접근성 향상**: 모바일에서도 쉽게 일정 관리 가능
- **사용자 확대**: 웹만 지원하면 사용자층이 제한됨
- **경쟁력**: 대부분의 스케줄러 앱이 모바일 지원
- **알림 기능**: 모바일에서 푸시 알림이 더 효과적
- **오프라인 지원**: 네트워크 없이도 기본 기능 사용 가능

---

## 3. 일정 공유/알림 기능

### 🎯 구현할 기능
- **친구/사용자 간 일정 공유**
- **실시간 알림 시스템**
- **공유 일정 협업 기능**

### 🔧 구현 방법

#### 3.1 친구 시스템
```javascript
// server/services/friendService.js
// 친구 추가/삭제/조회
class FriendService {
  async addFriend(userId, friendEmail) {
    // 이메일로 친구 검색
    // 친구 요청 생성
    // Firestore에 친구 관계 저장
  }
  
  async getFriends(userId) {
    // 친구 목록 조회
  }
  
  async acceptFriendRequest(userId, requestId) {
    // 친구 요청 수락
  }
}

// Firestore 구조
users/{userId}/friends/{friendId}
  - status: 'pending' | 'accepted' | 'blocked'
  - createdAt: timestamp
  - sharedSchedules: [scheduleId1, scheduleId2]
```

#### 3.2 일정 공유 기능
```javascript
// client/src/components/Modals/ShareScheduleModal.jsx
// 일정 공유 모달 컴포넌트

// 기능:
- 공유할 일정 선택
- 친구 선택 또는 이메일 입력
- 공유 권한 설정 (읽기 전용 / 수정 가능)
- 공유 링크 생성 (선택사항)

// server/services/scheduleShareService.js
class ScheduleShareService {
  async shareSchedule(userId, scheduleId, friendIds, permissions) {
    // 공유 일정 생성
    // 친구들에게 알림 전송
    // Firestore에 공유 정보 저장
  }
  
  async getSharedSchedules(userId) {
    // 나와 공유된 일정 조회
  }
  
  async updateSharedSchedule(userId, scheduleId, updates) {
    // 공유 일정 수정 (권한 확인)
  }
}

// Firestore 구조
sharedSchedules/{shareId}
  - ownerId: string
  - scheduleId: string
  - sharedWith: [userId1, userId2]
  - permissions: { userId1: 'read', userId2: 'write' }
  - createdAt: timestamp
```

#### 3.3 알림 시스템
```javascript
// server/services/notificationService.js
// 알림 서비스 (Firebase Cloud Messaging + Firestore)

class NotificationService {
  // 스케줄 시간 알림
  async scheduleNotification(userId, eventId, eventTime) {
    // Firestore에 알림 예약
    // Cloud Functions로 실제 알림 전송
  }
  
  // 공유 일정 알림
  async notifyScheduleShared(userId, scheduleId, sharerName) {
    // 친구가 일정을 공유했을 때 알림
  }
  
  // 일정 변경 알림
  async notifyScheduleUpdated(userId, scheduleId, updaterName) {
    // 공유된 일정이 변경되었을 때 알림
  }
}

// client/src/hooks/useNotification.js
// 클라이언트 알림 훅
- 브라우저 알림 권한 요청
- FCM 토큰 관리
- 알림 수신 처리
```

**Firebase Cloud Functions:**
```javascript
// functions/index.js
// 스케줄 시간 알림 트리거
exports.sendScheduleNotifications = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async (context) => {
    // 1분 후 시작하는 일정 찾기
    // 해당 사용자에게 알림 전송
  });

// 공유 일정 알림
exports.onScheduleShared = functions.firestore
  .document('sharedSchedules/{shareId}')
  .onCreate(async (snap, context) => {
    // 공유된 사용자들에게 푸시 알림
  });
```

#### 3.4 실시간 동기화
```javascript
// client/src/hooks/useSharedScheduleSync.js
// 공유 일정 실시간 동기화
- Firestore 실시간 리스너
- 일정 변경 시 자동 업데이트
- 충돌 해결 (최신 변경 우선 또는 사용자 선택)
```

### 💡 왜 필요한가?
- **협업 기능**: 팀 프로젝트, 그룹 일정 관리에 필수
- **사용자 경험**: 일정 시간에 알림으로 놓치지 않음
- **경쟁력**: Google Calendar, Notion 등 주요 앱의 핵심 기능
- **사용자 유지**: 공유 기능으로 사용자 간 네트워크 형성
- **실용성**: 실제 일상에서 가장 많이 사용하는 기능

---

## 4. 직접 일정 수정 기능

### 🎯 구현할 기능
- **캘린더 이벤트 드래그 앤 드롭**
- **이벤트 클릭으로 수정 모달**
- **시간/날짜 직접 변경**
- **이벤트 삭제**

### 🔧 구현 방법

#### 4.1 FullCalendar 이벤트 편집 활성화
```javascript
// client/src/components/Calendar/Calendar.jsx
<FullCalendar
  // ... 기존 props
  editable={true}              // 이벤트 드래그 가능
  eventStartEditable={true}    // 시작 시간 변경 가능
  eventDurationEditable={true} // 지속 시간 변경 가능
  eventResizableFromStart={true} // 앞쪽에서 크기 조절
  eventDrop={handleEventDrop}   // 드래그 완료 핸들러
  eventResize={handleEventResize} // 크기 조절 완료 핸들러
  eventClick={handleEventClick}  // 이벤트 클릭 핸들러
  selectable={true}             // 빈 공간 선택 가능
  select={handleDateSelect}     // 날짜 선택 핸들러
/>

// client/src/routes/CalendarPageRefactored.jsx
const handleEventDrop = async (info) => {
  // 이벤트가 드래그되어 이동했을 때
  const { event } = info;
  const newStart = event.start;
  const newEnd = event.end;
  
  // 스케줄 데이터 업데이트
  await updateScheduleEvent(event.id, {
    start: newStart,
    end: newEnd,
    day: getDayFromDate(newStart)
  });
  
  // Firestore에 저장
  await firestoreService.updateScheduleEvent(user.uid, event.id, {
    start: formatTime(newStart),
    end: formatTime(newEnd)
  });
};

const handleEventResize = async (info) => {
  // 이벤트 크기가 조절되었을 때
  const { event } = info;
  await updateScheduleEvent(event.id, {
    start: event.start,
    end: event.end
  });
};

const handleEventClick = (info) => {
  // 이벤트 클릭 시 수정 모달 열기
  setSelectedEvent(info.event);
  setShowEventEditModal(true);
};
```

#### 4.2 이벤트 수정 모달
```javascript
// client/src/components/Modals/EventEditModal.jsx
// 이벤트 수정 모달 컴포넌트

const EventEditModal = ({ event, onSave, onDelete, onClose }) => {
  const [title, setTitle] = useState(event.title);
  const [start, setStart] = useState(event.start);
  const [end, setEnd] = useState(event.end);
  const [type, setType] = useState(event.extendedProps?.type);
  
  const handleSave = async () => {
    await onSave({
      id: event.id,
      title,
      start,
      end,
      type
    });
    onClose();
  };
  
  return (
    <Modal>
      <h2>일정 수정</h2>
      <input value={title} onChange={e => setTitle(e.target.value)} />
      <input type="time" value={start} onChange={e => setStart(e.target.value)} />
      <input type="time" value={end} onChange={e => setEnd(e.target.value)} />
      <button onClick={handleSave}>저장</button>
      <button onClick={() => onDelete(event.id)}>삭제</button>
      <button onClick={onClose}>취소</button>
    </Modal>
  );
};
```

#### 4.3 스케줄 데이터 동기화
```javascript
// client/src/services/firestoreService.js
async updateScheduleEvent(userId, eventId, updates) {
  // Firestore에서 스케줄 세션 찾기
  // 해당 이벤트 업데이트
  // 실시간 동기화
}

async deleteScheduleEvent(userId, eventId) {
  // 이벤트 삭제
  // 스케줄에서 제거
}
```

#### 4.4 AI 재생성 옵션
```javascript
// 이벤트 수정 후 AI에게 재생성 요청 옵션
const handleEventSave = async (updatedEvent) => {
  // 직접 수정 저장
  await saveEvent(updatedEvent);
  
  // AI 재생성 제안
  const shouldRegenerate = confirm(
    '이 일정을 변경했습니다. AI가 전체 스케줄을 다시 최적화할까요?'
  );
  
  if (shouldRegenerate) {
    // AI에게 변경사항을 피드백으로 전달
    await handleFeedbackSubmit(
      `일정을 변경했습니다: ${updatedEvent.title}을 ${updatedEvent.start}로 이동`
    );
  }
};
```

### 💡 왜 필요한가?
- **사용자 편의성**: 피드백 입력보다 직접 수정이 더 빠름
- **직관적 UX**: 드래그 앤 드롭은 가장 직관적인 인터페이스
- **유연성**: 급한 변경사항을 즉시 반영 가능
- **경쟁력**: Google Calendar, Outlook 등 모든 주요 캘린더 앱의 기본 기능
- **사용자 만족도**: "AI가 만든 스케줄을 내가 직접 조정할 수 있다"는 신뢰감

---

## 5. 기존 스케줄러 대비 우위 시각화

### 🎯 구현할 기능
- **비교 대시보드 (shedAI vs 기존 스케줄러)**
- **성능 지표 시각화**
- **사용자 만족도 추적**

### 🔧 구현 방법

#### 5.1 비교 지표 수집
```javascript
// client/src/hooks/useComparisonMetrics.js
// shedAI와 기존 스케줄러 비교 지표 수집

const metrics = {
  // 시간 효율성
  timeEfficiency: {
    timeSaved: calculateTimeSaved(), // AI 최적화로 절약된 시간
    scheduleQuality: calculateQuality(), // 스케줄 품질 점수
  },
  
  // 맞춤형 정도
  personalization: {
    feedbackReflection: calculateFeedbackReflection(), // 피드백 반영률
    preferenceMatch: calculatePreferenceMatch(), // 선호도 일치도
  },
  
  // 사용 편의성
  usability: {
    inputTime: calculateInputTime(), // 입력 소요 시간
    modificationEase: calculateModificationEase(), // 수정 편의성
  },
  
  // 완료율
  completion: {
    taskCompletionRate: calculateCompletionRate(), // 할 일 완료율
    scheduleAdherence: calculateAdherence(), // 스케줄 준수율
  }
};
```

#### 5.2 비교 대시보드
```javascript
// client/src/components/Report/ComparisonDashboard.jsx
// shedAI vs 기존 스케줄러 비교 시각화

const ComparisonDashboard = () => {
  return (
    <div>
      <h2>shedAI vs 기존 스케줄러</h2>
      
      {/* 시간 효율성 비교 */}
      <ComparisonChart
        title="시간 효율성"
        metrics={[
          { name: 'shedAI', value: metrics.timeEfficiency.timeSaved },
          { name: '기존 스케줄러', value: 0 }
        ]}
      />
      
      {/* 맞춤형 정도 비교 */}
      <ComparisonChart
        title="맞춤형 정도"
        metrics={[
          { name: 'shedAI', value: metrics.personalization.preferenceMatch },
          { name: '기존 스케줄러', value: 30 } // 예상값
        ]}
      />
      
      {/* 사용 편의성 비교 */}
      <ComparisonChart
        title="사용 편의성"
        metrics={[
          { name: 'shedAI', value: metrics.usability.inputTime },
          { name: '기존 스케줄러', value: 15 } // 예상값 (분)
        ]}
      />
      
      {/* 완료율 비교 */}
      <ComparisonChart
        title="할 일 완료율"
        metrics={[
          { name: 'shedAI', value: metrics.completion.taskCompletionRate },
          { name: '기존 스케줄러', value: 60 } // 예상값 (%)
        ]}
      />
    </div>
  );
};
```

#### 5.3 사용자 만족도 추적
```javascript
// client/src/components/Modals/SatisfactionSurvey.jsx
// 사용자 만족도 조사 모달

const SatisfactionSurvey = () => {
  const [satisfaction, setSatisfaction] = useState(0);
  const [comparison, setComparison] = useState('');
  
  return (
    <Modal>
      <h2>만족도 조사</h2>
      <p>shedAI가 기존 스케줄러보다 나은 점은 무엇인가요?</p>
      <Rating value={satisfaction} onChange={setSatisfaction} />
      <textarea
        placeholder="기존 스케줄러와 비교한 느낌을 알려주세요"
        value={comparison}
        onChange={e => setComparison(e.target.value)}
      />
      <button onClick={handleSubmit}>제출</button>
    </Modal>
  );
};

// 서버에 만족도 데이터 저장
// server/services/satisfactionService.js
async saveSatisfactionData(userId, data) {
  // 만족도 점수, 비교 의견 저장
  // 통계 분석용
}
```

#### 5.4 성능 리포트 생성
```javascript
// client/src/components/Report/PerformanceReport.jsx
// 성능 리포트 컴포넌트

const PerformanceReport = () => {
  return (
    <div>
      <h2>shedAI 성능 리포트</h2>
      
      {/* 주요 지표 카드 */}
      <MetricCards
        metrics={[
          { title: '평균 시간 절약', value: '2.5시간/주', trend: '+15%' },
          { title: '맞춤형 정확도', value: '87%', trend: '+5%' },
          { title: '할 일 완료율', value: '78%', trend: '+12%' },
          { title: '사용자 만족도', value: '4.5/5', trend: '+0.3' }
        ]}
      />
      
      {/* 시각화 차트 */}
      <Charts
        timeSavedChart={timeSavedData}
        completionRateChart={completionData}
        satisfactionChart={satisfactionData}
      />
      
      {/* 개선 제안 */}
      <ImprovementSuggestions
        suggestions={aiGeneratedSuggestions}
      />
    </div>
  );
};
```

#### 5.5 마케팅용 통계 페이지
```javascript
// client/src/routes/StatsPage.jsx
// 공개 통계 페이지 (비로그인 사용자도 볼 수 있음)

const StatsPage = () => {
  return (
    <div>
      <h1>shedAI가 다른 스케줄러보다 나은 이유</h1>
      
      {/* 전체 사용자 통계 */}
      <GlobalStats
        totalUsers={1000}
        averageTimeSaved="2.5시간/주"
        averageSatisfaction="4.5/5"
        completionRateImprovement="+15%"
      />
      
      {/* 사용자 후기 */}
      <Testimonials
        testimonials={userTestimonials}
      />
      
      {/* 기능 비교표 */}
      <FeatureComparison
        features={[
          { name: 'AI 맞춤형 스케줄', shedAI: true, others: false },
          { name: '음성/이미지 입력', shedAI: true, others: false },
          { name: '피드백 기반 학습', shedAI: true, others: false },
          // ...
        ]}
      />
    </div>
  );
};
```

### 💡 왜 필요한가?
- **차별화 포인트 명확화**: "왜 shedAI를 써야 하는가?"에 대한 명확한 답변
- **마케팅 자료**: 실제 데이터 기반의 신뢰성 있는 홍보
- **사용자 확신**: 자신의 선택이 옳았다는 확신 제공
- **개선 방향 제시**: 어떤 부분이 강점인지, 약점인지 파악
- **경쟁 우위**: 기존 스케줄러 대비 우위를 정량적으로 증명

---

## 📊 구현 우선순위

### Phase 1 (즉시 구현 - 핵심 기능)
1. **직접 일정 수정 기능** (4번)
   - 가장 많이 요청되는 기능
   - 구현 난이도: 중
   - 사용자 만족도 영향: 높음

2. **알림 기능** (3번의 일부)
   - 기본적인 스케줄 시간 알림
   - 구현 난이도: 중
   - 사용자 만족도 영향: 높음

### Phase 2 (단기 - 경쟁력 강화)
3. **일정 공유 기능** (3번의 일부)
   - 친구 시스템 + 공유 기능
   - 구현 난이도: 높음
   - 사용자 만족도 영향: 중-높음

4. **비교 대시보드** (5번)
   - 성능 지표 시각화
   - 구현 난이도: 중
   - 사용자 만족도 영향: 중

### Phase 3 (중기 - 확장)
5. **PWA 지원** (2번의 일부)
   - 오프라인 지원, 홈 화면 추가
   - 구현 난이도: 낮음-중
   - 사용자 만족도 영향: 중

6. **맞춤형 검증 대시보드** (1번)
   - 사용자 맞춤형 효과 시각화
   - 구현 난이도: 중
   - 사용자 만족도 영향: 중

### Phase 4 (장기 - 플랫폼 확장)
7. **React Native 앱** (2번)
   - iOS/Android 네이티브 앱
   - 구현 난이도: 매우 높음
   - 사용자 만족도 영향: 높음

---

## 🛠 기술 스택 요약

### 추가 필요 라이브러리
```json
{
  "dependencies": {
    // 모바일
    "react-native": "^0.72.0",
    "react-native-paper": "^5.0.0",
    "@react-native-community/push-notification-ios": "^1.0.0",
    "react-native-push-notification": "^8.0.0",
    
    // 알림
    "firebase-admin": "^11.0.0", // Cloud Functions용
    "node-cron": "^3.0.0", // 스케줄 알림용
    
    // 차트/시각화
    "recharts": "^2.8.0",
    "chart.js": "^4.4.0",
    
    // FullCalendar 편집
    "@fullcalendar/interaction": "^6.1.17", // 드래그 앤 드롭용
    
    // PWA
    "workbox-webpack-plugin": "^7.0.0"
  }
}
```

---

## 📝 결론

이 구현 계획은 shedAI를 **완전한 스케줄 관리 솔루션**으로 발전시키는 로드맵입니다. 각 기능은 사용자 경험을 크게 개선하고 경쟁력을 강화할 것입니다.

**핵심 가치:**
- 사용자 편의성 극대화
- AI 맞춤형 기능의 검증 및 시각화
- 모든 플랫폼에서 접근 가능
- 협업 및 공유 기능으로 네트워크 효과 창출


