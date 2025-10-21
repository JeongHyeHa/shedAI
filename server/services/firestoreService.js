const admin = require('firebase-admin');

// Firebase Admin SDK 초기화 (이미 app.js에서 초기화됨)
const db = admin.firestore();

class FirestoreService {
    // 할 일을 Firestore에 저장
    async saveTaskToFirestore(userId, taskData) {
        try {
            const tasksRef = db.collection('users').doc(userId).collection('tasks');
            const docRef = await tasksRef.add({
                ...taskData,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                isActive: true
            });
            
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
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
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
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
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
}

module.exports = new FirestoreService();
