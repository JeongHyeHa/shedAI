# Google Calendar 연동 설정 가이드

이 문서는 shedAI와 Google Calendar를 연동하기 위한 Google Cloud Console 설정 절차를 안내합니다.

## 1. Google Cloud Console 접속 및 프로젝트 확인

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 상단 프로젝트 선택 드롭다운에서 **Firebase 프로젝트와 동일한 프로젝트** 선택
   - Firebase 프로젝트 ID는 `.env` 파일의 `REACT_APP_FIREBASE_PROJECT_ID` 값과 동일합니다
   - 만약 Firebase 프로젝트가 없다면 새로 생성하거나 기존 프로젝트를 사용하세요

## 2. OAuth 동의 화면 설정

1. 좌측 메뉴에서 **"API 및 서비스"** → **"OAuth 동의 화면"** 클릭
2. **"외부"** 선택 후 **"만들기"** 클릭
3. 필수 정보 입력:
   - **앱 이름**: `shedAI` (또는 원하는 이름)
   - **사용자 지원 이메일**: 본인 이메일
   - **앱 로고**: (선택사항)
   - **앱 도메인**: (선택사항)
   - **개발자 연락처 정보**: 본인 이메일
4. **"저장 후 계속"** 클릭
5. **"범위"** 섹션에서:
   - **"범위 추가 또는 삭제"** 클릭
   - 다음 scope 추가:
     - `https://www.googleapis.com/auth/calendar` (캘린더 읽기/쓰기)
     - 또는 읽기 전용이면: `https://www.googleapis.com/auth/calendar.readonly`
   - **"저장 후 계속"** 클릭
6. **"테스트 사용자"** 섹션:
   - 개발 중이면 본인 이메일을 테스트 사용자로 추가
   - **"저장 후 계속"** 클릭
7. **"요약"** 확인 후 **"대시보드로 돌아가기"** 클릭

## 3. OAuth 클라이언트 ID 확인/생성

1. 좌측 메뉴에서 **"API 및 서비스"** → **"사용자 인증 정보"** 클릭
2. Firebase가 자동으로 생성한 OAuth 2.0 클라이언트 ID가 있는지 확인
   - 이름이 "Web client (auto created by Google Service)" 같은 형태일 수 있습니다
3. 만약 없다면:
   - 상단 **"+ 사용자 인증 정보 만들기"** → **"OAuth 클라이언트 ID"** 선택
   - **애플리케이션 유형**: "웹 애플리케이션"
   - **이름**: "shedAI Web Client"
   - **승인된 JavaScript 출처**:
     - `http://localhost:3000` (개발용)
     - 배포 도메인 (예: `https://yourdomain.com`)
   - **승인된 리디렉션 URI**:
     - Firebase Auth가 자동으로 관리하므로 비워두거나
     - Firebase Console에서 확인한 리디렉션 URI 추가
   - **"만들기"** 클릭
4. **클라이언트 ID**와 **클라이언트 보안 비밀번호** 복사 (나중에 필요할 수 있음)
   - Firebase가 자동으로 생성한 경우, Firebase Console에서 확인 가능

## 4. Google Calendar API 활성화

1. 좌측 메뉴에서 **"API 및 서비스"** → **"라이브러리"** 클릭
2. 검색창에 **"Google Calendar API"** 입력
3. **"Google Calendar API"** 클릭
4. **"사용 설정"** 버튼 클릭
5. 활성화 완료 확인

## 5. Firebase Console에서 OAuth 리디렉션 URI 확인

1. [Firebase Console](https://console.firebase.google.com/) 접속
2. 프로젝트 선택
3. 좌측 메뉴 **"인증"** → **"설정"** 탭
4. **"승인된 도메인"** 섹션 확인
5. **"승인된 리디렉션 URI"** 확인 (Google Cloud Console에 추가해야 할 수도 있음)

## 6. 설정 확인 체크리스트

- [ ] OAuth 동의 화면에 Calendar scope 추가됨
- [ ] OAuth 클라이언트 ID 존재 (Firebase 자동 생성 또는 수동 생성)
- [ ] Google Calendar API 활성화됨
- [ ] 승인된 JavaScript 출처에 개발/배포 도메인 추가됨

## 7. 테스트

설정이 완료되면:

1. shedAI 앱에서 Google 로그인 시도
2. 권한 요청 팝업에서 **"캘린더에 대한 액세스"** 권한이 표시되는지 확인
3. 권한 승인 후 로그인 완료
4. 브라우저 콘솔에서 `accessToken`이 정상적으로 받아지는지 확인

## 문제 해결

### "redirect_uri_mismatch" 오류
- Google Cloud Console의 "승인된 리디렉션 URI"에 Firebase가 사용하는 URI가 포함되어 있는지 확인
- Firebase Console의 "승인된 리디렉션 URI"를 Google Cloud Console에 추가

### "access_denied" 오류
- OAuth 동의 화면에서 Calendar scope가 추가되었는지 확인
- 테스트 사용자로 등록되어 있는지 확인 (프로덕션 전 단계)

### "API not enabled" 오류
- Google Calendar API가 활성화되었는지 확인

## 참고 자료

- [Google Calendar API 문서](https://developers.google.com/calendar/api)
- [Firebase Auth 문서](https://firebase.google.com/docs/auth)
- [OAuth 2.0 스코프](https://developers.google.com/identity/protocols/oauth2/scopes)

