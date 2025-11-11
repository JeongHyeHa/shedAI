# shedAI
사용자 생활패턴 기반 일정 자동관리 AI 앱

## 📁 프로젝트 구조

```
shedAI/
├── client/                          # React 프론트엔드
│   ├── src/
│   │   ├── components/              # 재사용 가능한 컴포넌트
│   │   │   ├── Auth/               # 인증 관련 컴포넌트
│   │   │   ├── Calendar/           # 캘린더 관련 컴포넌트
│   │   │   ├── Chatbot/            # 챗봇 관련 컴포넌트
│   │   │   ├── Modals/             # 모달 컴포넌트들
│   │   │   └── UI/                 # UI 컴포넌트들
│   │   ├── hooks/                  # 커스텀 훅
│   │   ├── services/               # API 서비스
│   │   ├── contexts/               # React Context
│   │   ├── routes/                 # 페이지 컴포넌트
│   │   └── utils/                  # 유틸리티 함수
│   └── public/                     # 정적 파일
├── server/                          # Node.js 백엔드
│   ├── routes/                      # API 라우트
│   ├── controllers/                 # 비즈니스 로직
│   ├── services/                    # 서비스 레이어
│   └── utils/                       # 유틸리티 함수
├── functions/                       # Firebase Cloud Functions
├── android/                         # Android 네이티브 프로젝트 (Capacitor)
└── ios/                             # iOS 네이티브 프로젝트 (Capacitor)
```

## 🚀 실행 방법

### 개발 환경 실행
```bash
# 서버 실행
npm run server

# 클라이언트 실행 (새 터미널)
cd client
npm start

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

## 📋 주요 기능

### ✅ 구현 완료된 기능
- **이미지 입력**: GPT-4o Vision API를 사용한 OCR
- **음성 입력**: Whisper API를 사용한 음성 인식
- **생활패턴 관리**: 사용자 생활패턴 저장 및 관리
- **할 일 관리**: 우선순위 기반 할 일 입력
- **AI 스케줄 생성**: GPT-4o를 사용한 개인화된 스케줄 생성
- **피드백 시스템**: 사용자 피드백 분석 및 AI 조언
- **캘린더 UI**: FullCalendar를 사용한 시각적 일정 관리
- **FCM 알림**: 웹 및 Android 푸시 알림 지원

### 🔄 서비스 확장성 기능 (개발 중)
- **일정 공유**: 사용자 간 일정 공유 및 협업
- **일정 알림 메시지**: 공유 일정 변경, 일정 시작 전 알림
- **외부 SNS 연동**: 다른 플랫폼과의 연결 및 공유
- **캘린더 연동**: Google Calendar, Outlook 등 외부 캘린더와의 동기화

## 🎯 핵심 방향성

**개인 맞춤형 일정 관리 서비스에서 사용자 네트워크와 자연스럽게 연결되는 확장 가능한 서비스**

개인 맞춤형 기능을 유지하면서도, 사용자 간 연결과 협업이 가능한 방향으로 확장하는 것이 목표입니다.

## 📚 문서

- [구현 계획](./IMPLEMENTATION_PLAN.md) - 전체 구현 계획 및 확장성 전략
- [최종 개발 계획](./FINAL_DEVELOPMENT_PLAN.md) - 7일 단기 개발 계획
- [주간 개발 계획](./WEEKLY_DEVELOPMENT_PLAN.md) - 주간 개발 계획
- [FCM 설정 가이드](./FCM_SETUP_GUIDE.md) - FCM 알림 설정 가이드
- [Android 다음 단계](./ANDROID_NEXT_STEPS.md) - Android 개발 가이드

## 🛠 기술 스택

- **Frontend**: React, FullCalendar, Capacitor
- **Backend**: Node.js, Express
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth
- **Push Notifications**: Firebase Cloud Messaging (FCM)
- **AI**: OpenAI GPT-4o, Whisper API
- **Mobile**: Capacitor (Android, iOS)

## 📝 주요 개선사항

### 1. 서버 구조 개선
- 라우트 분리: API 엔드포인트별로 라우트 파일 분리
- 컨트롤러 분리: 비즈니스 로직을 컨트롤러로 분리
- 서비스 레이어: AI 서비스 로직 분리

### 2. 클라이언트 구조 개선
- 컴포넌트 분리: 큰 컴포넌트를 작은 단위로 분리
- 커스텀 훅: 재사용 가능한 로직을 훅으로 분리
- 서비스 레이어: API 호출 로직 분리

### 3. 코드 품질 향상
- 단일 책임 원칙: 각 파일이 하나의 역할만 담당
- 재사용성: 컴포넌트와 훅의 재사용성 향상
- 유지보수성: 코드 구조가 명확하고 수정이 용이
- 확장성: 새로운 기능 추가가 쉬운 구조