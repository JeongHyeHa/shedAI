// src/controllers/aiController.js
const aiService = require('../services/aiService');
const utils = require('../utils/lifestyleParser');
// --- helpers: deadline cap ---
const toDateSafe = (v) => {
    if (!v) return null;
    if (v.toDate) return v.toDate();     // Firestore Timestamp
    if (v instanceof Date) return v;
    if (typeof v === 'string') {
      const d = new Date(v);
      return isNaN(d) ? null : d;
    }
    return null;
  };
  
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  
  const normalizeTitleKey = (s='') => String(s)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/준비|공부|하기/g, '');

  function buildDeadlineDayMap(existingTasks = [], today = new Date()) {
    const map = new Map();
    const base = (() => {
      const dow = today.getDay(); // Sun=0
      return dow === 0 ? 7 : dow; // Mon=1 ... Sun=7
    })();
    for (const t of existingTasks) {
      const dl = toDateSafe(t.deadline);
      if (!dl) continue;
      const diffDays = Math.floor((startOfDay(dl) - startOfDay(today)) / (24*60*60*1000));
      const deadlineDay = base + Math.max(0, diffDays);
      const key = normalizeTitleKey(t.title || '');
      map.set(key, deadlineDay);
    }
    return map;
  }
  
  function capScheduleByDeadlines(schedule = [], deadlineMap) {
    if (!deadlineMap || !deadlineMap.size) return schedule;
    return (schedule || []).map(day => {
      const kept = (day.activities || []).filter(act => {
        const isTask = String(act.type || 'task').toLowerCase() === 'task';
        if (!isTask) return true;
        const key = normalizeTitleKey(act.title || '');
        const dlDay = deadlineMap.get(key);
        if (!dlDay) return true;
        return day.day <= dlDay; // day가 마감일(day index) 초과면 버림
      });
      return { ...day, activities: kept };
    });
  }

// 중복 요청 차단 (idempotency)
const inProgress = new Set();

class AIController {
    // 스케줄 생성
    async generateSchedule(req, res) {
        const { userId, sessionId } = req.body || {};
        const dedupeKey = JSON.stringify({ userId, sessionId: sessionId || Date.now() });
        
        // 중복 요청 차단
        if (inProgress.has(dedupeKey)) {
            console.warn('[AI Controller] 중복 요청 차단:', dedupeKey);
            return res.status(429).json({ ok: false, error: 'duplicate request' });
        }
        inProgress.add(dedupeKey);
        
        try {
        const {
            messages,
            prompt,
            promptContext,
            lifestylePatterns,
            sessionId,
            nowOverride,
            anchorDay,
            existingTasks: existingTasksFromClient
        } = req.body || {};
        const userId =
            req.params?.userId || req.query?.userId || req.headers['x-user-id'] || req.body?.userId;

        let messageArray = messages;
        let parsedLifestylePatterns = [];
        let existingTasks = Array.isArray(existingTasksFromClient) ? existingTasksFromClient.slice() : [];
        let sessionIdFinal = sessionId;

        try {
            
            // 스케줄 생성 요청 처리
            if (!messageArray) {
                const contentToUse = promptContext || prompt;
                if (contentToUse) {
                    messageArray = [{ role: 'user', content: contentToUse }];
                }
            } else if (prompt && !messageArray.some(m => m.role === 'user' && m.content === prompt)) {
                // messages가 있지만 prompt가 포함되지 않은 경우, prompt를 마지막 user 메시지로 추가
                messageArray = [...messageArray, { role: 'user', content: prompt }];
            }

            messageArray = (messageArray || []).filter(
                m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0
            );

            try {
                const { preprocessMessageForDays } = require('../utils/dateParser');
                const baseNow = nowOverride ? new Date(nowOverride) : new Date();
                messageArray = messageArray.map(m =>
                    (m && m.role === 'user' && m.content)
                        ? { ...m, content: preprocessMessageForDays(m.content, baseNow) }
                        : m
                );
            } catch (e) {
                console.warn('서버 날짜 전처리 실패:', e.message);
            }
            
            if (!messageArray || !Array.isArray(messageArray)) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '메시지 배열 또는 프롬프트가 필요합니다.' 
                });
            }

