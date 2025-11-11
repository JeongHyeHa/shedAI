## 🎯 목표

**개인 맞춤형 일정 관리에서 사용자 네트워크와 자연스럽게 연결되는 확장 가능한 서비스**

### 서비스 확장성 관점
> 💡 **교수님 피드백 반영**: "상용 SNS" 기능은 단순히 SNS 서비스를 그대로 구현하라는 의미가 아니라, **서비스 확장성** 관점에서 제안된 의견입니다. 개인 맞춤형 기능을 유지하면서도 사용자 간 연결과 협업이 가능한 방향으로 확장하는 것이 목표입니다.

**7일 동안 구현할 확장성 기능**:
- 일정 공유 기능 (사용자 간 연결)
- 일정 알림 메시지 (FCM 기반, 협업 강화)
- 캘린더 연동 (ICS + Google Calendar 링크)
- 외부 SNS 공유 (웹 공유 API)

---

## ✅ 우선순위

### P0 (필수·완성) - 반드시 작동해야 함
1. **FCM 알림** (웹+안드로이드) - 토큰 저장 → 일정/DM/댓글 알림
2. **Capacitor 안드로이드 빌드** (APK) + **PWA 설치** (iOS 대체)
3. **실시간 DM** + 헤더 알림 배지

### P1 (있으면 강력) - 데모 임팩트 큰 기능
4. **게시/댓글/좋아요** + 이미지 업로드 (Storage)
5. **파일·음성 업로드** (간단)
6. **스케줄 연동**: ICS Export/Import + Google Calendar 딥링크

### P2 (보완) - 시간 남으면
7. **합성 데이터 생성 버튼** (50~200 샘플) + 간단 정확도 지표
8. **SNS 공유** (웹 공유 API) 또는 포스트 퍼머링크 복사

---

## 📅 일별 개발 계획

### Day 1: 웹 FCM 완성 + 일정/DM 트리거 골격
- [x] Firebase Console 설정 ✅
  - FCM 프로젝트 활성화
  - VAPID 키 생성 및 저장
- [x] `firebase-messaging-sw.js` 생성 ✅
  - Service Worker 등록
  - 백그라운드 메시지 수신 처리
- [x] FCM 서비스 구현 ✅
  - `client/src/services/fcmService.js` 완료
  - 토큰 요청 및 저장 (`users/{uid}/devices/{deviceId}.fcmToken`) 완료
- [x] Cloud Functions 기본 구조 ✅
  - `functions/index.js` 설정 완료
  - Firestore 트리거 함수 골격 완료
- [x] 알림 트리거 함수 구현 ✅
  - `notifyOnScheduleChange` (일정 추가/수정/삭제) 완료
  - `notifyOnDmMessage` (DM 수신) 완료
  - `notifyOnPostComment` (댓글 알림) 완료
- [x] 웹 알림 테스트 ✅
  - 일정 추가 → 브라우저 알림 수신 확인 완료
  - 알림 중복 문제 해결 완료

**완료 기준**: 웹에서 일정 추가 시 브라우저 알림(백그라운드) 수신 ✅ (완료)

---

### Day 2: Capacitor + 안드로이드 FCM
- [x] Capacitor 설치 및 초기화 ✅
  ```bash
  npm install @capacitor/core @capacitor/cli @capacitor/app @capacitor/push-notifications
  npx cap init
  npx cap add android
  ```
- [x] `capacitor.config.ts` 설정 ✅
  - 앱 ID, 이름, 웹 디렉토리 완료
- [x] Android 프로젝트 생성 ✅
  ```bash
  npx cap sync
  npx cap open android
  ```
- [x] Android FCM 설정 ✅
  - `google-services.json` 추가 완료
  - `AndroidManifest.xml` 권한 설정 완료
  - FCM 토큰 수신 및 저장 로직 완료 (MainActivity.java, FCMService.java)
- [ ] 알림 채널 설정 (카테고리 분리)
  - "메시지" 채널
  - "일정" 채널
- [x] 디버그 APK 빌드 및 테스트 ✅
  - 실제 기기에서 토큰 저장 확인 완료
  - 푸시 수신 테스트는 Cloud Functions 배포 후 가능

**완료 기준**: 안드로이드에서 일정/DM 푸시 도착 (앱 종료 상태) ⏳ (토큰 저장 완료, 알림 전송 함수 구현 필요)

---

### Day 3: DM 실시간 + 배지
- [ ] Firestore DM 구조 설계
  - `dms/{threadId}/messages/{messageId}`
  - 읽음 상태, 타임스탬프 관리
- [ ] 실시간 메시징 구현
  - `onSnapshot` 리스너
  - 메시지 송수신 UI
- [ ] 알림 배지 기능
  - 읽지 않은 메시지 수 카운트
  - 헤더에 배지 표시
- [ ] 알림 센터 UI
  - `components/NotificationCenter.jsx`
  - 최근 알림 리스트

**완료 기준**: DM 송수신 + 배지 동기 반영 ✅

---

### Day 4: 데이터 타입 입출력
- [ ] Firebase Storage 설정
  - Storage 규칙 설정
  - 업로드/다운로드 서비스 구현
- [ ] 이미지 업로드 기능
  - `components/ImageUploader.jsx`
  - 이미지 미리보기 (1~3장 그리드)
  - 클라이언트 압축 (리사이즈)
