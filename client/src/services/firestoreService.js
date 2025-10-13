import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import { db } from '../config/firebase';

class FirestoreService {
  constructor() {
    this.db = db;
  }

  // 사용자 데이터 조회 (AI 분석용) - 보안 검증 포함
  async getUserDataForAI(userId, currentUser) {
    // 보안 검증: 현재 사용자가 자신의 데이터에만 접근 가능
    if (!currentUser || currentUser.uid !== userId) {
      throw new Error('인증되지 않은 사용자이거나 권한이 없습니다.');
    }

    try {
      const [lifestylePatterns, preferences, recentFeedbacks, allFeedbackHistory, lastSchedule] = await Promise.all([
        this.getLifestylePatterns(userId),
        this.getUserPreferences(userId),
        this.getRecentFeedbacks(userId, 5),
        this.getAllFeedbackHistory(userId),
        this.getLastSchedule(userId)
      ]);

      return {
        lifestylePatterns,
        preferences,
        recentFeedbacks,
        allFeedbackHistory, // 전체 피드백 히스토리 추가
        lastSchedule
      };
    } catch (error) {
      console.error('사용자 데이터 조회 실패:', error);
      return null;
    }
  }

  // 생활 패턴 저장
  async saveLifestylePatterns(userId, patterns) {
    try {
      const patternsRef = collection(this.db, 'users', userId, 'lifestylePatterns');
      
      // 기존 패턴들 삭제
      const existingPatterns = await getDocs(patternsRef);
      const deletePromises = existingPatterns.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
      
      // 새 패턴들 저장
      const promises = patterns.map(pattern => 
        addDoc(patternsRef, {
          patternText: pattern,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })
      );
      
      await Promise.all(promises);
      return true;
    } catch (error) {
      console.error('생활 패턴 저장 실패:', error);
      throw error;
    }
  }

