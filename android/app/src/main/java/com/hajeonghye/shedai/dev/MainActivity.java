package com.hajeonghye.shedai.dev;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.RemoteMessage;
import org.json.JSONObject;
import org.json.JSONException;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1001;
    private static MainActivity instance;
    private String pendingToken = null; // WebView 준비 전 토큰 저장

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;
        
        // FCM 토큰 가져오기 (WebView 준비 후 전달)
        getFCMToken();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
    }

    public static MainActivity getInstance() {
        return instance;
    }

    /**
     * FCM 토큰 가져오기
     */
    private void getFCMToken() {
        Log.d(TAG, "FCM 토큰 가져오기 시작...");
        FirebaseMessaging.getInstance().getToken()
            .addOnCompleteListener(task -> {
                if (!task.isSuccessful()) {
                    Exception exception = task.getException();
                    Log.e(TAG, "FCM 토큰 가져오기 실패", exception);
                    if (exception != null) {
                        Log.e(TAG, "에러 상세: " + exception.getMessage());
                    }
                    return;
                }

                // 토큰 가져오기 성공
                String token = task.getResult();
                if (token != null && !token.isEmpty()) {
                    Log.d(TAG, "FCM 토큰 가져오기 성공: " + token.substring(0, Math.min(20, token.length())) + "...");
                    // JavaScript로 토큰 전달
                    onFCMTokenReceived(token);
                } else {
                    Log.e(TAG, "FCM 토큰이 null이거나 비어있습니다.");
                }
            });
    }

    /**
     * FCM 토큰을 JavaScript로 전달
     */
    public void onFCMTokenReceived(String token) {
        this.pendingToken = token; // 토큰 저장
        Log.d(TAG, "FCM 토큰 저장됨, WebView 준비 대기 중...");
        
        // WebView가 준비되면 전달
        sendTokenToJavaScript();
    }
    
    /**
     * WebView에 토큰 전달 (WebView가 준비되었을 때 호출)
     */
    private void sendTokenToJavaScript() {
        if (pendingToken == null) {
            Log.w(TAG, "sendTokenToJavaScript: pendingToken이 null입니다.");
            return;
        }
        
        Log.d(TAG, "sendTokenToJavaScript: 토큰 전달 시도, pendingToken 길이: " + pendingToken.length());
        
        Bridge bridge = this.getBridge();
        if (bridge == null) {
            Log.w(TAG, "Bridge가 null입니다. 나중에 다시 시도합니다.");
            new Handler(Looper.getMainLooper()).postDelayed(() -> sendTokenToJavaScript(), 500);
            return;
        }
        
        WebView webView = bridge.getWebView();
        if (webView == null) {
            Log.w(TAG, "WebView가 null입니다. 나중에 다시 시도합니다.");
            // WebView가 준비될 때까지 재시도 (최대 10번)
            final int[] retryCount = {0};
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                retryCount[0]++;
                if (retryCount[0] < 10) {
                    sendTokenToJavaScript();
                } else {
                    Log.e(TAG, "WebView 준비 대기 시간 초과 (10초)");
                }
            }, 1000);
            return;
        }
        
        try {
            JSONObject data = new JSONObject();
            data.put("token", pendingToken);
            data.put("platform", "android");
            
            String jsonString = data.toString();
            Log.d(TAG, "JavaScript로 전달할 데이터: " + jsonString.substring(0, Math.min(100, jsonString.length())) + "...");
            
            // JavaScript의 window 객체에 이벤트 전달
            // 리스너가 아직 등록되지 않았을 수 있으므로 window 객체에도 저장
            String jsCode = "(function() { " +
                "var tokenData = " + jsonString + "; " +
                "window.__pendingFCMToken = tokenData; " + // 토큰을 window에 저장
                "if (window.dispatchEvent) { " +
                "  console.log('[Android] FCM 토큰 이벤트 발생'); " +
                "  window.dispatchEvent(new CustomEvent('fcm-token-received', { detail: tokenData })); " +
                "} else { " +
                "  console.warn('[Android] window.dispatchEvent가 없습니다. 토큰은 window.__pendingFCMToken에 저장됨'); " +
                "} " +
                "})();";
            
            // UI 스레드에서 실행
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    webView.evaluateJavascript(jsCode, value -> {
                        Log.d(TAG, "FCM 토큰을 JavaScript로 전달 완료. 반환값: " + value);
                        if (value != null && !value.equals("null")) {
                            pendingToken = null; // 전달 완료 후 초기화
                        }
                    });
                } else {
                    webView.loadUrl("javascript:" + jsCode);
                    pendingToken = null;
                }
            });
        } catch (JSONException e) {
            Log.e(TAG, "FCM 토큰 전달 실패", e);
        }
    }
    
    /**
     * WebView가 준비되었을 때 호출 (Bridge가 준비되면 자동 호출)
     */
    @Override
    public void onStart() {
        super.onStart();
        
        // Android 13+ 알림 권한 요청
        askNotificationPermission();
        
        // WebView가 준비되면 토큰 전달 시도
        if (pendingToken != null) {
            sendTokenToJavaScript();
        }
    }
    
    /**
     * Android 13 (API 33) 이상에서 알림 권한 요청
     */
    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) { // API 33
            String permission = Manifest.permission.POST_NOTIFICATIONS;
            
            // 권한이 이미 허용되어 있는지 확인
            if (ContextCompat.checkSelfPermission(this, permission) 
                    != PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "알림 권한이 없습니다. 권한 요청 중...");
                // 권한 요청
                ActivityCompat.requestPermissions(
                    this,
                    new String[]{permission},
                    NOTIFICATION_PERMISSION_REQUEST_CODE
                );
            } else {
                Log.d(TAG, "알림 권한이 이미 허용되어 있습니다.");
            }
        } else {
            Log.d(TAG, "Android 13 미만 버전입니다. 알림 권한 요청이 필요하지 않습니다.");
        }
    }
    
    /**
     * 권한 요청 결과 처리
     */
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "알림 권한이 허용되었습니다.");
            } else {
                Log.w(TAG, "알림 권한이 거부되었습니다. 사용자가 설정에서 수동으로 허용해야 합니다.");
            }
        }
    }

    /**
     * FCM 메시지를 JavaScript로 전달
     */
    public void onFCMMessageReceived(RemoteMessage remoteMessage) {
        Bridge bridge = this.getBridge();
        if (bridge != null) {
            try {
                JSONObject data = new JSONObject();
                if (remoteMessage.getNotification() != null) {
                    data.put("title", remoteMessage.getNotification().getTitle());
                    data.put("body", remoteMessage.getNotification().getBody());
                }
                
                // RemoteMessage.getData()는 Map<String, String>이므로 JSONObject로 변환
                JSONObject dataPayload = new JSONObject();
                for (java.util.Map.Entry<String, String> entry : remoteMessage.getData().entrySet()) {
                    dataPayload.put(entry.getKey(), entry.getValue());
                }
                data.put("data", dataPayload);
                
                // JavaScript의 window 객체에 이벤트 전달
                String jsCode = "window.dispatchEvent(new CustomEvent('fcm-message-received', { detail: " + data + " }));";
                
                // UI 스레드에서 실행
                runOnUiThread(() -> {
                    WebView webView = bridge.getWebView();
                    if (webView != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                            webView.evaluateJavascript(jsCode, value -> Log.d(TAG, "FCM 메시지를 JavaScript로 전달 완료"));
                        } else {
                            // API 19 미만에서는 loadUrl 사용 (하지만 minSdkVersion이 23이므로 실행되지 않음)
                            webView.loadUrl("javascript:" + jsCode);
                        }
                    }
                });
            } catch (JSONException e) {
                Log.e(TAG, "FCM 메시지 전달 실패", e);
            }
        }
    }
}
