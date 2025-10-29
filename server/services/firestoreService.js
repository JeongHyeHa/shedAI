// src/services/firestoreService.js
const admin = require('firebase-admin');

// Firebase Admin SDK 초기화 (이미 app.js에서 초기화됨)
const db = admin.firestore();

// YYYY-MM-DD (KST) 표준화: 이미 YYYY-MM-DD면 그대로 반환, Timestamp/Date는 KST로 변환
function toYMDLocalServer(value) {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value; // 이미 표준 문자열이면 이중 변환 금지
    }
    const d = value?.toDate ? value.toDate() : new Date(value);
    if (isNaN(d)) return null;
    // KST(UTC+9) 기준으로 날짜 부분만 계산
    const utcMid = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const kst = new Date(utcMid + 9 * 60 * 60 * 1000);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kst.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function canonTitle(s='') {
    return String(s)
        .replace(/\s+/g, ' ')
        .replace(/준비|공부|연습|스터디/gi, '')
        .replace(/[()\[\]{}·•.,:;|]/g, '')
        .trim()
        .toLowerCase();
}

class FirestoreService {
    // 할 일을 Firestore에 저장
    async saveTaskToFirestore(userId, taskData) {
        try {
            const tasksRef = db.collection('users').doc(userId).collection('tasks');
            const deadlineStr = toYMDLocalServer(taskData?.deadline);
            const payload = {
                ...taskData,
                ...(deadlineStr ? { deadline: deadlineStr } : {}),
                canonTitle: canonTitle(taskData?.title || ''),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                isActive: true
            };
            const docRef = await tasksRef.add(payload);
            
            console.log(`[Firestore] 할 일 저장 완료: ${docRef.id}`);
            return docRef.id;
        } catch (error) {
            console.error('[Firestore] 할 일 저장 실패:', error);
            throw error;
        }
    }

    // 할 일 저장 (saveTaskToFirestore의 별칭)
    async saveTask(userId, taskData) {
        return this.saveTaskToFirestore(userId, taskData);
    }
    
    // 사용자의 할 일 목록 조회 (활성화된 것만)
    async getTasks(userId) {
        try {
            const tasksRef = db.collection('users').doc(userId).collection('tasks');
            const snapshot = await tasksRef.where('isActive', '==', true).orderBy('createdAt', 'desc').get();
            
            return snapshot.docs.map(doc => {
                const data = doc.data();
                const deadline = (typeof data?.deadline === 'string')
                    ? data.deadline
                    : toYMDLocalServer(data?.deadline);
                return { id: doc.id, ...data, ...(deadline ? { deadline } : {}) };
            });
        } catch (error) {
            console.error('[Firestore] 할 일 조회 실패:', error);
            return [];
        }
    }

    // 모든 할 일 조회 (활성화/비활성화 포함)
    async getAllTasks(userId) {
        try {
            const tasksRef = db.collection('users').doc(userId).collection('tasks');
            const snapshot = await tasksRef.orderBy('createdAt', 'desc').get();
            try {
                console.debug('[FS][getAllTasks] projectId=', process.env.FIREBASE_PROJECT_ID, 'uid=', userId, 'size=', snapshot.size);
            } catch {}
            return snapshot.docs.map(doc => {
                const data = doc.data();
                const deadline = (typeof data?.deadline === 'string')
                    ? data.deadline
                    : toYMDLocalServer(data?.deadline);
                return { id: doc.id, ...data, ...(deadline ? { deadline } : {}) };
            });
        } catch (error) {
            console.error('[Firestore] 모든 할 일 조회 실패:', error);
            return [];
        }
    }

    // 할 일 삭제
    async deleteTask(userId, taskId) {
        try {
            const taskRef = db.collection('users').doc(userId).collection('tasks').doc(taskId);
            await taskRef.delete();
            console.log(`[Firestore] 할 일 삭제 완료: ${taskId}`);
        } catch (error) {
            console.error('[Firestore] 할 일 삭제 실패:', error);
            throw error;
        }
    }

