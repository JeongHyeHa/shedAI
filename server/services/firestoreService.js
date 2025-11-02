// src/services/firestoreService.js
const admin = require('firebase-admin');

// Firebase Admin SDK 초기화 (이미 app.js에서 초기화됨)
const db = admin.firestore();
const lifestyleUtils = require('../utils/lifestyleParser');

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
    constructor() {
        this.db = db;
    }

    // === NEW: 동일(제목+deadline+deadlineTime) Task가 있으면 업데이트, 없으면 생성 ===
    async upsertTaskByUniqueKey(userId, taskData) {
        try {
            const tasksRef = this.db.collection('users').doc(userId).collection('tasks');

            const title = String(taskData?.title || '').trim();
            const deadline = taskData?.deadline;
            const deadlineISO = (() => {
                if (!deadline) return null;
                if (typeof deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(deadline)) return deadline;
                const d = deadline?.toDate ? deadline.toDate() : new Date(deadline);
                if (isNaN(d)) return null;
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const da = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${da}`;
            })();
            const deadlineTime = String(taskData?.deadlineTime || '').trim();

            if (!title || !deadlineISO || !deadlineTime) {
                const payload = {
                    ...taskData,
                    ...(deadlineISO ? { deadlineISO } : {}),
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    isActive: true
                };
                const docRef = await tasksRef.add(payload);
                return { id: docRef.id, created: true };
            }

            const qs = await tasksRef
                .where('isActive', '==', true)
                .where('title', '==', title)
                .where('deadlineISO', '==', deadlineISO)
                .where('deadlineTime', '==', deadlineTime)
                .limit(1)
                .get();

            if (!qs.empty) {
                const ref = qs.docs[0].ref;
                await ref.update({
                    ...taskData,
                    deadlineISO,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                return { id: ref.id, created: false };
            }

            const docRef = await tasksRef.add({
                ...taskData,
                deadlineISO,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                isActive: true
            });
            return { id: docRef.id, created: true };
        } catch (error) {
            console.error('[Firestore] upsertTaskByUniqueKey 실패:', error);
            throw error;
        }
    }
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

    // 할 일 저장 (업서트 사용)
    async saveTask(userId, taskData) {
        try {
            if (!userId) throw new Error('userId가 없습니다.');
            if (!taskData?.title) throw new Error('taskData.title이 없습니다.');

            if (!taskData.deadlineISO && taskData.deadline) {
                const d = taskData.deadline?.toDate ? taskData.deadline.toDate() : new Date(taskData.deadline);
                if (!isNaN(d)) {
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const da = String(d.getDate()).padStart(2, '0');
                    taskData.deadlineISO = `${y}-${m}-${da}`;
                }
            }

            const res = await this.upsertTaskByUniqueKey(userId, taskData);
            return res.id;
        } catch (error) {
            console.error('[Firestore] saveTask 실패:', error);
            throw error;
        }
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

    // 기존 활성 스케줄 세션들 비활성화 (배치)
    async deactivateScheduleSessions(userId) {
        try {
            const sessionsRef = this.db.collection('users').doc(userId).collection('scheduleSessions');
            const qs = await sessionsRef.where('isActive', '==', true).get();
            if (qs.empty) return;
            const batch = this.db.batch();
            qs.forEach(d => batch.update(d.ref, { isActive: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
            await batch.commit();
        } catch (error) {
            console.error('스케줄 세션 비활성화 실패:', error);
        }
    }

    // 기존 활성 생활 패턴들 비활성화 (배치)
    async deactivateLifestylePatterns(userId) {
        try {
            const patternsRef = this.db.collection('users').doc(userId).collection('lifestylePatterns');
            const qs = await patternsRef.where('isActive', '==', true).get();
            if (qs.empty) return;
            const batch = this.db.batch();
            qs.forEach(d => batch.update(d.ref, { isActive: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
            await batch.commit();
        } catch (error) {
            console.error('생활 패턴 비활성화 실패:', error);
        }
    }

    // 할 일 삭제: 기본 soft-delete (isActive=false)
    async deleteTask(userId, taskId) {
        try {
            const taskRef = this.db.collection('users').doc(userId).collection('tasks').doc(taskId);
            await taskRef.update({ isActive: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            console.log(`[Firestore] 할 일 비활성화 완료: ${taskId}`);
        } catch (error) {
            console.error('[Firestore] 할 일 비활성화 실패:', error);
            throw error;
        }
    }

    // 완전 삭제 (주의)
    async purgeTask(userId, taskId) {
        try {
            const taskRef = this.db.collection('users').doc(userId).collection('tasks').doc(taskId);
            await taskRef.delete();
            console.log(`[Firestore] 할 일 완전 삭제 완료: ${taskId}`);
        } catch (error) {
            console.error('[Firestore] 할 일 완전 삭제 실패:', error);
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

    // 피드백 저장 (구조화된 형태)
    async saveFeedback(userId, feedbackText, rating, metadata = {}) {
        try {
            const feedbackRef = db.collection('users').doc(userId).collection('feedbacks');
            
            // 피드백에서 패턴 추출
            const lowerText = (feedbackText || '').toLowerCase();
            const patterns = {
                weekendRest: /(주말|토요일|일요일).*(쉬|안|못|금지|배치.*말|안.*해|쉴|휴식)/.test(lowerText),
                morningPreference: /(오전|아침|새벽|일찍|평일.*오전).*(작업|공부|할일|일정)/i.test(lowerText),
                eveningPreference: /(오후|저녁|밤|늦|21시|9시.*이후|오후.*9시).*(작업|공부|할일|일정|빈.*시간)/i.test(lowerText),
                timePreference: lowerText.match(/(\d+)시.*이후|오후\s*(\d+)시/i) ? true : false
            };
            
            // 구조화된 피드백 문서 생성
            const feedbackDoc = {
                // 기본 정보
                feedbackText: feedbackText,
                rating: typeof rating === 'number' ? rating : null,
                
                // 메타데이터
                type: metadata.type || 'general', // 'general', 'schedule_preference', 'time_preference', etc.
                scheduleId: metadata.scheduleId || null,
                sessionId: metadata.sessionId || null,
                
                // 추출된 패턴
                patterns: patterns,
                
                // 추가 메타데이터
                metadata: {
                    userAgent: metadata.userAgent || null,
                    source: metadata.source || 'manual', // 'manual', 'chat', 'ui'
                    ...metadata.additionalData
                },
                
                // 타임스탬프
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            
            const docRef = await feedbackRef.add(feedbackDoc);
            console.log(`[Firestore] 피드백 저장 완료: ${docRef.id} (타입: ${feedbackDoc.type})`);
            return docRef.id;
        } catch (error) {
            console.error('[Firestore] 피드백 저장 실패:', error);
            throw error;
        }
    }

    // 생활패턴 저장 (원문 + 구조화 동시 저장, 배치)
    async saveLifestylePatterns(userId, patterns) {
        try {
            const patternsRef = this.db.collection('users').doc(userId).collection('lifestylePatterns');

            // 기존 활성 패턴 비활성화
            await this.deactivateLifestylePatterns(userId);

            const batch = this.db.batch();
            (Array.isArray(patterns) ? patterns : []).forEach((patternText) => {
                const parsed = lifestyleUtils.parseLifestylePattern(patternText) || {};
                const ref = patternsRef.doc();
                batch.set(ref, {
                    patternText,
                    days: parsed.days || [],
                    start: parsed.start ?? null,
                    end: parsed.end ?? null,
                    title: parsed.title || '',
                    overnight: parsed.isOvernight || false,
                    isActive: true,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
            console.log('[Firestore] 생활패턴 저장 완료');
            return true;
        } catch (error) {
            console.error('생활 패턴 저장 실패:', error);
            throw error;
        }
    }

    // 생활패턴 조회 (구조화 우선, 기존 문자열 형식 유지)
    async getLifestylePatterns(userId) {
        try {
            const patternsRef = this.db.collection('users').doc(userId).collection('lifestylePatterns');
            const qs = await patternsRef.where('isActive', '==', true).get();
            if (qs.empty) return [];
            return qs.docs.map(doc => {
                const d = doc.data();
                if (d.patternText) return d.patternText;
                if (d.days && d.start != null && d.end != null && d.title) {
                    return `${d.title} (${String(d.start).padStart(2,'0')}:00-${String(d.end).padStart(2,'0')}:00, 요일: ${[].concat(d.days).join(', ')})`;
                }
                return '';
            }).filter(Boolean);
        } catch (error) {
            console.error('[Firestore] 생활 패턴 조회 실패:', error);
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

    // 공통 헬퍼: 스케줄 유효성 판별 (향후 saveScheduleSession/getLastSchedule에 사용)
    _hasRealSchedule(sd) {
        if (!sd) return false;
        if (Array.isArray(sd)) return sd.length > 0;
        if (sd && Array.isArray(sd.days)) {
            return sd.days.some(d => Array.isArray(d.activities) && d.activities.some(a => !!a && Object.keys(a).length));
        }
        if (Array.isArray(sd.events)) return sd.events.length > 0;
        return false;
    }

    // 피드백 목록 조회
    async getFeedbacks(userId, options = {}) {
        try {
            const ref = db.collection('users').doc(userId).collection('feedbacks');
            let query = ref.orderBy('createdAt', 'desc');
            
            // 타입 필터링 (선택적)
            if (options.type) {
                query = query.where('type', '==', options.type);
            }
            
            // 개수 제한 (선택적, 기본 50개)
            const limit = options.limit || 50;
            query = query.limit(limit);
            
            const snap = await query.get();
            return snap.docs.map(d => ({ 
                id: d.id, 
                ...d.data(),
                // createdAt을 Date로 변환
                createdAt: d.data().createdAt?.toDate ? d.data().createdAt.toDate() : d.data().createdAt
            }));
        } catch (e) {
            console.error('[Firestore] 피드백 목록 조회 실패:', e);
            return [];
        }
    }
    
    // 피드백 패턴 조회 (시간대 선호도, 주말 정책 등)
    async getFeedbackPatterns(userId) {
        try {
            const feedbacks = await this.getFeedbacks(userId, { limit: 20 });
            
            // 최근 피드백에서 패턴 집계
            const patterns = {
                weekendRest: false,
                morningPreference: false,
                eveningPreference: false,
                timePreference: null,
                lastUpdated: null
            };
            
            if (feedbacks.length > 0) {
                // 최신 피드백의 패턴 사용
                const latest = feedbacks[0];
                if (latest.patterns) {
                    patterns.weekendRest = latest.patterns.weekendRest || false;
                    patterns.morningPreference = latest.patterns.morningPreference || false;
                    patterns.eveningPreference = latest.patterns.eveningPreference || false;
                    patterns.timePreference = latest.patterns.timePreference || false;
                }
                patterns.lastUpdated = latest.createdAt;
            }
            
            return patterns;
        } catch (e) {
            console.error('[Firestore] 피드백 패턴 조회 실패:', e);
            return {
                weekendRest: false,
                morningPreference: false,
                eveningPreference: false,
                timePreference: null,
                lastUpdated: null
            };
        }
    }
}

module.exports = new FirestoreService();