            if (!userId) console.warn('[generateSchedule] Missing userId …');
            if (!sessionIdFinal) console.warn('[generateSchedule] Missing sessionId …');

            // 라이프스타일 패턴 파싱/로드
            if (lifestylePatterns && Array.isArray(lifestylePatterns)) {
                parsedLifestylePatterns = lifestylePatterns
                    .map(pattern => (typeof pattern === 'object' ? pattern :
                        (typeof pattern === 'string' ? utils.parseLifestylePattern(pattern) : null)))
                    .filter(Boolean);
            } else if (typeof lifestylePatterns === 'string' && lifestylePatterns.trim()) {
                const patterns = lifestylePatterns
                    .split(/\r?\n|[;,]+/)
                    .map(s => s.trim())
                    .filter(Boolean);
                parsedLifestylePatterns = patterns
                    .map(pattern => utils.parseLifestylePattern(pattern))
                    .filter(Boolean);
            } else if (userId) {
                try {
                    const firestoreService = require('../services/firestoreService');
                    const stored = await firestoreService.getLifestylePatterns(userId);
                    if (Array.isArray(stored)) {
                        parsedLifestylePatterns = stored
                            .map(p => (typeof p === 'string' ? utils.parseLifestylePattern(p) : p))
                            .filter(Boolean);
                    }
                } catch (e) {
                    console.warn('생활패턴 기본 로드 실패:', e.message);
                }
            }

            // 기존 할 일 준비
            console.log('[AI Controller] 클라이언트에서 전달된 할 일:', existingTasks.length, '개');
            const normFromClient = t => {
                // 어떤 형식이 와도 YYYY-MM-DD로 보정
                let dl = t?.deadline;
                if (dl?.toDate) dl = dl.toDate();
                const d = (dl instanceof Date) ? dl : (dl ? new Date(dl) : null);
                if (d && !Number.isNaN(d.getTime())) {
                  const off = d.getTimezoneOffset();
                  dl = new Date(d.getTime() - off*60000).toISOString().slice(0,10);
                } else {
                  dl = null;
                }
                return {
                    title: t?.title || '제목없음',
                    deadline: dl || null,
                    importance: t?.importance || '중',
                    difficulty: t?.difficulty || '중',
                    description: t?.description || '',
                    ...(Number.isFinite(t?.relativeDay) ? { relativeDay: t.relativeDay } : {})
                };
            };
            existingTasks = existingTasks.map(normFromClient);
            
            console.log('[AI Controller] 클라이언트에서 전달된 할 일:', existingTasks.length, '개');
            
            if (existingTasks.length === 0 && userId) {
                try {
                    const firestoreService = require('../services/firestoreService');
                    const [sessionTasks, globalTasks] = await Promise.all([
                        sessionIdFinal ? firestoreService.getSessionTasks(userId, sessionIdFinal).catch(()=>[]) : Promise.resolve([]),
                        firestoreService.getAllTasks ? firestoreService.getAllTasks(userId).catch(()=>[]) : Promise.resolve([])
                    ]);

                    const normalize = (t) => {
                        // deadline 통일: ISO 'YYYY-MM-DD' 문자열
                        let dl = t?.deadline;
                        if (dl?.toDate) dl = dl.toDate();
                        if (dl instanceof Date) dl = dl.toISOString().split('T')[0];
                        if (typeof dl === 'string' && dl.includes('T')) dl = dl.split('T')[0];

                        return {
                            title: t?.title || '제목없음',
                            deadline: dl || null,
                            importance: t?.importance || '중',
                            difficulty: t?.difficulty || '중',
                            description: t?.description || '',
                            // relativeDay가 있으면 유지 (없어도 aiService에서 안전하게 처리)
                            ...(Number.isFinite(t?.relativeDay) ? { relativeDay: t.relativeDay } : {})
                        };
                    };

                    // 세션+글로벌을 합치되, 제목/마감일/중요도/난이도 키로 중복 제거
                    const merged = [...(sessionTasks||[]), ...(globalTasks||[])].map(normalize);
                    const dedupKey = (x)=>`${x.title}||${x.deadline}||${x.importance}||${x.difficulty}`;
                    const seen = new Set();
                    existingTasks = merged.filter(t => {
                        const k = dedupKey(t);
                        if (seen.has(k)) return false;
                        seen.add(k);
                        return true;
                    });
                    
                    console.log('[AI Controller] 병합된 할 일:', existingTasks.length, '개');
                } catch (error) {
                    console.warn('할 일 병합 조회 실패:', error.message);
                }
            }

