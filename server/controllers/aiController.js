const aiService = require('../services/aiService');
const utils = require('../utils/lifestyleParser');

class AIController {
    // 스케줄 생성
    async generateSchedule(req, res) {
        // ✅ try 밖으로 '입력 값/중간 산출물' 전부 끌어올려 스코프 보존
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

            // 메시지 필터링 (빈/공백 메시지 제거)
            messageArray = (messageArray || []).filter(
                m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0
            );

            // 서버측 날짜 전처리: 한국어 상대 날짜를 (day:X)로 주입 (user 메시지만)
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

            // 사용자 메시지에서 새 할 일 추출 및 저장
            if (userId && sessionId) {
                try {
                    // 모든 user 메시지 + prompt + promptContext를 합쳐서 추출
                    const allUserContent = [
                        ...messageArray.filter(m => m.role === 'user').map(m => m.content),
                        prompt || '',
                        promptContext || ''
                    ].filter(Boolean).join('\n');
                    
                    // 간단한 키워드 기반 추출 (시연용)
                    const extractedTasks = [];
                    
                    if (allUserContent.includes('오픽') || allUserContent.includes('시험')) {
                        const today = new Date();
                        const nextWed = new Date(today);
                        const daysUntilWed = (3 - today.getDay() + 7) % 7;
                        nextWed.setDate(today.getDate() + daysUntilWed + 7);
                        
                        extractedTasks.push({
                            title: '오픽 시험',
                            date: nextWed.toISOString().split('T')[0],
                            dayOffset: daysUntilWed + 7,
                            importance: '상',
                            difficulty: '상',
                            description: '오픽 시험 준비'
                        });
                    }
                    
                    if (allUserContent.includes('클라이언트') || allUserContent.includes('시안')) {
                        const today = new Date();
                        const thisFri = new Date(today);
                        const daysUntilFri = (5 - today.getDay() + 7) % 7;
                        thisFri.setDate(today.getDate() + daysUntilFri);
                        
                        extractedTasks.push({
                            title: '클라이언트 A 시안 제출',
                            date: thisFri.toISOString().split('T')[0],
                            dayOffset: daysUntilFri,
                            importance: '상',
                            difficulty: '중',
                            description: '클라이언트 시안 제출'
                        });
                    }
                    
                    if (allUserContent.includes('포트폴리오')) {
                        const today = new Date();
                        const nextMon = new Date(today);
                        const daysUntilMon = (1 - today.getDay() + 7) % 7;
                        nextMon.setDate(today.getDate() + daysUntilMon + 7);
                        
                        extractedTasks.push({
                            title: '포트폴리오 최종 수정',
                            date: nextMon.toISOString().split('T')[0],
                            dayOffset: daysUntilMon + 7,
                            importance: '중',
                            difficulty: '중',
                            description: '포트폴리오 수정'
                        });
                    }
                    
                    // 할 일 추출 완료
                    
                    // 할 일은 클라이언트에서 처리하도록 변경
                } catch (error) {
                    console.warn('할 일 추출/저장 실패:', error.message);
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
            
            console.log('[AI Controller] AI 서비스 응답 받음:', {
                hasSchedule: !!result.schedule,
                scheduleLength: result.schedule?.length || 0,
                explanation: result.explanation?.substring(0, 100) + '...'
            });
            
            // 서비스에서 반환한 모든 필드를 그대로 전달 (__debug 포함)
            res.json({ 
                ok: true, 
                ...result
            });
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
            const { userData, activityAnalysis } = req.body;
            
            if (!userData) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '사용자 데이터가 필요합니다.' 
                });
            }

            const advice = await aiService.generateDailyAdvice(userData, activityAnalysis);
            
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