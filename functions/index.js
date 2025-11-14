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

    // after가 없으면 삭제된 것이므로 알림 전송 안 함
    if (!after) {
      return null;
    }

    // deactivateScheduleSessions로 인한 업데이트 무시
    // (isActive만 false로 변경되고 스케줄 데이터는 변경되지 않은 경우)
    if (before && before.isActive === true && after.isActive === false) {
      console.log(`[notifyOnScheduleChange] 세션 비활성화로 인한 업데이트 무시: ${context.params.sessionId}`);
      return null;
    }

    // 활성화된 스케줄이 아니면 알림 전송 안 함
    if (!after.hasSchedule || !after.isActive) {
      return null;
    }

    // 스케줄 데이터가 완전히 채워졌는지 확인 (빈 배열이거나 불완전한 데이터면 알림 안 보냄)
    const isScheduleComplete = (scheduleData) => {
      if (!scheduleData) return false;
      if (Array.isArray(scheduleData)) {
        // 배열이 비어있거나, 모든 day에 activities가 있는지 확인
        if (scheduleData.length === 0) return false;
        // 최소한 하나의 day에 activities가 있는지 확인
        return scheduleData.some(day => Array.isArray(day.activities) && day.activities.length > 0);
      }
      return false;
    };
    
    // 스케줄 데이터가 완전하지 않으면 알림 전송 안 함 (생성 중일 수 있음)
    if (!isScheduleComplete(after.scheduleData)) {
      console.log(`[notifyOnScheduleChange] 스케줄 데이터가 불완전함, 알림 전송 안 함: ${context.params.sessionId}`);
      return null;
    }

    // 새로 생성된 경우: before가 없거나 before.hasSchedule이 false였고 after.hasSchedule이 true인 경우
    const isNew = !before || !before.hasSchedule;
    
    // 수정된 경우: before와 after 모두 hasSchedule이 true이고 스케줄 데이터가 실제로 변경된 경우
    const isUpdated = before && before.hasSchedule && after.hasSchedule;
    
    // 스케줄 데이터 비교 함수
    const compareScheduleData = (beforeData, afterData) => {
      if (!beforeData && !afterData) return true;
      if (!beforeData || !afterData) return false;
      
      // JSON 문자열로 비교 (간단한 방법)
      const beforeStr = JSON.stringify(beforeData);
      const afterStr = JSON.stringify(afterData);
      return beforeStr === afterStr;
    };
    
    // 수정된 경우인데 스케줄 데이터가 변경되지 않았다면 알림 전송 안 함
    if (isUpdated && compareScheduleData(before.scheduleData, after.scheduleData)) {
      console.log(`[notifyOnScheduleChange] 스케줄 데이터 변경 없음, 알림 전송 안 함: ${context.params.sessionId}`);
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
      console.log(`[notifyOnScheduleChange] 알림 전송 성공: ${response.successCount}개 성공, ${response.failureCount}개 실패 (${isNew ? '생성' : '수정'})`);
      
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

/**
 * 일정 15분 전 알림 전송
 * 매 분마다 실행되어 15분 후 시작하는 일정을 찾아 알림 전송
 */
exports.sendScheduleReminders = functions.pubsub
  .schedule('every 1 minutes')
  .timeZone('Asia/Seoul')
  .onRun(async (context) => {
    const now = new Date();
    const nowMs = now.getTime();
    
    // 15분 후 시간 계산 (정확도: ±1분)
    const reminderTimeMs = nowMs + (15 * 60 * 1000);
    const reminderTime = new Date(reminderTimeMs);
    
    console.log(`[sendScheduleReminders] 실행 시간: ${now.toISOString()}, 알림 대상 시간: ${reminderTime.toISOString()}`);
    
    try {
      // 모든 사용자의 활성화된 스케줄 세션 가져오기
      const usersSnapshot = await admin.firestore().collection('users').get();
      
      if (usersSnapshot.empty) {
        console.log('[sendScheduleReminders] 사용자가 없습니다.');
        return null;
      }
      
      const reminderPromises = [];
      
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const sessionsRef = admin.firestore().collection(`users/${userId}/scheduleSessions`);
        const sessionsSnapshot = await sessionsRef
          .where('isActive', '==', true)
          .where('hasSchedule', '==', true)
          .get();
        
        if (sessionsSnapshot.empty) {
          continue;
        }
        
        // 각 세션에서 일정 확인
        for (const sessionDoc of sessionsSnapshot.docs) {
          const sessionData = sessionDoc.data();
          const scheduleData = sessionData.scheduleData;
          const createdAtMs = sessionData.createdAtMs;
          
          if (!scheduleData || !Array.isArray(scheduleData) || !createdAtMs) {
            continue;
          }
          
          // 기준 날짜 계산 (세션 생성 날짜)
          const baseDate = new Date(createdAtMs);
          const baseDateMidnight = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
          
          // 각 일정 확인
          for (const dayBlock of scheduleData) {
            if (!dayBlock || !dayBlock.activities || !Array.isArray(dayBlock.activities)) {
              continue;
            }
            
            const day = dayBlock.day;
            if (!day || day < 1) {
              continue;
            }
            
            // 실제 날짜 계산 (day 1 = 기준일, day 2 = 기준일+1일, ...)
            const actualDate = new Date(baseDateMidnight);
            actualDate.setDate(actualDate.getDate() + (day - 1));
            
            for (const activity of dayBlock.activities) {
              if (!activity || !activity.start || !activity.title) {
                continue;
              }
              
              // 시작 시간 파싱 (HH:MM 형식)
              const [hours, minutes] = activity.start.split(':').map(Number);
              if (isNaN(hours) || isNaN(minutes)) {
                continue;
              }
              
              // 실제 시작 시간 계산
              const startTime = new Date(actualDate);
              startTime.setHours(hours, minutes, 0, 0);
              
              // 15분 전 시간 계산
              const reminderTargetTime = new Date(startTime);
              reminderTargetTime.setMinutes(reminderTargetTime.getMinutes() - 15);
              
              // 현재 시간이 알림 대상 시간 범위 내인지 확인 (±1분 허용)
              const timeDiff = Math.abs(reminderTargetTime.getTime() - nowMs);
              if (timeDiff <= 60 * 1000) { // 1분 이내
                // 중복 알림 방지: 이미 알림을 보낸 일정인지 확인
                const reminderKey = `${userId}_${sessionDoc.id}_${day}_${activity.start}`;
                const reminderDoc = await admin.firestore()
                  .doc(`scheduleReminders/${reminderKey}`)
                  .get();
                
                if (reminderDoc.exists) {
                  // 이미 알림을 보냈으면 건너뛰기
                  continue;
                }
                
                // 알림 전송
                reminderPromises.push(
                  sendReminderNotification(userId, activity.title, startTime, reminderKey)
                );
              }
            }
          }
        }
      }
      
      // 모든 알림 전송
      const results = await Promise.allSettled(reminderPromises);
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failureCount = results.filter(r => r.status === 'rejected').length;
      
      console.log(`[sendScheduleReminders] 완료: ${successCount}개 성공, ${failureCount}개 실패`);
      
      return null;
    } catch (error) {
      console.error('[sendScheduleReminders] 오류:', error);
      return null;
    }
  });