            // AI 서비스 호출
            console.log('[AI Controller] AI 서비스로 전달할 할 일:', existingTasks.length, '개');
            console.log('[AI Controller] AI 서비스 호출 시작 - 메시지:', messageArray.length, '개, 생활패턴:', parsedLifestylePatterns.length, '개');
            
            const result = await aiService.generateSchedule(
                messageArray,
                parsedLifestylePatterns,
                existingTasks,
                { nowOverride, anchorDay }
            );
            
             try {
                   const today = nowOverride ? new Date(nowOverride) : new Date();
                   const deadlineMap = buildDeadlineDayMap(existingTasks, today);
                   if (Array.isArray(result?.schedule)) {
                     result.schedule = capScheduleByDeadlines(result.schedule, deadlineMap);
                   }
                } catch (capErr) {
                   console.warn('마감일 캡 적용 중 경고:', capErr?.message);
                }
                
                return res.json({ ok: true, ...result });
        } finally {
            inProgress.delete(dedupeKey);
        }
        } catch (error) {
            console.error('=== 스케줄 생성 컨트롤러 에러 ===');
            console.error('에러 타입:', error.constructor.name);
            console.error('에러 메시지:', error.message);
            console.error('에러 스택:', error.stack);
            console.error('요청 본문:', JSON.stringify(req.body, null, 2));
            
            // API 키 관련 에러인지 확인
            if (String(error.message).includes('OPENAI_API_KEY') || String(error.message).includes('API key')) {
                console.error('[AI] API 키 관련 에러 감지. 더미 스케줄로 폴백합니다.');
            }
            
            // ✅ 폴백: 여기서도 접근 가능한 외부 스코프 변수 사용
            try {
                const fbMessages = messageArray || (prompt ? [{ role: 'user', content: prompt }] : []);
                console.log('로컬 폴백 시도 - 메시지 배열:', fbMessages);
                console.log('로컬 폴백 시도 - 파싱된 라이프스타일 패턴(길이):', parsedLifestylePatterns?.length || 0);

                const localSchedule = aiService.generateDummySchedule(
                    parsedLifestylePatterns || [],
                    existingTasks || [],
                    { nowOverride, anchorDay }
                );
                console.log('로컬 스케줄 생성 성공:', localSchedule);

                return res.status(200).json({
                    ok: true,
                    message: 'AI 서비스 오류로 더미 스케줄을 생성했습니다.',
                    ...localSchedule
                });
            } catch (fallbackError) {
                console.error('로컬 폴백 실패:', fallbackError);
                console.error('폴백 에러 스택:', fallbackError.stack);
                return res.status(500).json({ ok: false, message: '스케줄 생성에 실패했습니다.' });
            } finally {
                inProgress.delete(dedupeKey);
            }
        }
    }

    // 생활패턴 저장 (userId 기준으로 통일)
    async saveLifestylePatterns(req, res) {
        try {
            const userId = req.params.userId || req.query.userId || req.headers['x-user-id'] || req.body.userId;
            const { patterns } = req.body;
            if (!userId || !Array.isArray(patterns)) {
                return res.status(400).json({ ok:false, message:'userId와 생활패턴 배열이 필요합니다.' });
            }
            const firestoreService = require('../services/firestoreService');
            await firestoreService.saveLifestylePatterns(userId, patterns);
            res.json({ ok:true, message:'생활패턴이 저장되었습니다.' });
        } catch (error) {
            console.error('생활패턴 저장 컨트롤러 에러:', error);
            res.status(500).json({ ok:false, message:'생활패턴 저장에 실패했습니다.' });
        }
    }

    // 할 일 생성 (users/{userId}/scheduleSessions/{sessionId}/tasks)
    async createTask(req, res) {
        try {
            const userId = req.params.userId || req.query.userId || req.headers['x-user-id'] || req.body.userId;
            const sessionId = req.params.sessionId || req.query.sessionId || req.body.sessionId;
            if (!userId || !sessionId) {
                return res.status(400).json({ ok:false, message:'userId와 sessionId가 필요합니다.' });
            }
            const taskData = req.body || {};
            const firestoreService = require('../services/firestoreService');
            const id = await firestoreService.saveSessionTask(userId, sessionId, taskData);
            res.json({ ok:true, taskId:id });
        } catch (error) {
            console.error('할 일 생성 에러:', error);
            res.status(500).json({ ok:false, message:'할 일 생성에 실패했습니다.' });
        }
    }

    // 로컬 스케줄 생성 (폴백) — 현재는 사용하지 않음. 필요 시 aiService.generateDummySchedule 사용.
    // generateLocalSchedule(messages, lifestylePatterns) { return []; }

    // 할 일 조회
    async getTasks(req, res) {
        try {
            const userId = req.params.userId || req.query.userId || req.headers['x-user-id'] || req.body.userId;
            const sessionId = req.params.sessionId || req.query.sessionId || req.body.sessionId;
            if (!userId || !sessionId) {
                return res.status(400).json({ ok:false, message:'userId와 sessionId가 필요합니다.' });
            }

            const firestoreService = require('../services/firestoreService');
            const tasks = await firestoreService.getSessionTasks(userId, sessionId);
            
            res.json({ 
                ok: true, 
                tasks 
            });
        } catch (error) {
            console.error('할 일 조회 컨트롤러 에러:', error);
            res.status(500).json({ 
                ok: false, 
                message: '할 일 조회에 실패했습니다.' 
                });
            }
        }
        
    // 할 일 삭제
    async deleteTask(req, res) {
        try {
            const userId = req.params.userId || req.query.userId || req.headers['x-user-id'] || req.body.userId;
            const sessionId = req.params.sessionId || req.query.sessionId || req.body.sessionId;
            const taskId = req.params.taskId;
            if (!userId || !sessionId || !taskId) {
                return res.status(400).json({ ok:false, message:'userId, sessionId, taskId가 필요합니다.' });
            }

            const firestoreService = require('../services/firestoreService');
            await firestoreService.deleteSessionTask(userId, sessionId, taskId);
            
            res.json({ 
                ok: true, 
                message: '할 일이 삭제되었습니다.' 
                });
        } catch (error) {
            console.error('할 일 삭제 에러:', error);
            res.status(500).json({ 
                ok: false, 
                message: '할 일 삭제에 실패했습니다.' 
            });
        }
    }

    // 할 일 활성화/비활성화 토글
    async toggleTaskStatus(req, res) {
        try {
            const userId = req.params.userId || req.query.userId || req.headers['x-user-id'] || req.body.userId;
            const sessionId = req.params.sessionId || req.query.sessionId || req.body.sessionId;
            const taskId = req.params.taskId;
            const { isActive } = req.body;
            if (!userId || !sessionId || !taskId || typeof isActive !== 'boolean') {
                return res.status(400).json({ ok:false, message:'userId, sessionId, taskId, isActive가 필요합니다.' });
            }

            const firestoreService = require('../services/firestoreService');
            await firestoreService.updateSessionTaskStatus(userId, sessionId, taskId, isActive);
            
            res.json({ 
                ok: true, 
                message: `할 일이 ${isActive ? '활성화' : '비활성화'}되었습니다.` 
            });
        } catch (error) {
            console.error('할 일 상태 변경 에러:', error);
            res.status(500).json({ 
                ok: false, 
                message: '할 일 상태 변경에 실패했습니다.' 
                                });
                            }
                        }

    // 음성 인식
    async transcribeAudio(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '오디오 파일이 필요합니다.' 
                });
            }

            const transcription = await aiService.transcribeAudio(req.file.buffer);
            
            res.json({ 
                ok: true, 
                text: transcription 
                });
            } catch (error) {
            console.error('음성 인식 컨트롤러 에러:', error);
            res.status(500).json({ 
                ok: false, 
                message: '음성 인식에 실패했습니다.',
                error: error.message 
            });
        }
    }

    // 대화형 피드백 분석
    async analyzeConversationalFeedback(req, res) {
        try {
            const { message, sessionId } = req.body;
            
            if (!message) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '메시지가 필요합니다.' 
                });
            }

            // AIService는 배열 형태를 기대 (userMessage, aiResponse 쌍들)
            const payload = Array.isArray(message)
                ? message
                : [{ userMessage: String(message), aiResponse: '', sessionId }];
            const analysis = await aiService.analyzeConversationalFeedback(payload);
            
            res.json({ 
                ok: true, 
                analysis 
            });
        } catch (error) {
            console.error('대화형 피드백 분석 컨트롤러 에러:', error);
            res.status(500).json({ 
                ok: false, 
                message: '피드백 분석에 실패했습니다.' 
            });
        }
    }

    // 피드백 저장
    async saveFeedback(req, res) {
        try {
            const { userId, sessionId, scheduleId, feedbackText, feedback, rating } = req.body;
            
            // 클라이언트에서 feedbackText 또는 feedback으로 보낼 수 있음
            const feedbackContent = feedbackText || feedback;
            
            if (!userId || !feedbackContent) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '사용자 ID와 피드백이 필요합니다.' 
                });
            }

            const firestoreService = require('../services/firestoreService');
            await firestoreService.saveFeedback(userId, feedbackContent, rating);
            
            res.json({ 
                ok: true, 
                message: '피드백이 저장되었습니다.' 
            });
        } catch (error) {
            console.error('피드백 저장 컨트롤러 에러:', error);
            res.status(500).json({ 
                ok: false, 
                message: '피드백 저장에 실패했습니다.' 
            });
        }
    }

    // AI 조언 조회
    async getAdvice(req, res) {
        try {
            const { userId, sessionId } = req.query;
            
            if (!userId) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '사용자 ID가 필요합니다.' 
                });
            }

            // Firestore에서 최근 AI 조언 조회
            const firestoreService = require('../services/firestoreService');
            const feedbacks = await firestoreService.getFeedbacks(userId);
            
            const latestAdvice = feedbacks
                .filter(f => f.type === 'ai_advice')
                .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))[0];
            
            if (latestAdvice) {
                res.json({ 
                    ok: true, 
                    advice: latestAdvice.advice,
                    generatedAt: latestAdvice.generatedAt,
                    timestamp: latestAdvice.generatedAt
                });
            } else {
                res.json({ 
                    ok: true, 
                    advice: [],
                    message: 'AI 조언이 없습니다.'
                });
            }
        } catch (error) {
            console.error('AI 조언 조회 컨트롤러 에러:', error);
            res.status(500).json({ 
                ok: false, 
                message: 'AI 조언 조회에 실패했습니다.' 
            });
        }
    }

    // AI 조언 생성
    async generateAdvice(req, res) {
        try {
            const { userData, activityAnalysis, goal = '' } = req.body;
            
            if (!userData) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '사용자 데이터가 필요합니다.' 
                });
            }

            const advice = await aiService.generateDailyAdvice(userData, activityAnalysis, goal);
            
            res.json({ 
                ok: true, 
                advice 
            });
        } catch (error) {
            console.error('AI 조언 생성 컨트롤러 에러:', error);
            res.status(500).json({ 
                ok: false, 
                message: 'AI 조언 생성에 실패했습니다.' 
            });
        }
    }

    // OpenAI 연결 진단
    async debugOpenAI(req, res) {
        try {
            const { status, data, message } = await aiService.debugOpenAIConnection();
            res.json({ ok: true, status, data, message });
        } catch (error) {
            const status = error.response?.status || 500;
            const data = error.response?.data;
            return res.status(500).json({ ok: false, status, data, message: error.message });
        }
    }

    // AI 원본 응답 조회 (디버깅용)
    async getLastAIResponse(req, res) {
        try {
            const fs = require('fs');
            const path = require('path');
            const debugPath = path.join(__dirname, '../debug-last-ai.json');
            
            if (!fs.existsSync(debugPath)) {
                return res.status(404).json({ 
                    ok: false, 
                    message: 'AI 응답 파일이 없습니다.' 
                });
            }
            
            const fileContent = fs.readFileSync(debugPath, 'utf-8');
            const data = JSON.parse(fileContent);
            
            res.json({ 
                ok: true, 
                data,
                timestamp: data.timestamp || new Date().toISOString()
            });
        } catch (error) {
            console.error('AI 응답 조회 실패:', error);
            res.status(500).json({ 
                ok: false, 
                message: 'AI 응답 조회에 실패했습니다.',
                error: error.message
            });
        }
    }

    // 로컬 폴백 스케줄 생성 메서드
    generateLocalSchedule(messages, lifestylePatterns) {
        try {
            console.log('로컬 스케줄 생성 시작');
            
            // 기본 스케줄 구조 생성
            const baseSchedule = [];
            const today = new Date();
            
            // 7일간의 기본 스케줄 생성
            for (let i = 1; i <= 7; i++) {
                const dayDate = new Date(today);
                dayDate.setDate(today.getDate() + i - 1);
                
                const weekdayNames = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
                const weekday = weekdayNames[dayDate.getDay() === 0 ? 6 : dayDate.getDay() - 1];
                
                const activities = [];
                
                // 생활패턴에서 해당 요일에 맞는 활동 추가
                if (lifestylePatterns && Array.isArray(lifestylePatterns)) {
                    lifestylePatterns.forEach(pattern => {
                        if (pattern && typeof pattern === 'object' && Array.isArray(pattern.days)) {
                            const isWeekday = i >= 1 && i <= 5;
                            const isWeekend = i >= 6 && i <= 7;
                            
                            // 요일 매칭
                            if (pattern.days.includes(i) || 
                                (isWeekday && pattern.days.includes(1)) || // 평일 패턴
                                (isWeekend && pattern.days.includes(6))) { // 주말 패턴
                                
                                activities.push({
                                    start: pattern.start || '09:00',
                                    end: pattern.end || '10:00',
                                    title: pattern.title || '활동',
                                    type: 'lifestyle'
                                });
                            }
                        }
                    });
                }
                
                // 기본 활동 추가 (활동이 없는 경우)
                if (activities.length === 0) {
                    activities.push({
                        start: '09:00',
                        end: '10:00',
                        title: '기본 활동',
                        type: 'lifestyle'
                    });
                }
                
                baseSchedule.push({
                    day: i,
                    weekday: weekday,
                    activities: activities
                });
            }
            
            return {
                schedule: baseSchedule,
                explanation: '로컬 폴백으로 생성된 기본 스케줄입니다.',
                activityAnalysis: {
                    work: 30,
                    study: 20,
                    exercise: 10,
                    reading: 10,
                    hobby: 15,
                    others: 15
                },
                notes: ['AI 서비스 오류로 인해 기본 스케줄을 생성했습니다.']
            };
            
        } catch (error) {
            console.error('로컬 스케줄 생성 실패:', error);
            return {
                schedule: [],
                explanation: '스케줄 생성에 실패했습니다.',
                activityAnalysis: {},
                notes: ['스케줄 생성 중 오류가 발생했습니다.']
            };
        }
    }
}

module.exports = new AIController();