  // 생활 패턴 조회
  async getLifestylePatterns(userId) {
    try {
      const patternsRef = collection(this.db, 'users', userId, 'lifestylePatterns');
      const q = query(patternsRef, where('isActive', '==', true));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => doc.data().patternText);
    } catch (error) {
      console.error('생활 패턴 조회 실패:', error);
      return [];
    }
  }

  // 스케줄 세션 저장
  async saveScheduleSession(userId, sessionData) {
    try {
      const sessionsRef = collection(this.db, 'users', userId, 'scheduleSessions');
      
      // 기존 활성 세션들 비활성화
      await this.deactivateScheduleSessions(userId);
      
      // 새 세션 저장
      const docRef = await addDoc(sessionsRef, {
        ...sessionData,
        isActive: true,
        createdAt: serverTimestamp()
      });
      
      return docRef.id;
    } catch (error) {
      console.error('스케줄 세션 저장 실패:', error);
      throw error;
    }
  }

  // 최근 스케줄 조회
  async getLastSchedule(userId) {
    try {
      const sessionsRef = collection(this.db, 'users', userId, 'scheduleSessions');
      const q = query(
        sessionsRef,
        orderBy('createdAt', 'desc'),
        limit(1)
      );
      
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        const data = querySnapshot.docs[0].data();
        // isActive가 true인 경우만 반환
        if (data.isActive === true) {
          return data;
        }
      }
      return null;
    } catch (error) {
      console.error('최근 스케줄 조회 실패:', error);
      return null;
    }
  }

  // 피드백 저장 (기존 방식)
  async saveFeedback(userId, feedbackData) {
    try {
      const feedbacksRef = collection(this.db, 'users', userId, 'feedbacks');
      
      const docRef = await addDoc(feedbacksRef, {
        ...feedbackData,
        createdAt: serverTimestamp()
      });
      
      return docRef.id;
    } catch (error) {
      console.error('피드백 저장 실패:', error);
      throw error;
    }
  }

  // 대화형 피드백 저장
  async saveConversationalFeedback(userId, userMessage, aiResponse, context = {}) {
    try {
      const feedbacksRef = collection(this.db, 'users', userId, 'feedbacks');
      
      const docRef = await addDoc(feedbacksRef, {
        type: 'conversational',
        userMessage,
        aiResponse,
        context,
        createdAt: serverTimestamp()
      });
      
      return docRef.id;
    } catch (error) {
      console.error('대화형 피드백 저장 실패:', error);
      throw error;
    }
  }

  // 최근 피드백 조회
  async getRecentFeedbacks(userId, limitCount = 5) {
    try {
      const feedbacksRef = collection(this.db, 'users', userId, 'feedbacks');
      const q = query(
        feedbacksRef,
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('최근 피드백 조회 실패:', error);
      return [];
    }
  }

  // 모든 피드백 히스토리 조회 (AI 기억용)
  async getAllFeedbackHistory(userId) {
    try {
      const feedbacksRef = collection(this.db, 'users', userId, 'feedbacks');
      const q = query(
        feedbacksRef,
        orderBy('createdAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('피드백 히스토리 조회 실패:', error);
      return [];
    }
  }

  // 사용자 선호도 저장
  async saveUserPreference(userId, preferenceData) {
    try {
      const preferencesRef = collection(this.db, 'users', userId, 'preferences');
      const { preferenceType, preferenceKey, preferenceValue, confidenceScore = 1.0 } = preferenceData;
      
      // 기존 선호도 조회
      const q = query(
        preferencesRef,
        where('preferenceType', '==', preferenceType),
        where('preferenceKey', '==', preferenceKey)
      );
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        // 기존 선호도 업데이트
        const docRef = querySnapshot.docs[0].ref;
        await updateDoc(docRef, {
          preferenceValue,
          confidenceScore,
          evidenceCount: querySnapshot.docs[0].data().evidenceCount + 1,
          updatedAt: serverTimestamp()
        });
      } else {
        // 새 선호도 생성
        await addDoc(preferencesRef, {
          preferenceType,
          preferenceKey,
          preferenceValue,
          confidenceScore,
          evidenceCount: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      
      return true;
    } catch (error) {
      console.error('사용자 선호도 저장 실패:', error);
      throw error;
    }
  }

  // 사용자 선호도 조회
  async getUserPreferences(userId) {
    try {
      const preferencesRef = collection(this.db, 'users', userId, 'preferences');
      const q = query(preferencesRef, orderBy('confidenceScore', 'desc'));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('사용자 선호도 조회 실패:', error);
      return [];
    }
  }

  // AI 조언 저장
  async saveAIAdvice(userId, adviceData) {
    try {
      const adviceRef = collection(this.db, 'users', userId, 'aiAdvice');
      
      const docRef = await addDoc(adviceRef, {
        ...adviceData,
        isRead: false,
        createdAt: serverTimestamp()
      });
      
      return docRef.id;
    } catch (error) {
      console.error('AI 조언 저장 실패:', error);
      throw error;
    }
  }

  // AI 조언 조회
  async getAIAdvice(userId, limitCount = 5) {
    try {
      const adviceRef = collection(this.db, 'users', userId, 'aiAdvice');
      const q = query(
        adviceRef,
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('AI 조언 조회 실패:', error);
      return [];
    }
  }

  // 기존 활성 스케줄 세션들 비활성화
  async deactivateScheduleSessions(userId) {
    try {
      const sessionsRef = collection(this.db, 'users', userId, 'scheduleSessions');
      const q = query(sessionsRef, where('isActive', '==', true));
      const querySnapshot = await getDocs(q);
      
      const updatePromises = querySnapshot.docs.map(doc => 
        updateDoc(doc.ref, { isActive: false })
      );
      
      await Promise.all(updatePromises);
    } catch (error) {
      console.error('스케줄 세션 비활성화 실패:', error);
    }
  }

  // 기존 활성 생활 패턴들 비활성화
  async deactivateLifestylePatterns(userId) {
    try {
      const patternsRef = collection(this.db, 'users', userId, 'lifestylePatterns');
      const q = query(patternsRef, where('isActive', '==', true));
      const querySnapshot = await getDocs(q);
      
      const updatePromises = querySnapshot.docs.map(doc => 
        updateDoc(doc.ref, { isActive: false })
      );
      
      await Promise.all(updatePromises);
    } catch (error) {
      console.error('생활 패턴 비활성화 실패:', error);
    }
  }
}

export default new FirestoreService();
