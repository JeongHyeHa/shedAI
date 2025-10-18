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
    
    // 사용자의 할 일 목록 조회
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
}

module.exports = new FirestoreService();