/**
 * 일정 알림 전송 헬퍼 함수
 */
async function sendReminderNotification(userId, activityTitle, startTime, reminderKey) {
  try {
    // 사용자의 모든 디바이스 토큰 가져오기
    const devicesRef = admin.firestore().collection(`users/${userId}/devices`);
    const devicesSnapshot = await devicesRef.get();
    
    if (devicesSnapshot.empty) {
      console.log(`[sendReminderNotification] 사용자 ${userId}의 디바이스가 없습니다.`);
      return;
    }
    
    const tokens = [];
    devicesSnapshot.forEach((doc) => {
      const deviceData = doc.data();
      if (deviceData.fcmToken) {
        tokens.push(deviceData.fcmToken);
      }
    });
    
    if (tokens.length === 0) {
      console.log(`[sendReminderNotification] 사용자 ${userId}의 FCM 토큰이 없습니다.`);
      return;
    }
    
    // 시작 시간 포맷팅
    const hours = startTime.getHours();
    const minutes = startTime.getMinutes();
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    
    // 알림 메시지 구성
    const message = {
      notification: {
        title: '일정 알림',
        body: `15분 후 "${activityTitle}" 일정이 시작됩니다 (${timeStr})`,
      },
      data: {
        type: 'schedule_reminder',
        activityTitle: activityTitle,
        startTime: startTime.toISOString(),
      },
      tokens,
    };
    
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`[sendReminderNotification] 알림 전송 성공: ${response.successCount}개 성공, ${response.failureCount}개 실패`);
    
    // 알림 전송 기록 저장 (중복 방지)
    if (response.successCount > 0) {
      await admin.firestore().doc(`scheduleReminders/${reminderKey}`).set({
        userId,
        activityTitle,
        startTime: admin.firestore.Timestamp.fromDate(startTime),
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    
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
  } catch (error) {
    console.error(`[sendReminderNotification] 오류:`, error);
    throw error;
  }
}