- [ ] 파일 업로드 기능
  - PDF, 문서 파일 지원
  - 파일 목록 표시
  - 다운로드 기능
- [ ] 음성 녹음 기능 (기존 useVoiceRecording 개선)
  - 녹음 → Storage 업로드
  - 재생 기능

**완료 기준**: 이미지/파일/음성 업로드 → 다운로드/재생 가능 ✅

---

### Day 5: 게시 기능 + "보이는 연동"
- [ ] 게시 기능 구현
  - `posts/{postId}` Firestore 구조
  - 게시 작성/수정/삭제
  - 피드 타임라인 표시
- [ ] 게시 컴포넌트
  - `components/Post/PostCard.jsx`
  - 이미지 1~3장 그리드, 라이트박스
  - 좋아요, 댓글 기능 (기본)
- [ ] ICS Export/Import
  - `services/calendarService.js`
  - 일정 → ICS 파일 내보내기
  - ICS 파일 → 일정 가져오기
- [ ] Google Calendar Template 링크
  - "일정 추가" 버튼 클릭 시
  - Google Calendar 템플릿 링크 생성
  - 바로 캘린더 화면 열림 → **연동 느낌 강함**

**완료 기준**: 피드 타임라인 동작, 링크로 구글 캘린더 열림, ICS 내보내기/가져오기 작동 ✅

---

### Day 6: "정확도 향상 보이기" & 지표
- [ ] 합성 데이터 생성 기능
  - 버튼 클릭 → 샘플 일정/피드백 50~200개 생성
  - Firestore에 자동 주입
- [ ] 데이터 생성 로직
  - 다양한 패턴의 일정 생성
  - 다양한 피드백 텍스트 생성
- [ ] 간단 지표 화면
  - 마감 준수율
  - 과밀 배치 방지율
  - 피드백 반영율
- [ ] 막대그래프 시각화
  - `recharts` 또는 간단한 CSS 그래프
  - "향상됐다"를 시각화

**완료 기준**: 버튼 클릭 → 데이터 주입 → 지표 갱신 ("향상됐다"를 시각화) ✅

---

### Day 7: 데모 시나리오 빌드업 & 문서화
- [ ] 데모 스크립트 작성 (2분)
  - DM 수신 → 푸시 → 배지
  - 포스트 작성 → 알림
  - 일정 추가 → 폰 푸시 + 구글 캘린더 열림
- [ ] E2E 테스트
  - 모든 기능 통합 테스트
  - 버그 수정
- [ ] 문서 작성
  - `README.md` 업데이트
  - 설치/빌드/권한 가이드
  - 테스트 계정 2개 준비
  - 더미 데이터 시드
- [ ] 배포 준비
  - Production 빌드
  - Android APK/AAB 생성
  - Firebase 배포
**완료 기준**: APK+웹 동시 시연, E2E 리허설 통과 ✅

---

## 📊 진행 상황 추적

### 전체 진행률
- [x] Day 1 완료 (부분) - FCM 토큰 저장 완료, 알림 전송 함수 구현 필요
- [x] Day 2 완료 (부분) - Android FCM 토큰 저장 완료, 알림 채널 설정 필요
- [ ] Day 3 완료
- [ ] Day 4 완료
- [ ] Day 5 완료
- [ ] Day 6 완료
- [ ] Day 7 완료

### 핵심 기능 체크리스트
- [x] 웹 FCM 토큰 저장 ✅
- [x] 안드로이드 FCM 토큰 저장 ✅
- [ ] 웹 FCM 알림 수신 테스트 (Cloud Functions 배포 후)
- [ ] 안드로이드 푸시 수신 테스트 (Cloud Functions 배포 후)
- [ ] DM 실시간 + 헤더 배지
- [ ] 게시/댓글/좋아요 + 이미지 1~3장
- [ ] 파일/음성 업로드
- [ ] ICS 내보내기/가져오기 + 구글 캘린더 링크
- [x] Capacitor Android 프로젝트 생성 ✅
- [ ] Capacitor APK 배포 + PWA 설치 가이드
- [ ] 합성 데이터 버튼 + 지표 화면

---

## 🛠 기술 스택

### 필수 패키지
```bash
# FCM
npm install firebase-messaging

# Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/app @capacitor/push-notifications
npm install @capacitor/android @capacitor/ios

# 파일 업로드
npm install react-dropzone
npm install browser-image-compression

# ICS 파일 처리
npm install ics

# 차트/시각화
npm install recharts
```

### Firebase Functions
```bash
npm install -g firebase-tools
firebase init functions
cd functions
npm install firebase-admin firebase-functions
```

---

## 🎯 최종 목표

**일주일 후 달성해야 할 상태:**
- ✅ 웹 + Android 멀티 플랫폼 지원
- ✅ FCM 알림 완전 작동 (웹+안드로이드)
- ✅ 기본 SNS 기능 (메시징, 게시, 파일 업로드)
- ✅ 스케줄 연동 (ICS + Google Calendar 링크)
- ✅ AI 정확도 향상을 위한 데이터 수집 + 지표
- ✅ 배포 가능한 상태 (APK + 웹)

**완성도**: MVP 수준이지만 핵심 기능은 완전히 작동하는 상태

