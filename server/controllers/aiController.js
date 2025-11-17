// src/controllers/aiController.js
const aiService = require('../services/aiService');
const utils = require('../utils/lifestyleParser');
const { extractTaskTitle } = require('../utils/taskUtils');
const META_INFO_REGEX = /(중요도|난이도|priority|difficulty|중요\s*도|난이\s*도)/i;
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
        // 중복 요청 차단: sessionId가 있으면 userId+sessionId로, 없으면 userId만으로 차단
        const dedupeKey = sessionId 
            ? JSON.stringify({ userId, sessionId })
            : `user:${userId || 'anon'}`;
        
        // 중복 요청 차단 (sessionId 없을 때는 userId 기반으로 차단)
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
            lifestylePatternsOriginal: lifestylePatternsOriginalFromClient,
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
            // 원본 텍스트를 유지하면서 구조화된 데이터도 생성
            let lifestylePatternsOriginal = []; // 원본 텍스트 배열
            
            // 1) 클라이언트에서 전달된 원본 텍스트 우선 사용
            if (lifestylePatternsOriginalFromClient && Array.isArray(lifestylePatternsOriginalFromClient)) {
                lifestylePatternsOriginal = lifestylePatternsOriginalFromClient
                    .map(p => typeof p === 'string' ? p.trim() : null)
                    .filter(p => p && p.length > 0);
            }
            
            // 2) lifestylePatterns 배열에서 원본 텍스트 추출 시도
            if (lifestylePatternsOriginal.length === 0 && lifestylePatterns && Array.isArray(lifestylePatterns)) {
                lifestylePatternsOriginal = lifestylePatterns
                    .map(pattern => {
                        if (typeof pattern === 'string') {
                            return pattern.trim();
                        } else if (pattern && typeof pattern === 'object' && pattern.patternText) {
                            return pattern.patternText.trim();
                        }
                        return null;
                    })
                    .filter(p => p && p.length > 0);
            }
            
            // 3) 원본 텍스트가 없으면 lifestylePatterns 테이블에서 가져오기
            if (lifestylePatternsOriginal.length === 0 && userId) {
                try {
                    const firestoreService = require('../services/firestoreService');
                    const stored = await firestoreService.getLifestylePatterns(userId);
                    if (Array.isArray(stored) && stored.length > 0) {
                        lifestylePatternsOriginal = stored.filter(p => typeof p === 'string' && p.trim().length > 0);
                    }
                } catch (e) {
                    console.warn('생활패턴 원본 텍스트 로드 실패:', e.message);
                }
            }
            
            if (lifestylePatterns && Array.isArray(lifestylePatterns)) {
                
                // 구조화된 데이터 생성 (빈 시간 계산용)
                parsedLifestylePatterns = lifestylePatterns
                    .map(pattern => {
                        if (typeof pattern === 'string') {
                            return utils.parseLifestylePattern(pattern);
                        } else if (pattern && typeof pattern === 'object') {
                            // 이미 구조화된 경우 그대로 사용
                            if (pattern.days && pattern.start != null && pattern.end != null) {
                                return pattern;
                            }
                            // patternText가 있으면 파싱
                            if (pattern.patternText) {
                                return utils.parseLifestylePattern(pattern.patternText);
                            }
                        }
                        return null;
                    })
                    .filter(Boolean);
            } else if (typeof lifestylePatterns === 'string' && lifestylePatterns.trim()) {
                const patterns = lifestylePatterns
                    .split(/\r?\n|[;,]+/)
                    .map(s => s.trim())
                    .filter(Boolean);
                lifestylePatternsOriginal = patterns;
                parsedLifestylePatterns = patterns
                    .map(pattern => utils.parseLifestylePattern(pattern))
                    .filter(Boolean);
            } else if (userId) {
                // 클라이언트에서 lifestylePatterns를 전달하지 않은 경우에만 DB에서 가져오기
                try {
                    const firestoreService = require('../services/firestoreService');
                    
                    // lifestylePatterns 컬렉션에서 가져오기
                    const stored = await firestoreService.getLifestylePatterns(userId);
                    if (Array.isArray(stored) && stored.length > 0) {
                        lifestylePatternsOriginal = stored.filter(p => typeof p === 'string' && p.trim().length > 0);
                        parsedLifestylePatterns = stored
                            .map(p => {
                                if (typeof p === 'string') {
                                    return utils.parseLifestylePattern(p);
                                } else if (p && typeof p === 'object' && p.patternText) {
                                    lifestylePatternsOriginal.push(p.patternText);
                                    return utils.parseLifestylePattern(p.patternText);
                                }
                                return p;
                            })
                            .filter(Boolean);
                    }
                } catch (e) {
                    console.warn('생활패턴 기본 로드 실패:', e.message);
                }
            }

            // 기존 할 일 준비
            const shouldNormalizeTitle = (title = '') => {
                const trimmed = (title || '').trim();
                if (!trimmed) return true;
                if (trimmed.length > 40) return true;
                if (META_INFO_REGEX.test(trimmed)) return true;
                return /해야|해야\s*해|해야\s*함|만들어야|준비해야/.test(trimmed);
            };

            const normFromClient = t => {
                let dl = t?.deadline;
                if (dl?.toDate) dl = dl.toDate();
                const d = (dl instanceof Date) ? dl : (dl ? new Date(dl) : null);
                if (d && !Number.isNaN(d.getTime())) {
                  const off = d.getTimezoneOffset();
                  dl = new Date(d.getTime() - off*60000).toISOString().slice(0,10);
                } else {
                  dl = null;
                }
                
                // title 정제: 사용자 입력에서 핵심 명사구만 추출
                const rawTitle = t?.title || t?.description || '';
                const normalizedTitle = shouldNormalizeTitle(rawTitle)
                  ? extractTaskTitle(rawTitle)
                  : rawTitle.trim();
                
                return {
                    id: t?.id || null, // id 필드 유지 (마감일 캡핑 시 매칭용)
                    title: normalizedTitle,
                    deadline: dl || null,
                    deadlineTime: t?.deadlineTime || null,
                    startTime: t?.startTime || null, // deadlineTime 별칭
                    type: t?.type || 'task',
                    importance: t?.importance || '중',
                    difficulty: t?.difficulty || '중',
                    description: t?.description || '',
                    estimatedMinutes: t?.estimatedMinutes || t?.durationMin || null,
                    durationMin: t?.durationMin || t?.estimatedMinutes || null,
                    ...(Number.isFinite(t?.relativeDay) ? { relativeDay: t.relativeDay } : {})
                };
            };
            // 클라이언트에서 받은 할 일 정규화
            const clientTasks = existingTasks.map(normFromClient);
            
            // DB에서도 할 일 가져와서 병합 (클라이언트에서 일부만 보내도 DB 할 일 포함)
            let dbTasks = [];
            if (userId) {
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

                        // title 정제: DB에 저장된 title도 정제 (혹시 모를 잘못된 데이터 대비)
                        const rawTitle = t?.title || t?.description || '';
                        const normalizedTitle = shouldNormalizeTitle(rawTitle)
                          ? extractTaskTitle(rawTitle)
                          : rawTitle.trim();

                        return {
                            id: t?.id || null, // id 필드 유지 (마감일 캡핑 시 매칭용)
                            title: normalizedTitle,
                            deadline: dl || null,
                            deadlineTime: t?.deadlineTime || null,
                            startTime: t?.startTime || null, // deadlineTime 별칭
                            type: t?.type || 'task',
                            importance: t?.importance || '중',
                            difficulty: t?.difficulty || '중',
                            description: t?.description || '',
                            estimatedMinutes: t?.estimatedMinutes || t?.durationMin || null,
                            durationMin: t?.durationMin || t?.estimatedMinutes || null,
                            // relativeDay가 있으면 유지 (없어도 aiService에서 안전하게 처리)
                            ...(Number.isFinite(t?.relativeDay) ? { relativeDay: t.relativeDay } : {})
                        };
                    };

                    // 세션+글로벌을 합치기
                    dbTasks = [...(sessionTasks||[]), ...(globalTasks||[])].map(normalize);
                } catch (error) {
                    console.warn('할 일 병합 조회 실패:', error.message);
                }
            }
            
            // 클라이언트 할 일 + DB 할 일 병합 및 중복 제거
            const allTasks = [...clientTasks, ...dbTasks];
            const dedupKey = (x) => {
                // id가 있으면 id로, 없으면 제목/마감일/중요도/난이도로 중복 판단
                if (x.id) return `id:${x.id}`;
                return `${x.title}||${x.deadline}||${x.importance}||${x.difficulty}`;
            };
            const seen = new Set();
            existingTasks = allTasks.filter(t => {
                const k = dedupKey(t);
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
            });

            // 피드백 조회 및 반영
            let userFeedback = '';
            let feedbackMessages = [];
            if (userId) {
                try {
                    const firestoreService = require('../services/firestoreService');
                    // 피드백 제한 없이 모두 가져오기 (type 필터 제거하여 모든 피드백 포함)
                    const feedbacks = await firestoreService.getFeedbacks(userId, { limit: 100 });
                    if (Array.isArray(feedbacks) && feedbacks.length > 0) {
                        feedbackMessages = feedbacks
                            .map(f => f.userMessage || f.feedbackText || f.feedback || '')
                            .filter(Boolean);
                        
                        if (feedbackMessages.length > 0) {
                            userFeedback = `\n\n**⚠️ 매우 중요 - 사용자 피드백/선호도 (최우선 반영):**\n${feedbackMessages.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\n⚠️ **위 피드백을 최우선으로 반영하여 스케줄을 설계하세요. 피드백과 일반 규칙이 충돌하면 피드백을 우선하세요.**`;
                        }
                    }
                } catch (e) {
                    console.warn('[AI Controller] 피드백 조회 실패:', e.message);
                }
            }
            
            // opts 객체 초기화 (userFeedback 정의 후)
            const opts = {
                nowOverride,
                anchorDay,
                userFeedback: userFeedback || ''
            };
            
            // 원본 텍스트를 opts에 추가하여 aiService로 전달
            if (lifestylePatternsOriginal.length > 0) {
                opts.lifestylePatternsOriginal = lifestylePatternsOriginal;
            }
            
            // AI 서비스 호출
            const result = await aiService.generateSchedule(
                messageArray,
                parsedLifestylePatterns,
                existingTasks,
                opts
            );
            
             try {
                   // 마감일 캡핑 기준 날짜: anchorDay가 있으면 그 기준으로, 없으면 nowOverride 또는 오늘
                   const baseDate = anchorDay ? (() => {
                       // anchorDay는 상대 day (1~7)이므로, 실제 날짜로 변환 필요
                       // aiService에서 anchorDay를 기준으로 day를 계산하므로, 여기서도 동일한 기준 사용
                       const today = nowOverride ? new Date(nowOverride) : new Date();
                       const todayDayOfWeek = today.getDay(); // 0=일, 1=월, ..., 6=토
                       const todayRelDay = todayDayOfWeek === 0 ? 7 : todayDayOfWeek; // 1=월, ..., 7=일
                       const diff = anchorDay - todayRelDay;
                       const base = new Date(today);
                       base.setDate(base.getDate() + diff);
                       return base;
                   })() : (nowOverride ? new Date(nowOverride) : new Date());
                   
                   const deadlineMap = buildDeadlineDayMap(existingTasks, baseDate);
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
            const statusCode = error.statusCode || error.response?.status || 500;
            const openAIError = error.openAIError || error.response?.data?.error;
            
            console.error('=== 스케줄 생성 컨트롤러 에러 ===');
            console.error('에러 타입:', error.constructor.name);
            console.error('에러 메시지:', error.message);
            console.error('HTTP 상태코드:', statusCode);
            if (openAIError) {
                console.error('OpenAI 에러 타입:', openAIError.type);
                console.error('OpenAI 에러 코드:', openAIError.code);
                console.error('OpenAI 에러 메시지:', openAIError.message);
            }
            console.error('에러 스택:', error.stack);
            console.error('요청 본문:', JSON.stringify(req.body, null, 2));
            
            // 429, 5xx는 상태코드 그대로 전달 (재시도 가능)
            if ([429, 500, 502, 503, 504].includes(statusCode)) {
                return res.status(statusCode).json({
                    ok: false,
                    code: statusCode,
                    message: openAIError?.message || error.message || '스케줄 생성에 실패했습니다.',
                    error: openAIError
                });
            }
            
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
                return res.status(statusCode).json({
                    ok: false,
                    code: statusCode,
                    message: error.message || '스케줄 생성에 실패했습니다.'
                });
            } finally {
                inProgress.delete(dedupeKey);
            }
        }
    }

    // GPT-4o 이미지 처리 (OCR/정보 추출)
    async processImage(req, res) {
        try {
            const { image, prompt } = req.body || {};
            if (!image) {
                return res.status(400).json({ ok: false, message: 'image(Base64 또는 URL)가 필요합니다.' });
            }

            const text = await aiService.processImage(image, prompt);
            return res.json({ ok: true, text });
        } catch (error) {
            console.error('이미지 처리 컨트롤러 에러:', error);
            return res.status(500).json({ ok: false, message: '이미지 처리에 실패했습니다.' });
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
            const { message, sessionId, userId } = req.body;
            
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
            
            // 분석 결과를 피드백으로 저장하여 스케줄 생성 시 반영되도록
            if (userId && analysis) {
                try {
                    const firestoreService = require('../services/firestoreService');
                    // 분석 결과에서 요약 또는 추천사항을 피드백으로 저장
                    const feedbackText = analysis.analysis || 
                                        (analysis.recommendations && analysis.recommendations.length > 0 
                                            ? analysis.recommendations.map(r => r.description || r.title).join('\n')
                                            : JSON.stringify(analysis));
                    
                    await firestoreService.saveFeedback(
                        userId,
                        feedbackText,
                        null,
                        { 
                            type: 'feedback', 
                            source: 'conversation', 
                            sessionId: sessionId || null 
                        }
                    );
                    console.log('[AI Controller] 대화형 피드백 분석 결과를 피드백으로 저장 완료');
                } catch (saveError) {
                    console.warn('[AI Controller] 대화형 피드백 저장 실패 (분석 결과는 반환됨):', saveError.message);
                }
            }
            
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
            const { userId, sessionId, scheduleId, feedbackText, feedback, rating, type } = req.body;
            
            // 클라이언트에서 feedbackText 또는 feedback으로 보낼 수 있음
            const feedbackContent = feedbackText || feedback;
            
            if (!userId || !feedbackContent) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '사용자 ID와 피드백이 필요합니다.' 
                });
            }

            const firestoreService = require('../services/firestoreService');
            
            // 메타데이터 구성 (type 기본값을 'feedback'으로 변경하여 스케줄 생성 시 반영되도록)
            const metadata = {
                type: type || 'feedback',
                scheduleId: scheduleId || null,
                sessionId: sessionId || null,
                userAgent: req.headers['user-agent'] || null,
                source: 'manual'
            };
            
            const feedbackId = await firestoreService.saveFeedback(userId, feedbackContent, rating, metadata);
            
            res.json({ 
                ok: true,
                success: true,
                feedbackId: feedbackId,
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

}

module.exports = new AIController();