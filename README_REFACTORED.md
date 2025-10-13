# ShedAI - 개선된 프로젝트 구조

## 📁 최적화된 폴더 구조

```
shedAI/
├── client/                          # React 프론트엔드
│   ├── src/
│   │   ├── components/              # 재사용 가능한 컴포넌트
│   │   │   ├── Auth/               # 인증 관련 컴포넌트
│   │   │   │   ├── LoginForm.jsx
│   │   │   │   └── SignUpForm.jsx
│   │   │   ├── Calendar/           # 캘린더 관련 컴포넌트
│   │   │   │   ├── Calendar.jsx
│   │   │   │   ├── CalendarControls.jsx
│   │   │   │   └── CalendarHeader.jsx
│   │   │   ├── Chatbot/            # 챗봇 관련 컴포넌트
│   │   │   │   └── Chatbot.jsx
│   │   │   ├── Modals/             # 모달 컴포넌트들
│   │   │   │   ├── TaskFormModal.jsx
│   │   │   │   ├── LifestyleModal.jsx
│   │   │   │   └── Modals.jsx
│   │   │   └── UI/                 # UI 컴포넌트들
│   │   │       ├── ToggleSwitch.jsx
│   │   │       ├── LoadingSpinner.jsx
│   │   │       └── FloatingButtons.jsx
│   │   ├── hooks/                  # 커스텀 훅 (최적화됨)
│   │   │   ├── useImageProcessing.js
│   │   │   ├── useLifestyleSync.js
│   │   │   ├── useMessageManagement.js
│   │   │   ├── usePersonalizedAI.js
│   │   │   ├── useScheduleManagement.js
│   │   │   └── useVoiceRecording.js
│   │   ├── services/               # API 서비스
│   │   │   ├── apiService.js
│   │   │   ├── authService.js
│   │   │   └── firestoreService.js
│   │   ├── contexts/               # React Context
│   │   │   └── AuthContext.js
│   │   ├── constants/              # 상수 정의
│   │   │   ├── api.js
│   │   │   └── ui.js
│   │   ├── routes/                 # 페이지 컴포넌트
│   │   │   └── CalendarPageRefactored.jsx
│   │   ├── utils/                  # 유틸리티 함수
│   │   │   ├── dateUtils.js
│   │   │   └── scheduleUtils.js
│   │   ├── config/                 # 설정 파일
│   │   │   └── firebase.js
│   │   └── styles/                 # CSS 스타일
│   │       ├── calendar.css
│   │       ├── chatbot.css
│   │       ├── floating.css
│   │       ├── fullcalendar-custom.css
│   │       ├── modal.css
│   │       └── style.css
├── server/                          # Node.js 백엔드 (최적화됨)
│   ├── routes/                      # API 라우트
│   │   └── aiRoutes.js             # AI 관련 라우트만 유지
│   ├── controllers/                 # 비즈니스 로직
│   │   └── aiController.js         # AI 컨트롤러만 유지
│   ├── services/                    # 서비스 레이어
│   │   └── aiService.js            # AI 서비스만 유지
│   ├── app.js                       # Express 앱 설정
│   └── server.js                    # 서버 시작점
└── firebase.json                    # Firebase 설정
```

## 🚀 주요 개선사항

### 1. **서버 구조 개선**
- ✅ **라우트 분리**: API 엔드포인트별로 라우트 파일 분리
- ✅ **컨트롤러 분리**: 비즈니스 로직을 컨트롤러로 분리
- ✅ **서비스 레이어**: AI 서비스 로직 분리
- ✅ **프롬프트 템플릿**: AI 프롬프트를 별도 파일로 분리
- ✅ **설정 파일**: 데이터베이스 설정 분리

### 2. **클라이언트 구조 개선**
- ✅ **컴포넌트 분리**: 큰 컴포넌트를 작은 단위로 분리
- ✅ **커스텀 훅**: 재사용 가능한 로직을 훅으로 분리
- ✅ **서비스 레이어**: API 호출 로직 분리
- ✅ **상수 분리**: 하드코딩된 값들을 상수로 분리
- ✅ **타입 안정성**: 일관된 데이터 구조 사용

### 3. **코드 품질 향상**
- ✅ **단일 책임 원칙**: 각 파일이 하나의 역할만 담당
- ✅ **재사용성**: 컴포넌트와 훅의 재사용성 향상
- ✅ **유지보수성**: 코드 구조가 명확하고 수정이 용이
- ✅ **확장성**: 새로운 기능 추가가 쉬운 구조

## 🛠️ 실행 방법

### 개발 환경 실행
```bash
# 서버 실행
npm run server

# 클라이언트 실행 (새 터미널)
npm run client

# 또는 동시 실행
npm run dev
```

### 프로덕션 빌드
```bash
# 클라이언트 빌드
cd client
npm run build

# 서버 실행
npm run server
```

## 📋 기능 목록

### ✅ 구현 완료된 기능
- **이미지 입력**: GPT-4o Vision API를 사용한 OCR
- **음성 입력**: Whisper API를 사용한 음성 인식
- **생활패턴 관리**: 사용자 생활패턴 저장 및 관리
- **할 일 관리**: 우선순위 기반 할 일 입력
- **AI 스케줄 생성**: GPT-4o를 사용한 개인화된 스케줄 생성
- **피드백 시스템**: 사용자 피드백 분석 및 AI 조언
- **캘린더 UI**: FullCalendar를 사용한 시각적 일정 관리

### 🔄 개선된 구조의 장점
1. **코드 가독성**: 각 파일의 역할이 명확
2. **유지보수성**: 특정 기능 수정 시 해당 파일만 수정
3. **테스트 용이성**: 각 컴포넌트와 서비스를 독립적으로 테스트 가능
4. **확장성**: 새로운 기능 추가 시 기존 코드에 영향 최소화
5. **협업 효율성**: 여러 개발자가 동시에 작업하기 용이

## 🎯 다음 단계 권장사항

1. **테스트 코드 작성**: 각 컴포넌트와 서비스에 대한 단위 테스트
2. **에러 처리 강화**: 더 세밀한 에러 처리 및 사용자 피드백
3. **성능 최적화**: 메모이제이션 및 렌더링 최적화
4. **타입스크립트 도입**: 타입 안정성 향상
5. **클라우드 DB 마이그레이션**: PostgreSQL 또는 MongoDB로 전환
6. **인증 시스템**: JWT 기반 사용자 인증
7. **API 문서화**: Swagger 등을 사용한 API 문서 자동 생성

## 📝 주요 변경사항

### 서버 변경사항
- `server.js` → `app.js` + `server.js`로 분리
- `database.js` → `config/database.js`로 이동
- 프롬프트 → `prompts/` 폴더로 분리
- API 로직 → `controllers/`와 `services/`로 분리

### 클라이언트 변경사항
- `CalendarPage.jsx` → 여러 컴포넌트로 분리
- 공통 로직 → 커스텀 훅으로 분리
- API 호출 → `services/apiService.js`로 분리
- 상수 → `constants/` 폴더로 분리

이제 코드가 훨씬 더 체계적이고 유지보수하기 쉬운 구조가 되었습니다! 🎉
