const aiService = require('../services/aiService');
const utils = require('../utils/lifestyleParser');

class AIController {
    // 스케줄 생성
    async generateSchedule(req, res) {
        try {
            const { messages, prompt, promptContext, lifestylePatterns, sessionId, nowOverride, anchorDay } = req.body;
            const userId = req.params?.userId || req.query?.userId || req.headers['x-user-id'] || req.body?.userId;
            
            console.log('[generateSchedule] userId:', userId, 'sessionId:', sessionId);
            
            // messages 배열이 없으면 prompt 또는 promptContext를 messages로 변환
            let messageArray = messages;
            if (!messageArray) {
                const contentToUse = promptContext || prompt;
                if (contentToUse) {
                    messageArray = [{ role: 'user', content: contentToUse }];
                }
            } else if (prompt && !messageArray.some(m => m.role === 'user' && m.content === prompt)) {
                // messages가 있지만 prompt가 포함되지 않은 경우, prompt를 마지막 user 메시지로 추가
                messageArray = [...messageArray, { role: 'user', content: prompt }];
            }

            // 서버측 날짜 전처리: 한국어 상대 날짜를 (day:X)로 주입
            try {
                const { preprocessMessageForDays } = require('../utils/dateParser');
                const baseNow = nowOverride ? new Date(nowOverride) : new Date();
                messageArray = messageArray.map(m => (
                    m && m.role && m.content
                        ? { ...m, content: preprocessMessageForDays(m.content, baseNow) }
                        : m
                ));
            } catch (e) {
                console.warn('서버 날짜 전처리 실패:', e.message);
            }
            
            if (!messageArray || !Array.isArray(messageArray)) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '메시지 배열 또는 프롬프트가 필요합니다.' 
                });
            }

            if (!userId || !sessionId) {
                console.warn('[generateSchedule] Missing userId/sessionId → tasks will NOT be saved to DB.');
            }

            // 라이프스타일 패턴 파싱 (객체 배열과 문자열 모두 처리) + Firestore 기본 로드
            let parsedLifestylePatterns = [];
            if (lifestylePatterns && Array.isArray(lifestylePatterns)) {
                parsedLifestylePatterns = lifestylePatterns
                    .map(pattern => {
                        // 이미 객체인 경우 그대로 사용
                        if (typeof pattern === 'object' && pattern !== null) {
                            return pattern;
                        }
                        // 문자열인 경우 파싱
                        if (typeof pattern === 'string') {
                            return utils.parseLifestylePattern(pattern);
                        }
            return null;
                    })
                    .filter(pattern => pattern !== null);
            } else if (typeof lifestylePatterns === 'string' && lifestylePatterns.trim()) {
                // 문자열로 전달된 경우 개별 패턴으로 분리
                const patterns = lifestylePatterns.split(/\s+(?=\w)/).filter(p => p.trim());
                parsedLifestylePatterns = patterns
                    .map(pattern => utils.parseLifestylePattern(pattern))
                    .filter(pattern => pattern !== null);
            } else if (userId) {
                // 요청에 패턴이 없으면 Firestore에서 불러오기
                try {
                    const firestoreService = require('../services/firestoreService');
                    const stored = await firestoreService.getLifestylePatterns(userId);
                    if (Array.isArray(stored)) {
                        parsedLifestylePatterns = stored
                            .map(p => typeof p === 'string' ? utils.parseLifestylePattern(p) : p)
                            .filter(Boolean);
                    }
                } catch (e) {
                    console.warn('생활패턴 기본 로드 실패:', e.message);
                }
            }

            // 기존 할 일 가져오기
            let existingTasks = [];
            if (userId && sessionId) {
                try {
                    const firestoreService = require('../services/firestoreService');
                    existingTasks = await firestoreService.getSessionTasks(userId, sessionId);
                } catch (error) {
                    console.warn('기존 할 일 조회 실패:', error.message);
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
                    
                    console.log('[AI Controller] 추출된 할 일:', extractedTasks);
                    console.log('[AI Controller] 추출 대상 텍스트:', allUserContent);
                    
                    if (extractedTasks.length > 0) {
                        const firestoreService = require('../services/firestoreService');
                        for (const task of extractedTasks) {
                            // relativeDay 계산 (anchorDay 기준)
                            const baseDay = anchorDay || 1;
                            const relativeDay = task.dayOffset ? baseDay + task.dayOffset - 1 : baseDay;
                            
                            const taskData = {
                                title: task.title,
                                deadline: task.date,
                                importance: task.importance || '중',
                                difficulty: task.difficulty || '중',
                                description: task.description || '',
                                relativeDay: relativeDay,
                                estimatedMinutes: 60
                            };
                            
                            await firestoreService.saveSessionTask(userId, sessionId, taskData);
                            console.log(`[AI Controller] 새 할 일 저장 완료: ${task.title}`);
                            console.log('[AI Controller] 저장 경로 확인:',
                                `users/${userId}/scheduleSessions/${sessionId}/tasks (management tab path must match!)`);
                        }
                        
                        // 새로 저장된 할 일들을 existingTasks에 추가
                        const newTasks = extractedTasks.map(task => ({
                            title: task.title,
                            deadline: task.date,
                            importance: task.importance || '중',
                            difficulty: task.difficulty || '중',
                            description: task.description || '',
                            relativeDay: task.dayOffset ? (anchorDay || 1) + task.dayOffset - 1 : (anchorDay || 1),
                            estimatedMinutes: 60
                        }));
                        existingTasks = [...existingTasks, ...newTasks];
                    }
                } catch (error) {
                    console.warn('할 일 추출/저장 실패:', error.message);
                }
            }

            // AI 서비스로 스케줄 생성 요청 (기존 할 일 포함)
            const opts = { nowOverride, anchorDay };
            const result = await aiService.generateSchedule(messageArray, parsedLifestylePatterns, existingTasks, opts);
            
            // 서비스에서 반환한 모든 필드를 그대로 전달 (__debug 포함)
            res.json({ 
                ok: true, 
                ...result
            });
        } catch (error) {
            console.error('스케줄 생성 컨트롤러 에러:', error);
            console.error('에러 스택:', error.stack);
            console.error('요청 본문:', JSON.stringify(req.body, null, 2));
            
            // 로컬 폴백 (안전화)
            try {
                const { messages, prompt, existingTasks } = req.body;
                const messageArray = messages || (prompt ? [{ role: 'user', content: prompt }] : []);
                console.log('로컬 폴백 시도 - 메시지 배열:', messageArray);
                console.log('로컬 폴백 시도 - 파싱된 라이프스타일 패턴:', parsedLifestylePatterns);
                
                // aiService의 더미 스케줄 생성 메서드 사용 (파싱된 패턴 사용)
                const localSchedule = aiService.generateDummySchedule(parsedLifestylePatterns, existingTasks || [], { nowOverride, anchorDay });
                console.log('로컬 스케줄 생성 성공:', localSchedule);
                
                return res.status(200).json({ 
                    ok: true, 
                    message: 'AI 서비스 오류로 더미 스케줄을 생성했습니다.',
                    ...localSchedule
                });
            } catch (fallbackError) {
                console.error('로컬 폴백 실패:', fallbackError);
                console.error('폴백 에러 스택:', fallbackError.stack);
                res.status(500).json({ 
                    ok: false, 
                    message: '스케줄 생성에 실패했습니다.' 
                });
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

            const analysis = await aiService.analyzeConversationalFeedback(message, sessionId);
            
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
            const { sessionId, scheduleId, feedbackText, feedback, rating } = req.body;
            
            // 클라이언트에서 feedbackText 또는 feedback으로 보낼 수 있음
            const feedbackContent = feedbackText || feedback;
            
            if (!sessionId || !feedbackContent) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '세션 ID와 피드백이 필요합니다.' 
                });
            }

            const firestoreService = require('../services/firestoreService');
            await firestoreService.saveFeedback(sessionId, feedbackContent, rating);
            
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