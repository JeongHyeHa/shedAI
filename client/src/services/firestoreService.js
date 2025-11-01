// firestoreService.js
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
    if (!db) {
      throw new Error('Firebase가 초기화되지 않았습니다. .env 환경변수를 확인하세요.');
    }
    this.db = db;
  }

  // 생활패턴 문자열을 객체로 파싱하는 헬퍼 함수
  parseLifestylePattern(pattern) {
    if (typeof pattern === 'object' && pattern) return pattern; // 이미 객체
    
    const text = String(pattern || '');
    
    // 요일 키워드 → days 배열 변환
    const days = (() => {
      if (/매일/.test(text)) return [1,2,3,4,5,6,7];
      if (/평일/.test(text)) return [1,2,3,4,5];
      if (/주말/.test(text)) return [6,7];
      const map = {월:1,화:2,수:3,목:4,금:5,토:6,일:7};
      const found = Array.from(text.matchAll(/(월|화|수|목|금|토|일)요일/g)).map(m=>map[m[1]]);
      return found.length ? found : [1,2,3,4,5,6,7];
    })();
    
    // 시간 추출 (12시간/24시간 형식 모두 지원)
    const to24 = (ap, h, m='0') => {
      let hh = parseInt(h,10);
      if (ap === '오후' && hh < 12) hh += 12;
      if (ap === '오전' && hh === 12) hh = 0;
      // 오후 12시는 12시 그대로 (정오)
      if (ap === '오후' && hh === 12) hh = 12;
      return { hh, mm: parseInt(m,10)||0 };
    };
    
    let start='00:00', end='00:00';
    
    // 12시간 형식: "오전 8시~오후 5시" 또는 "8시~17시"
    const hm = Array.from(text.matchAll(/(오전|오후)?\s*(\d{1,2})(?::(\d{1,2}))?\s*~\s*(오전|오후)?\s*(\d{1,2})(?::(\d{1,2}))?/g));
    if (hm[0]) {
      const s = to24(hm[0][1], hm[0][2], hm[0][3]);
      const e = to24(hm[0][4], hm[0][5], hm[0][6]);
      start = `${String(s.hh).padStart(2,'0')}:${String(s.mm).padStart(2,'0')}`;
      end   = `${String(e.hh).padStart(2,'0')}:${String(e.mm).padStart(2,'0')}`;
    } else {
      // 24시간 형식: "02:00-10:00" 또는 "8:00~17:00"
      const hm24 = text.match(/(\d{1,2}):?(\d{2})?\s*[-~]\s*(\d{1,2}):?(\d{2})?/);
      if (hm24) {
        const sh = String(hm24[1]).padStart(2,'0');
        const sm = String(hm24[2]||'00').padStart(2,'0');
        const eh = String(hm24[3]).padStart(2,'0');
        const em = String(hm24[4]||'00').padStart(2,'0');
        start = `${sh}:${sm}`; 
        end = `${eh}:${em}`;
      }
    }
    
    // 제목: 시간/요일 키워드 제거 후 남은 텍스트
    const title = text
      .replace(/매일|평일|주말/g,'')
      .replace(/(월|화|수|목|금|토|일)요일/g,'')
      .replace(/오전|오후/g,'')
      .replace(/\d{1,2}(:\d{2})?\s*[~\-]\s*\d{1,2}(:\d{2})?/,'')
      .trim() || '제목없음';

    // 야간 구간(자정 넘김) 감지
    const overnight = end <= start; // 예: '23:00' > '02:00' → true

    return { days, start, end, title, patternText: text, isActive: true, overnight };
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
      
      // 새 패턴들 저장 (문자열로 저장)
      const promises = patterns.map(pattern => {
        return addDoc(patternsRef, {
          patternText: pattern, // 문자열로 저장
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });
      
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
      
      return querySnapshot.docs.map(doc => {
        const data = doc.data();
        // 문자열로 저장된 경우 그대로 반환
        if (data.patternText) {
          return data.patternText;
        }
        // 기존 객체 형태인 경우 문자열로 변환
        if (data.days && data.start && data.end && data.title) {
          return `${data.title} (${data.start}-${data.end}, 요일: ${data.days.join(', ')})`;
        }
        return '';
      }).filter(Boolean);
    } catch (error) {
      console.error('생활 패턴 조회 실패:', error);
      return [];
    }
  }

  // 할 일 저장
  async saveTask(userId, taskData) {
    try {
      // 입력 검증
      if (!userId) {
        console.error('[FirestoreService.saveTask] userId가 없습니다.');
        throw new Error('userId가 없습니다.');
      }
      if (!taskData?.title) {
        console.error('[FirestoreService.saveTask] taskData.title이 없습니다.');
        throw new Error('taskData.title이 없습니다.');
      }
      
      const tasksRef = collection(this.db, 'users', userId, 'tasks');
      const docRef = await addDoc(tasksRef, {
        ...taskData,
        createdAt: serverTimestamp(),
        isActive: true
      });
      return docRef.id;
    } catch (error) {
      throw error;
    }
  }

  // 할 일 조회 (활성화된 것만)
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

  // 모든 할 일 조회 (활성화/비활성화 포함)
  async getAllTasks(userId) {
    try {
      const tasksRef = collection(this.db, 'users', userId, 'tasks');
      const q = query(tasksRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const tasks = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      return tasks;
    } catch (error) {
      console.error('모든 할 일 조회 실패:', error);
      return [];
    }
  }

  // 할 일 삭제
  async deleteTask(userId, taskId) {
    try {
      const taskRef = doc(this.db, 'users', userId, 'tasks', taskId);
      await deleteDoc(taskRef);
    } catch (error) {
      console.error('할 일 삭제 실패:', error);
      throw error;
    }
  }

  // 할 일 상태 업데이트 (활성화/비활성화)
  async updateTaskStatus(userId, taskId, isActive) {
    try {
      const taskRef = doc(this.db, 'users', userId, 'tasks', taskId);
      await updateDoc(taskRef, {
        isActive: isActive,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('할 일 상태 업데이트 실패:', error);
      throw error;
    }
  }

  // 할 일 완전 업데이트 (수정)
  async updateTask(userId, taskId, taskData) {
    try {
      const taskRef = doc(this.db, 'users', userId, 'tasks', taskId);
      await updateDoc(taskRef, {
        title: taskData.title,
        deadline: taskData.deadline,
        importance: taskData.importance,
        difficulty: taskData.difficulty,
        description: taskData.description || '',
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('할 일 업데이트 실패:', error);
      throw error;
    }
  }

  // 모든 할 일 삭제
  async deleteAllTasks(userId) {
    try {
      const tasksRef = collection(this.db, 'users', userId, 'tasks');
      const tasksSnapshot = await getDocs(tasksRef);
      
      const deletePromises = tasksSnapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
      
      console.log(`사용자 ${userId}의 모든 할 일이 삭제되었습니다.`);
    } catch (error) {
      console.error('전체 할 일 삭제 실패:', error);
      throw error;
    }
  }

  // 피드백 조회
  async getFeedbacks(userId) {
    try {
      const feedbacksRef = collection(this.db, 'users', userId, 'feedbacks');
      const feedbacksSnapshot = await getDocs(feedbacksRef);
      
      return feedbacksSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('피드백 조회 실패:', error);
      throw error;
    }
  }

  // 스케줄 세션 저장
  async saveScheduleSession(userId, sessionData) {
    try {
      const sessionsRef = collection(this.db, 'users', userId, 'scheduleSessions');
      
      // 실제 스케줄 존재 여부 판단 (배열/객체 모든 형태 지원)
      const hasRealSchedule = (sd) => {
        if (!sd) return false;
        if (Array.isArray(sd)) return sd.length > 0;
        if (Array.isArray(sd.days)) {
          return sd.days.some(d => Array.isArray(d.activities) && d.activities.length > 0);
        }
        if (Array.isArray(sd.events)) return sd.events.length > 0;
        return false;
      };
      const willActivate = hasRealSchedule(sessionData?.scheduleData);
      
      if (willActivate) {
        await this.deactivateScheduleSessions(userId);
      }
      
      // 새 세션 저장 (정합성 강화)
      const docRef = await addDoc(sessionsRef, {
        ...sessionData,
        hasSchedule: willActivate,   
        isActive: willActivate,      
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),    
        updatedAt: serverTimestamp()
      });
      
      return docRef.id;
    } catch (error) {
      console.error('스케줄 세션 저장 실패:', error);
      throw error;
    }
  }

  // 최근 스케줄 조회: 빈 스케줄은 무시하고 유효한 스케줄만 반환
  async getLastSchedule(userId) {
    try {
      const sessionsRef = collection(this.db, 'users', userId, 'scheduleSessions');
      
      // 실제 스케줄 존재 여부 판단 헬퍼
      const hasRealSchedule = (sd) => {
        if (!sd) return false;
        if (Array.isArray(sd)) return sd.length > 0;
        if (Array.isArray(sd?.days)) {
          return sd.days.some(d => Array.isArray(d.activities) && d.activities.length > 0);
        }
        if (Array.isArray(sd?.events)) return sd.events.length > 0;
        return false;
      };
      
      const q = query(sessionsRef, orderBy('createdAtMs', 'desc'), limit(10));
      const qs = await getDocs(q);
      for (const doc of qs.docs) {
        const data = doc.data();
        if (hasRealSchedule(data?.scheduleData)) {
          return data;
        }
      }
      
      // 유효한 스케줄이 없으면 null 반환
      return null;
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

  // 최근 스케줄의 활동 비중 업데이트
  async updateLastScheduleActivityAnalysis(userId, activityAnalysis) {
    try {
      const sessionsRef = collection(this.db, 'users', userId, 'scheduleSessions');
      const q = query(sessionsRef, orderBy('createdAtMs', 'desc'), limit(10));
      const qs = await getDocs(q);
      
      // 실제 스케줄 존재 여부 판단 헬퍼
      const hasRealSchedule = (sd) => {
        if (!sd) return false;
        if (Array.isArray(sd)) return sd.length > 0;
        if (Array.isArray(sd?.days)) {
          return sd.days.some(d => Array.isArray(d.activities) && d.activities.length > 0);
        }
        if (Array.isArray(sd?.events)) return sd.events.length > 0;
        return false;
      };
      
      for (const doc of qs.docs) {
        const data = doc.data();
        if (hasRealSchedule(data?.scheduleData)) {
          await updateDoc(doc.ref, {
            activityAnalysis,
            updatedAt: serverTimestamp()
          });
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('최근 스케줄 활동 비중 업데이트 실패:', error);
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
      const logsRef = collection(this.db, 'users', userId, 'habits', habitId, 'logs');
      const startISO = `${year}-${String(month).padStart(2,'0')}-01`;
      const endDate = new Date(Date.UTC(year, month, 0)).getUTCDate(); // 말일
      const endISO = `${year}-${String(month).padStart(2,'0')}-${String(endDate).padStart(2,'0')}`;
      
      // 서버 쿼리로 필터링하여 성능 개선
      const qy = query(
        logsRef,
        where('date', '>=', startISO),
        where('date', '<=', endISO),
        orderBy('date', 'asc')
      );
      const qs = await getDocs(qy);
      
      const inMonth = {};
      for (const doc of qs.docs) {
        const data = doc.data();
        if (data?.date) {
          inMonth[data.date] = !!data.done;
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
        updateDoc(doc.ref, { 
          isActive: false,
          updatedAt: serverTimestamp()
        })
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
        updateDoc(doc.ref, { 
          isActive: false,
          updatedAt: serverTimestamp()
        })
      );
      
      await Promise.all(updatePromises);
    } catch (error) {
      console.error('생활 패턴 비활성화 실패:', error);
    }
  }
}

// Lazy singleton pattern - Firebase 초기화 순서 문제 방지
let _firestoreServiceInstance = null;

export function getFirestoreService() {
  if (!_firestoreServiceInstance) {
    _firestoreServiceInstance = new FirestoreService();
  }
  return _firestoreServiceInstance;
}

// 기본 export는 인스턴스로 (일관성 유지)
export default getFirestoreService();