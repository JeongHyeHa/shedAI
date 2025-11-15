# Google Calendar 연동 설정 가이드

이 문서는 shedAI와 Google Calendar를 연동하기 위한 설정 절차를 설명합니다.

## 📋 목차

1. [Google Cloud Console 설정](#1-google-cloud-console-설정)
2. [Firebase 프로젝트 확인](#2-firebase-프로젝트-확인)
3. [테스트 방법](#3-테스트-방법)
4. [문제 해결](#4-문제-해결)

---

## 1. Google Cloud Console 설정

### 1-1. Google Cloud Console 접속

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. shedAI Firebase 프로젝트와 연결된 Google Cloud 프로젝트 선택
   - Firebase Console → 프로젝트 설정 → 일반 → 프로젝트 ID 확인
   - 해당 프로젝트 ID로 Google Cloud Console에서 프로젝트 선택

### 1-2. OAuth 동의 화면 설정

1. **API 및 서비스** → **OAuth 동의 화면** 메뉴로 이동
2. **사용자 유형 선택**
   - 외부 (일반 사용자용) 선택
   - **만들기** 클릭

3. **앱 정보 입력**
   - 앱 이름: `shedAI`
   - 사용자 지원 이메일: 본인 이메일
   - 앱 로고: (선택사항)
   - 앱 도메인: (개발 중이면 비워둬도 됨)
   - 개발자 연락처 정보: 본인 이메일
   - **저장 후 계속** 클릭

4. **범위(Scopes) 추가**
   - **범위 추가 또는 삭제** 클릭
   - 다음 scope를 검색하여 추가:
     ```
     https://www.googleapis.com/auth/calendar
     ```
   - 또는 읽기 전용이면:
     ```
     https://www.googleapis.com/auth/calendar.readonly
     ```
   - **업데이트** → **저장 후 계속** 클릭

5. **테스트 사용자 추가** (외부 앱인 경우)
   - 테스트 사용자 섹션에서 **+ 추가** 클릭
   - Google 계정 이메일 추가 (본인 계정)
   - **저장 후 계속** 클릭

6. **요약 확인**
   - 설정 내용 확인 후 **대시보드로 돌아가기** 클릭

### 1-3. OAuth 클라이언트 ID 확인

Firebase가 이미 OAuth 클라이언트 ID를 생성했을 가능성이 높습니다.

1. **API 및 서비스** → **사용자 인증 정보** 메뉴로 이동
2. **OAuth 2.0 클라이언트 ID** 목록 확인
3. Firebase 프로젝트와 연결된 클라이언트 ID가 있는지 확인
   - 없으면 Firebase Console에서 자동 생성됨

### 1-4. Google Calendar API 활성화

1. **API 및 서비스** → **라이브러리** 메뉴로 이동
2. "Google Calendar API" 검색
3. **Google Calendar API** 선택
4. **사용 설정** 클릭

---

## 2. Firebase 프로젝트 확인

### 2-1. Firebase Console에서 확인

1. [Firebase Console](https://console.firebase.google.com/) 접속
2. shedAI 프로젝트 선택
3. **인증** → **Sign-in method** 메뉴로 이동
4. **Google** 제공업체가 활성화되어 있는지 확인
   - 활성화되어 있으면 ✅
   - 비활성화되어 있으면 **사용 설정** 클릭

### 2-2. 코드 확인

이미 구현된 코드에서 다음을 확인:

- `client/src/services/authService.js`: 
  - `GoogleAuthProvider`에 `addScope('https://www.googleapis.com/auth/calendar')` 추가됨 ✅
  
- `client/src/contexts/AuthContext.js`:
  - `googleCalendarAccessToken` 상태 관리 추가됨 ✅

---

## 3. 테스트 방법

### 3-1. 로컬 개발 환경 테스트

1. **서버 실행**
   ```bash
   npm run server
   ```

2. **클라이언트 실행**
   ```bash
   npm run client
   ```

3. **Google 로그인 테스트**
   - 앱에서 Google 로그인 버튼 클릭
   - Google 계정 선택
   - **권한 요청 팝업 확인**
     - "shedAI가 다음에 액세스하도록 허용하시겠습니까?"
     - "Google 캘린더 보기 및 관리" 체크박스 확인
   - **허용** 클릭

4. **accessToken 확인**
   - 브라우저 개발자 도구 → Console
   - `localStorage.getItem('shedAI:googleCalendarAccessToken')` 실행
   - 토큰이 저장되어 있는지 확인

5. **스케줄 생성 후 Google Calendar로 보내기**
   - shedAI에서 스케줄 생성
   - **"📅 Google Calendar로 보내기"** 버튼 클릭
   - 성공 메시지 확인
   - Google Calendar 앱/웹에서 일정 확인

### 3-2. API 엔드포인트 테스트

**헬스 체크:**
```bash
curl http://localhost:3001/api/google-calendar/health
```

**예상 응답:**
```json
{
  "ok": true,
  "service": "Google Calendar API",
  "message": "서비스 정상 작동 중"
}
```

---

## 4. 문제 해결

### 문제 1: "accessToken이 필요합니다" 오류

**원인:** Google 로그인 시 Calendar scope가 제대로 요청되지 않음

**해결:**
1. Firebase Console → 인증 → Sign-in method → Google 확인
2. 브라우저 캐시/쿠키 삭제 후 다시 로그인
3. 개발자 도구 → Application → Local Storage에서 `shedAI:googleCalendarAccessToken` 확인

### 문제 2: "Google Calendar API 호출 실패" 오류

**원인:** Google Calendar API가 활성화되지 않음

**해결:**
1. Google Cloud Console → API 및 서비스 → 라이브러리
2. "Google Calendar API" 검색 후 **사용 설정** 확인

### 문제 3: "OAuth 동의 화면 설정 필요" 오류

**원인:** OAuth 동의 화면이 제대로 설정되지 않음

**해결:**
1. Google Cloud Console → API 및 서비스 → OAuth 동의 화면
2. Calendar scope가 추가되어 있는지 확인
3. 테스트 사용자에 본인 계정이 추가되어 있는지 확인

### 문제 4: "권한이 거부되었습니다" 오류

**원인:** 사용자가 Calendar 권한을 거부했거나, 테스트 사용자가 아님

**해결:**
1. Google Cloud Console → OAuth 동의 화면 → 테스트 사용자에 계정 추가
2. 앱에서 로그아웃 후 다시 로그인
3. 권한 요청 팝업에서 "Google 캘린더 보기 및 관리" 체크 확인

### 문제 5: CORS 오류

**원인:** 백엔드 CORS 설정 문제

**해결:**
- `server/app.js`에서 `app.use(cors())` 확인
- 클라이언트 URL이 CORS 허용 목록에 있는지 확인

---

## 5. 배포 시 추가 설정

### 5-1. 승인된 JavaScript 출처 추가

Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → OAuth 2.0 클라이언트 ID:

- **승인된 JavaScript 출처**에 배포 도메인 추가:
  ```
  https://your-domain.com
  ```

### 5-2. OAuth 동의 화면 게시

1. Google Cloud Console → OAuth 동의 화면
2. **게시 앱** 클릭
3. Google 검토 제출 (필요 시)

---

## 6. 참고 자료

- [Google Calendar API 문서](https://developers.google.com/calendar/api/v3/overview)
- [Firebase Auth Google 로그인](https://firebase.google.com/docs/auth/web/google-signin)
- [Google OAuth 2.0 가이드](https://developers.google.com/identity/protocols/oauth2)

---

## ✅ 체크리스트

설정 완료 후 다음을 확인하세요:

- [ ] Google Cloud Console에서 Google Calendar API 활성화됨
- [ ] OAuth 동의 화면에 Calendar scope 추가됨
- [ ] 테스트 사용자에 본인 계정 추가됨
- [ ] Firebase Console에서 Google Sign-in 활성화됨
- [ ] 로그인 시 Calendar 권한 요청 팝업 표시됨
- [ ] accessToken이 localStorage에 저장됨
- [ ] "Google Calendar로 보내기" 버튼 클릭 시 일정이 추가됨
- [ ] Google Calendar 앱/웹에서 일정 확인 가능

---

**문제가 계속되면:**
1. 브라우저 개발자 도구 → Console에서 에러 메시지 확인
2. 서버 로그 확인 (`npm run server` 실행 중인 터미널)
3. Google Cloud Console → API 및 서비스 → 사용량에서 API 호출 로그 확인