    // 할 일 활성/비활성 업데이트
    async updateTaskStatus(userId, taskId, isActive) {
        try {
            const taskRef = db.collection('users').doc(userId).collection('tasks').doc(taskId);
            await taskRef.update({ isActive });
            console.log(`[Firestore] 할 일 상태 변경: ${taskId} → ${isActive}`);
        } catch (error) {
            console.error('[Firestore] 할 일 상태 변경 실패:', error);
            throw error;
        }
    }

    // 피드백 저장
    async saveFeedback(userId, feedbackText, rating) {
        try {
            const feedbackRef = db.collection('users').doc(userId).collection('feedbacks');
            const docRef = await feedbackRef.add({
                feedbackText,
                rating: typeof rating === 'number' ? rating : null,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`[Firestore] 피드백 저장 완료: ${docRef.id}`);
            return docRef.id;
        } catch (error) {
            console.error('[Firestore] 피드백 저장 실패:', error);
            throw error;
        }
    }

    // 생활패턴 저장 (배열 형태)
    async saveLifestylePatterns(userId, patterns) {
        try {
            const ref = db.collection('users').doc(userId).collection('settings').doc('lifestyle');
            await ref.set({
                patterns: Array.isArray(patterns) ? patterns : [],
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log('[Firestore] 생활패턴 저장 완료');
        } catch (error) {
            console.error('[Firestore] 생활패턴 저장 실패:', error);
            throw error;
        }
    }

    // 생활패턴 조회
    async getLifestylePatterns(userId) {
        try {
            const ref = db.collection('users').doc(userId).collection('settings').doc('lifestyle');
            const snap = await ref.get();
            if (!snap.exists) return [];
            const data = snap.data();
            return Array.isArray(data?.patterns) ? data.patterns : [];
        } catch (error) {
            console.error('[Firestore] 생활패턴 조회 실패:', error);
            return [];
        }
    }

    // === 세션 단위 Tasks (users/{userId}/scheduleSessions/{sessionId}/tasks) ===
    async saveSessionTask(userId, sessionId, taskData) {
        try {
            const ref = db.collection('users')
                .doc(userId)
                .collection('scheduleSessions')
                .doc(sessionId)
                .collection('tasks');
            const docRef = await ref.add({
                ...taskData,
                active: taskData?.active !== false,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`[Firestore] 세션 할 일 저장 완료: ${docRef.id}`);
            return docRef.id;
        } catch (error) {
            console.error('[Firestore] 세션 할 일 저장 실패:', error);
            throw error;
        }
    }

    async getSessionTasks(userId, sessionId) {
        try {
            const ref = db.collection('users')
                .doc(userId)
                .collection('scheduleSessions')
                .doc(sessionId)
                .collection('tasks');
            const snap = await ref.orderBy('createdAt', 'asc').get();
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (error) {
            console.error('[Firestore] 세션 할 일 조회 실패:', error);
            return [];
        }
    }

    async deleteSessionTask(userId, sessionId, taskId) {
        try {
            await db.collection('users')
                .doc(userId)
                .collection('scheduleSessions')
                .doc(sessionId)
                .collection('tasks')
                .doc(taskId)
                .delete();
            console.log(`[Firestore] 세션 할 일 삭제 완료: ${taskId}`);
        } catch (error) {
            console.error('[Firestore] 세션 할 일 삭제 실패:', error);
            throw error;
        }
    }

    async updateSessionTaskStatus(userId, sessionId, taskId, isActive) {
        try {
            await db.collection('users')
                .doc(userId)
                .collection('scheduleSessions')
                .doc(sessionId)
                .collection('tasks')
                .doc(taskId)
                .update({ active: !!isActive, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            console.log(`[Firestore] 세션 할 일 상태 변경: ${taskId} → ${!!isActive}`);
        } catch (error) {
            console.error('[Firestore] 세션 할 일 상태 변경 실패:', error);
            throw error;
        }
    }

    async getFeedbacks(userId) {
            try {
              const ref = db.collection('users').doc(userId).collection('feedbacks');
              const snap = await ref.orderBy('createdAt', 'desc').get();
              return snap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e) {
              console.error('[Firestore] 피드백 목록 조회 실패:', e);
              return [];
            }
          }
}

module.exports = new FirestoreService();
