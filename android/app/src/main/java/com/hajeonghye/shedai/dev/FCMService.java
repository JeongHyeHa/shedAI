package com.hajeonghye.shedai.dev;

import android.util.Log;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * FCM Service
 * Firebase Cloud Messaging 메시지 수신 및 토큰 갱신 처리
 */
public class FCMService extends FirebaseMessagingService {
    private static final String TAG = "FCMService";

    /**
     * FCM 토큰이 갱신될 때 호출됨
     * MainActivity에서 JavaScript로 전달하여 Firestore에 저장
     */
    @Override
    public void onNewToken(String token) {
        Log.d(TAG, "Refreshed FCM token: " + token);
        
        // MainActivity에 토큰 전달 (JavaScript로 전달)
        // MainActivity에서 JavaScript의 fcmService.saveTokenToFirestore() 호출
        if (MainActivity.getInstance() != null) {
            MainActivity.getInstance().onFCMTokenReceived(token);
        }
    }

    /**
     * FCM 메시지 수신 시 호출됨
     */
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Log.d(TAG, "From: " + remoteMessage.getFrom());

        // 메시지 데이터 확인
        if (remoteMessage.getData().size() > 0) {
            Log.d(TAG, "Message data payload: " + remoteMessage.getData());
        }

        // 알림 확인
        if (remoteMessage.getNotification() != null) {
            Log.d(TAG, "Message Notification Body: " + remoteMessage.getNotification().getBody());
            
            // MainActivity에 알림 전달 (JavaScript로 전달)
            if (MainActivity.getInstance() != null) {
                MainActivity.getInstance().onFCMMessageReceived(remoteMessage);
            }
        }
    }
}

