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
      
      // 기존 패턴들을 비활성화로 업데이트
      const existingPatterns = await getDocs(patternsRef);
      const updatePromises = existingPatterns.docs.map(doc => 
        updateDoc(doc.ref, {
          isActive: false,
          updatedAt: serverTimestamp()
        })
      );
      await Promise.all(updatePromises);
      
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

  // 할 일 저장
  async saveTask(userId, taskData) {
    try {
      const tasksRef = collection(this.db, 'users', userId, 'tasks');
      
      const docRef = await addDoc(tasksRef, {
        ...taskData,
        createdAt: serverTimestamp(),
        isActive: true
      });
      
      return docRef.id;
    } catch (error) {
      console.error('할 일 저장 실패:', error);
      throw error;
    }
  }

  // 할 일 조회
  async getTasks(userId) {
    try {
      const tasksRef = collection(this.db, 'users', userId, 'tasks');
      const q = query(tasksRef, where('isActive', '==', true), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('할 일 조회 실패:', error);
      return [];
    }
  }

  // 스케줄 세션 저장
  async saveScheduleSession(userId, sessionData) {
    try {
      const sessionsRef = collection(this.db, 'users', userId, 'scheduleSessions');
      
      // 실제 스케줄이 있는 세션만 활성화 대상으로 간주
      const willActivate = Array.isArray(sessionData?.scheduleData) && sessionData.scheduleData.length > 0;
      if (willActivate) {
        await this.deactivateScheduleSessions(userId);
      }
      
      // 새 세션 저장
      const docRef = await addDoc(sessionsRef, {
        ...sessionData,
        hasSchedule: willActivate,
        isActive: !!willActivate,
        createdAt: serverTimestamp()
      });
      
      return docRef.id;
    } catch (error) {
      console.error('스케줄 세션 저장 실패:', error);
      throw error;
    }
  }

  // 최근 스케줄 조회: 가장 최신 문서만 확인해 hasSchedule이 true일 때만 반환
  async getLastSchedule(userId) {
    try {
      const sessionsRef = collection(this.db, 'users', userId, 'scheduleSessions');
      const q = query(sessionsRef, orderBy('createdAt', 'desc'), limit(1));
      const qs = await getDocs(q);
      if (qs.empty) return null;
      const latest = qs.docs[0].data();
      return latest?.hasSchedule === true ? latest : null;
    } catch (error) {
      console.error('최근 스케줄 조회 실패:', error);
      return null;
    }
  }

  // 최신 스케줄을 "삭제" 처리 (hasSchedule=false, isActive=false)
  async deleteLatestSchedule(userId) {
    try {
      const sessionsRef = collection(this.db, 'users', userId, 'scheduleSessions');
      const q = query(sessionsRef, orderBy('createdAt', 'desc'), limit(10));
      const qs = await getDocs(q);
      if (qs.empty) return false;

      const target = qs.docs.find(d => d.data()?.hasSchedule === true);
      if (!target) return false;

      await updateDoc(target.ref, { hasSchedule: false, isActive: false, updatedAt: serverTimestamp() });
      return true;
    } catch (error) {
      console.error('최신 스케줄 삭제 처리 실패:', error);
      return false;
    }
  }

  // 활성 스케줄 세션 업데이트 (대화 컨텍스트 등)
  async updateActiveScheduleSession(userId, partial) {
    try {
      const sessionsRef = collection(this.db, 'users', userId, 'scheduleSessions');
      const q = query(sessionsRef, where('isActive', '==', true), limit(1));
      const qs = await getDocs(q);
      if (qs.empty) return false;
      const ref = qs.docs[0].ref;
      await updateDoc(ref, { ...partial, updatedAt: serverTimestamp() });
      return true;
    } catch (e) {
      console.error('활성 세션 업데이트 실패:', e);
      return false;
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
        aiResponse: aiResponse || null,
        context: context || null,
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

  // ===== Habits & Habit Logs =====
  // Habits collection: users/{userId}/habits
  // Habit document: { name, source ('pattern'|'task'|'custom'), isActive, createdAt, updatedAt }
  // Habit logs subcollection: users/{userId}/habits/{habitId}/logs with docs keyed by YYYY-MM-DD: { date, done }

  async getHabits(userId) {
    try {
      const habitsRef = collection(this.db, 'users', userId, 'habits');
      const qy = query(habitsRef, where('isActive', '==', true));
      const qs = await getDocs(qy);
      return qs.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
      console.error('습관 목록 조회 실패:', error);
      return [];
    }
  }

  async addHabit(userId, habit) {
    try {
      const habitsRef = collection(this.db, 'users', userId, 'habits');
      const docRef = await addDoc(habitsRef, {
        name: habit.name,
        source: habit.source || 'custom',
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return docRef.id;
    } catch (error) {
      console.error('습관 추가 실패:', error);
      throw error;
    }
  }

  async removeHabit(userId, habitId) {
    try {
      const docRef = doc(this.db, 'users', userId, 'habits', habitId);
      await deleteDoc(docRef);
      return true;
    } catch (error) {
      console.error('습관 삭제 실패:', error);
      throw error;
    }
  }

  async setHabitDone(userId, habitId, dateISO, done) {
    try {
      const logDoc = doc(this.db, 'users', userId, 'habits', habitId, 'logs', dateISO);
      await setDoc(logDoc, { date: dateISO, done }, { merge: true });
      return true;
    } catch (error) {
      console.error('습관 완료 체크 실패:', error);
      throw error;
    }
  }

  async getHabitLogsForMonth(userId, habitId, year, month) {
    try {
      // month: 1-12
      const first = new Date(Date.UTC(year, month - 1, 1));
      const last = new Date(Date.UTC(year, month, 0));
      const logsRef = collection(this.db, 'users', userId, 'habits', habitId, 'logs');
      const qs = await getDocs(logsRef);
      const all = qs.docs.map(d => d.data());
      const inMonth = {};
      for (const log of all) {
        if (!log?.date) continue;
        const d = new Date(log.date + 'T00:00:00Z');
        if (d >= first && d <= last) {
          inMonth[log.date] = !!log.done;
        }
      }
      return inMonth; // map { 'YYYY-MM-DD': true }
    } catch (error) {
      console.error('습관 로그 조회 실패:', error);
      return {};
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
