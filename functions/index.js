const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

/**
 * 일정 추가/수정/삭제 시 알림 전송
 */
exports.notifyOnScheduleChange = functions.firestore
  .document('users/{userId}/scheduleSessions/{sessionId}')
  .onWrite(async (change, context) => {
    const { userId } = context.params;
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;

    // 일정이 추가되거나 수정된 경우만 알림 전송
    if (!after || !after.hasSchedule || !after.isActive) {
      return null;
    }

    // 사용자의 모든 디바이스 토큰 가져오기
    const devicesRef = admin.firestore().collection(`users/${userId}/devices`);
    const devicesSnapshot = await devicesRef.get();

    if (devicesSnapshot.empty) {
      console.log(`[notifyOnScheduleChange] 사용자 ${userId}의 디바이스가 없습니다.`);
      return null;
    }

    const tokens = [];
    devicesSnapshot.forEach((doc) => {
      const deviceData = doc.data();
      if (deviceData.fcmToken) {
        tokens.push(deviceData.fcmToken);
      }
    });

    if (tokens.length === 0) {
      console.log(`[notifyOnScheduleChange] 사용자 ${userId}의 FCM 토큰이 없습니다.`);
      return null;
    }

    // 알림 메시지 구성
    const isNew = !before || !before.hasSchedule;
    const title = isNew ? '새 일정이 추가되었습니다' : '일정이 수정되었습니다';
    const body = '스케줄을 확인해보세요.';

    const message = {
      notification: {
        title,
        body,
      },
      data: {
        type: 'schedule',
        action: isNew ? 'created' : 'updated',
        sessionId: context.params.sessionId,
      },
      tokens, // 여러 토큰에 동시 전송
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`[notifyOnScheduleChange] 알림 전송 성공: ${response.successCount}개 성공, ${response.failureCount}개 실패`);
      
      // 실패한 토큰 제거
      if (response.failureCount > 0) {
        const failedTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            failedTokens.push(tokens[idx]);
          }
        });
        
        // 실패한 토큰 삭제
        for (const token of failedTokens) {
          const deviceQuery = await devicesRef.where('fcmToken', '==', token).get();
          deviceQuery.forEach((doc) => {
            doc.ref.update({ fcmToken: null });
          });
        }
      }
      
      return null;
    } catch (error) {
      console.error('[notifyOnScheduleChange] 알림 전송 실패:', error);
      return null;
    }
  });

/**
 * DM 메시지 수신 시 알림 전송
 */
exports.notifyOnDmMessage = functions.firestore
  .document('dms/{threadId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    const messageData = snap.data();
    const { threadId } = context.params;

    // 메시지 발신자와 수신자 확인
    const senderId = messageData.senderId;
    if (!senderId) {
      return null;
    }

    // 스레드 정보 가져오기 (참가자 확인)
    const threadRef = admin.firestore().doc(`dms/${threadId}`);
    const threadDoc = await threadRef.get();
    
    if (!threadDoc.exists) {
      return null;
    }

    const threadData = threadDoc.data();
    const participants = threadData.participants || [];
    
    // 수신자 찾기 (발신자가 아닌 참가자)
    const recipientId = participants.find(id => id !== senderId);
    if (!recipientId) {
      return null;
    }

    // 수신자의 모든 디바이스 토큰 가져오기
    const devicesRef = admin.firestore().collection(`users/${recipientId}/devices`);
    const devicesSnapshot = await devicesRef.get();

    if (devicesSnapshot.empty) {
      console.log(`[notifyOnDmMessage] 사용자 ${recipientId}의 디바이스가 없습니다.`);
      return null;
    }

    const tokens = [];
    devicesSnapshot.forEach((doc) => {
      const deviceData = doc.data();
      if (deviceData.fcmToken) {
        tokens.push(deviceData.fcmToken);
      }
    });

    if (tokens.length === 0) {
      console.log(`[notifyOnDmMessage] 사용자 ${recipientId}의 FCM 토큰이 없습니다.`);
      return null;
    }

    // 발신자 이름 가져오기
    const senderDoc = await admin.firestore().doc(`users/${senderId}`).get();
    const senderName = senderDoc.data()?.displayName || '알 수 없음';

    // 알림 메시지 구성
    const message = {
      notification: {
        title: `${senderName}님으로부터 새 메시지`,
        body: messageData.text || '새 메시지가 도착했습니다.',
      },
      data: {
        type: 'dm',
        threadId,
        messageId: context.params.messageId,
        senderId,
      },
      tokens,
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`[notifyOnDmMessage] 알림 전송 성공: ${response.successCount}개 성공, ${response.failureCount}개 실패`);
      
      // 실패한 토큰 제거
      if (response.failureCount > 0) {
        const failedTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            failedTokens.push(tokens[idx]);
          }
        });
        
        for (const token of failedTokens) {
          const deviceQuery = await devicesRef.where('fcmToken', '==', token).get();
          deviceQuery.forEach((doc) => {
            doc.ref.update({ fcmToken: null });
          });
        }
      }
      
      return null;
    } catch (error) {
      console.error('[notifyOnDmMessage] 알림 전송 실패:', error);
      return null;
    }
  });

/**
 * 게시물 댓글 알림
 */
exports.notifyOnPostComment = functions.firestore
  .document('posts/{postId}/comments/{commentId}')
  .onCreate(async (snap, context) => {
    const commentData = snap.data();
    const { postId } = context.params;

    // 게시물 작성자 확인
    const postRef = admin.firestore().doc(`posts/${postId}`);
    const postDoc = await postRef.get();
    
    if (!postDoc.exists) {
      return null;
    }

    const postData = postDoc.data();
    const postOwnerId = postData.ownerId;
    const commenterId = commentData.userId;

    // 자신의 게시물에 자신이 댓글을 단 경우 알림 전송 안 함
    if (postOwnerId === commenterId) {
      return null;
    }

    // 게시물 작성자의 모든 디바이스 토큰 가져오기
    const devicesRef = admin.firestore().collection(`users/${postOwnerId}/devices`);
    const devicesSnapshot = await devicesRef.get();

    if (devicesSnapshot.empty) {
      return null;
    }

    const tokens = [];
    devicesSnapshot.forEach((doc) => {
      const deviceData = doc.data();
      if (deviceData.fcmToken) {
        tokens.push(deviceData.fcmToken);
      }
    });

    if (tokens.length === 0) {
      return null;
    }

    // 댓글 작성자 이름 가져오기
    const commenterDoc = await admin.firestore().doc(`users/${commenterId}`).get();
    const commenterName = commenterDoc.data()?.displayName || '알 수 없음';

    // 알림 메시지 구성
    const message = {
      notification: {
        title: `${commenterName}님이 댓글을 남겼습니다`,
        body: commentData.text || '새 댓글이 달렸습니다.',
      },
      data: {
        type: 'comment',
        postId,
        commentId: context.params.commentId,
        commenterId,
      },
      tokens,
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`[notifyOnPostComment] 알림 전송 성공: ${response.successCount}개 성공`);
      return null;
    } catch (error) {
      console.error('[notifyOnPostComment] 알림 전송 실패:', error);
      return null;
    }
  });

