# Android Studio에서 다음 단계

## 현재 상태
- ✅ Android Studio에서 프로젝트 열림
- ✅ Gradle 동기화 진행 중 또는 완료

## 다음 단계

### 1. Gradle 동기화 완료 확인
- 하단 상태바에서 "Gradle sync finished" 메시지 확인
- 에러가 있으면 해결

### 2. Microsoft Defender 경고 처리 (선택사항)
- "Microsoft Defender may affect IDE" 경고가 있으면
- "Exclude folders" 클릭하여 Android 프로젝트 폴더 제외
- 성능 향상을 위해 권장

### 3. 빌드 및 실행 준비

#### 3.1 실제 Android 기기 연결
1. Android 기기에서 USB 디버깅 활성화
2. USB 케이블로 PC에 연결
3. Android Studio에서 기기 인식 확인

#### 3.2 에뮬레이터 사용 (기기가 없는 경우)
1. Android Studio > Tools > Device Manager
2. "Create Device" 클릭
3. 원하는 기기 선택 및 생성

### 4. 앱 빌드 및 실행
1. Android Studio 상단의 "Run" 버튼 클릭 (▶️)
2. 또는 `Shift + F10` 단축키
3. 연결된 기기 또는 에뮬레이터 선택
4. 앱 실행

### 5. FCM 토큰 확인
1. 앱 실행 후 Logcat에서 확인:
   - 필터: `FCMService` 또는 `MainActivity`
   - "FCM 토큰: ..." 메시지 확인
2. Firestore에서 확인:
   - `users/{uid}/devices/{deviceId}` 문서 확인
   - `fcmToken` 필드 확인

### 6. 알림 테스트
- Cloud Functions에서 알림 전송 테스트
- 또는 Firebase Console > Cloud Messaging에서 테스트 메시지 전송

## 완료된 작업 ✅

1. ✅ `google-services.json` 추가
2. ✅ `build.gradle`에 Firebase Messaging 의존성 추가
3. ✅ `AndroidManifest.xml`에 알림 권한 추가
4. ✅ `FCMService.java` 생성 (FCM 토큰 수신)
5. ✅ `MainActivity.java` 수정 (토큰을 JavaScript로 전달)
6. ✅ `fcmService.js` 수정 (모바일 토큰 리스닝)

## 다음 작업

- Cloud Functions 설정 (알림 전송)
- 알림 채널 설정 (Android)
- 테스트 및 디버깅

