const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

/**
 * 공통: 사용자 디바이스 토큰 가져오기 (중복 제거 포함)
 */
async function getUserDeviceTokens(userId) {
  const devicesRef = admin.firestore().collection(`users/${userId}/devices`);
  const snapshot = await devicesRef.get();

  if (snapshot.empty) {
    console.log(`[getUserDeviceTokens] 사용자 ${userId}의 디바이스 문서가 없습니다.`);
    return { tokens: [], devicesRef };
  }

  const tokenSet = new Set();

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data && data.fcmToken) {
      tokenSet.add(data.fcmToken);
    }
  });

  const tokens = Array.from(tokenSet);

  if (tokens.length === 0) {
    console.log(`[getUserDeviceTokens] 사용자 ${userId}의 유효한 FCM 토큰이 없습니다.`);
  } else {
    console.log(
      `[getUserDeviceTokens] 사용자 ${userId}의 유효한 토큰 개수: ${tokens.length}개 (중복 제거 완료)`
    );
  }

  return { tokens, devicesRef };
}

/**
 * 공통: 실패한 토큰 정리
 */
async function cleanupFailedTokens(devicesRef, tokens, response, logPrefix) {
  if (!response || !tokens || tokens.length === 0) return;

  if (response.failureCount > 0) {
    const failedTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        failedTokens.push(tokens[idx]);
      }
    });

    if (failedTokens.length > 0) {
      console.log(
        `[${logPrefix}] 실패 토큰 정리: ${failedTokens.length}개 (fcmToken: null 처리)`
      );
    }

    for (const token of failedTokens) {
      const deviceQuery = await devicesRef.where('fcmToken', '==', token).get();
      deviceQuery.forEach((doc) => {
        doc.ref.update({ fcmToken: null });
      });
    }
  }
}

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

    // 세션 비활성화로 인한 업데이트 무시 (deactivateScheduleSessions용)
    if (before && before.isActive === true && after.isActive === false) {
      console.log(
        `[notifyOnScheduleChange] 세션 비활성화로 인한 업데이트 무시: ${context.params.sessionId}`
      );
      return null;
    }

    // 활성화된 스케줄이 아니면 알림 전송 안 함
    if (!after.hasSchedule || !after.isActive) {
      return null;
    }

    // 스케줄 데이터 완전성 체크
    const isScheduleComplete = (scheduleData) => {
      if (!scheduleData) return false;
      if (Array.isArray(scheduleData)) {
        if (scheduleData.length === 0) return false;
        // 최소 한 day에 activities가 있어야 "스케줄이 짜였다"고 봄
        return scheduleData.some(
          (day) => Array.isArray(day.activities) && day.activities.length > 0
        );
      }
      return false;
    };

    if (!isScheduleComplete(after.scheduleData)) {
      console.log(
        `[notifyOnScheduleChange] 스케줄 데이터가 불완전함, 알림 전송 안 함: ${context.params.sessionId}`
      );
      return null;
    }

    // 생성/수정 구분
    const isNew = !before || !before.hasSchedule;
    const isUpdated = before && before.hasSchedule && after.hasSchedule;

    // 스케줄 데이터 비교
    const compareScheduleData = (beforeData, afterData) => {
      if (!beforeData && !afterData) return true;
      if (!beforeData || !afterData) return false;
      const beforeStr = JSON.stringify(beforeData);
      const afterStr = JSON.stringify(afterData);
      return beforeStr === afterStr;
    };

    // 수정인데 내용이 그대로면 알림 안 보내기
    if (isUpdated && compareScheduleData(before.scheduleData, after.scheduleData)) {
      console.log(
        `[notifyOnScheduleChange] 스케줄 데이터 변경 없음, 알림 전송 안 함: ${context.params.sessionId}`
      );
      return null;
    }

    // 사용자 토큰 조회 (중복 제거된 tokens)
    const { tokens, devicesRef } = await getUserDeviceTokens(userId);

    if (!tokens || tokens.length === 0) {
      console.log(`[notifyOnScheduleChange] 사용자 ${userId}의 유효한 FCM 토큰이 없습니다.`);
      return null;
    }

    // 알림 메시지 구성
    const title = isNew ? '새 일정이 추가되었습니다' : '일정이 수정되었습니다';
    const body = 'shedAI에서 스케줄을 확인해보세요.';

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
      tokens,
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(
        `[notifyOnScheduleChange] 알림 전송: ${response.successCount}개 성공, ${response.failureCount}개 실패 (${isNew ? '생성' : '수정'})`
      );

      await cleanupFailedTokens(devicesRef, tokens, response, 'notifyOnScheduleChange');
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

    const senderId = messageData.senderId;
    if (!senderId) {
      return null;
    }

    // 스레드 정보 가져오기
    const threadRef = admin.firestore().doc(`dms/${threadId}`);
    const threadDoc = await threadRef.get();

    if (!threadDoc.exists) {
      return null;
    }

    const threadData = threadDoc.data();
    const participants = threadData.participants || [];

    // 수신자 찾기 (발신자가 아닌 참가자)
    const recipientId = participants.find((id) => id !== senderId);
    if (!recipientId) {
      return null;
    }

    // 수신자 토큰 조회
    const { tokens, devicesRef } = await getUserDeviceTokens(recipientId);

    if (!tokens || tokens.length === 0) {
      console.log(`[notifyOnDmMessage] 사용자 ${recipientId}의 FCM 토큰이 없습니다.`);
      return null;
    }

    // 발신자 이름 가져오기
    const senderDoc = await admin.firestore().doc(`users/${senderId}`).get();
    const senderName = senderDoc.data()?.displayName || '알 수 없음';

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
      console.log(
        `[notifyOnDmMessage] 알림 전송: ${response.successCount}개 성공, ${response.failureCount}개 실패`
      );

      await cleanupFailedTokens(devicesRef, tokens, response, 'notifyOnDmMessage');
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

    // 게시물 작성자 토큰 조회
    const { tokens, devicesRef } = await getUserDeviceTokens(postOwnerId);

    if (!tokens || tokens.length === 0) {
      console.log(`[notifyOnPostComment] 사용자 ${postOwnerId}의 FCM 토큰이 없습니다.`);
      return null;
    }

    // 댓글 작성자 이름 가져오기
    const commenterDoc = await admin.firestore().doc(`users/${commenterId}`).get();
    const commenterName = commenterDoc.data()?.displayName || '알 수 없음';

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
      console.log(
        `[notifyOnPostComment] 알림 전송: ${response.successCount}개 성공, ${response.failureCount}개 실패`
      );

      await cleanupFailedTokens(devicesRef, tokens, response, 'notifyOnPostComment');
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

    // 15분 후 시간 (로깅용)
    const reminderTimeMs = nowMs + 15 * 60 * 1000;
    const reminderTime = new Date(reminderTimeMs);

    console.log(
      `[sendScheduleReminders] 실행 시간: ${now.toISOString()}, 알림 대상 기준 시간(15분 후): ${reminderTime.toISOString()}`
    );

    try {
      const usersSnapshot = await admin.firestore().collection('users').get();

      if (usersSnapshot.empty) {
        console.log('[sendScheduleReminders] 사용자가 없습니다.');
        return null;
      }

      const reminderPromises = [];

      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const sessionsRef = admin
          .firestore()
          .collection(`users/${userId}/scheduleSessions`);

        const sessionsSnapshot = await sessionsRef
          .where('isActive', '==', true)
          .where('hasSchedule', '==', true)
          .get();

        if (sessionsSnapshot.empty) {
          continue;
        }

        for (const sessionDoc of sessionsSnapshot.docs) {
          const sessionData = sessionDoc.data();
          const scheduleData = sessionData.scheduleData;
          const createdAtMs = sessionData.createdAtMs;

          if (!scheduleData || !Array.isArray(scheduleData) || !createdAtMs) {
            continue;
          }

          // 세션 기준일(0시)
          const baseDate = new Date(createdAtMs);
          const baseDateMidnight = new Date(
            baseDate.getFullYear(),
            baseDate.getMonth(),
            baseDate.getDate()
          );

          for (const dayBlock of scheduleData) {
            if (
              !dayBlock ||
              !dayBlock.activities ||
              !Array.isArray(dayBlock.activities)
            ) {
              continue;
            }

            const day = dayBlock.day;
            if (!day || day < 1) {
              continue;
            }

            // day:1 = 기준일, day:2 = 기준일+1일 ...
            const actualDate = new Date(baseDateMidnight);
            actualDate.setDate(actualDate.getDate() + (day - 1));

            for (const activity of dayBlock.activities) {
              if (!activity || !activity.start || !activity.title) {
                continue;
              }

              const [hours, minutes] = activity.start.split(':').map(Number);
              if (isNaN(hours) || isNaN(minutes)) {
                continue;
              }

              const startTime = new Date(actualDate);
              startTime.setHours(hours, minutes, 0, 0);

              const reminderTargetTime = new Date(startTime);
              reminderTargetTime.setMinutes(reminderTargetTime.getMinutes() - 15);

              const timeDiff = Math.abs(reminderTargetTime.getTime() - nowMs);

              // Cloud Scheduler가 정확히 분단위로 도는 게 아니라서 ±1분 허용
              if (timeDiff <= 60 * 1000) {
                const reminderKey = `${userId}_${sessionDoc.id}_${day}_${activity.start}`;
                const reminderDoc = await admin
                  .firestore()
                  .doc(`scheduleReminders/${reminderKey}`)
                  .get();

                if (reminderDoc.exists) {
                  // 이미 알림 보낸 일정
                  continue;
                }

                reminderPromises.push(
                  sendReminderNotification(userId, activity.title, startTime, reminderKey)
                );
              }
            }
          }
        }
      }

      const results = await Promise.allSettled(reminderPromises);
      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failureCount = results.filter((r) => r.status === 'rejected').length;

      console.log(
        `[sendScheduleReminders] 완료: ${successCount}개 성공, ${failureCount}개 실패`
      );

      return null;
    } catch (error) {
      console.error('[sendScheduleReminders] 오류:', error);
      return null;
    }
  });

/**
 * 일정 알림 전송 헬퍼 함수
 * - 여기서도 토큰 중복 제거 + 실패 토큰 정리
 */
async function sendReminderNotification(userId, activityTitle, startTime, reminderKey) {
  try {
    const { tokens, devicesRef } = await getUserDeviceTokens(userId);

    if (!tokens || tokens.length === 0) {
      console.log(`[sendReminderNotification] 사용자 ${userId}의 FCM 토큰이 없습니다.`);
      return;
    }

    const hours = startTime.getHours();
    const minutes = startTime.getMinutes();
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

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
    console.log(
      `[sendReminderNotification] 알림 전송: ${response.successCount}개 성공, ${response.failureCount}개 실패`
    );

    // 실제로 한 번이라도 성공했다면, 중복 방지용 기록 남기기
    if (response.successCount > 0) {
      await admin
        .firestore()
        .doc(`scheduleReminders/${reminderKey}`)
        .set({
          userId,
          activityTitle,
          startTime: admin.firestore.Timestamp.fromDate(startTime),
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    await cleanupFailedTokens(devicesRef, tokens, response, 'sendScheduleReminders');
  } catch (error) {
    console.error('[sendReminderNotification] 오류:', error);
    throw error;
  }
}
