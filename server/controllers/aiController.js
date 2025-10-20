const aiService = require('../services/aiService');
const utils = require('../utils/lifestyleParser');

class AIController {
    // 스케줄 생성
    async generateSchedule(req, res) {
        try {
            const { messages, prompt, promptContext, lifestylePatterns, sessionId, nowOverride, anchorDay } = req.body;
            
            // messages 배열이 없으면 prompt 또는 promptContext를 messages로 변환
            let messageArray = messages;
            if (!messageArray) {
                const contentToUse = promptContext || prompt;
                if (contentToUse) {
                    messageArray = [{ role: 'user', content: contentToUse }];
                }
            }
            
            if (!messageArray || !Array.isArray(messageArray)) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '메시지 배열 또는 프롬프트가 필요합니다.' 
                });
            }

            // 라이프스타일 패턴 파싱 (객체 배열과 문자열 모두 처리)
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
            }

            // 기존 할 일 가져오기
            let existingTasks = [];
            if (sessionId) {
                try {
                    const firestoreService = require('../services/firestoreService');
                    existingTasks = await firestoreService.getTasks(sessionId);
                } catch (error) {
                    console.warn('기존 할 일 조회 실패:', error.message);
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
                const { messages, prompt, lifestylePatterns, existingTasks } = req.body;
                const messageArray = messages || (prompt ? [{ role: 'user', content: prompt }] : []);
                console.log('로컬 폴백 시도 - 메시지 배열:', messageArray);
                console.log('로컬 폴백 시도 - 라이프스타일 패턴:', lifestylePatterns);
                
                // aiService의 더미 스케줄 생성 메서드 사용
                const localSchedule = aiService.generateDummySchedule(lifestylePatterns, existingTasks || [], {});
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

    // 로컬 스케줄 생성 (폴백)
    generateLocalSchedule(messages, lifestylePatterns) {
        const schedule = [];
        const now = new Date();
        
        // 라이프스타일 패턴에서 스케줄 생성
        if (lifestylePatterns && Array.isArray(lifestylePatterns)) {
            lifestylePatterns.forEach(pattern => {
                const parsed = utils.parseLifestylePattern(pattern);
                if (parsed) {
                    const startTime = `${parsed.start.toString().padStart(2, '0')}:00`;
                    const endTime = `${parsed.end.toString().padStart(2, '0')}:00`;
                    
                    schedule.push({
                        title: parsed.title,
                    start: startTime,
                    end: endTime,
                        type: 'lifestyle',
                        day: parsed.days[0] || 1,
                        isOvernight: parsed.isOvernight
                    });
                }
            });
        }

        // 사용자 메시지에서 작업 추출
        if (messages && Array.isArray(messages)) {
            messages.forEach(message => {
                if (message.role === 'user' && message.content) {
                    const tasks = utils.extractUserTasks(message.content);
                    tasks.forEach(task => {
                        const taskDate = new Date(task.date);
                        const dayOfWeek = taskDate.getDay() === 0 ? 7 : taskDate.getDay(); // 일요일을 7로 변환
                        
                schedule.push({
                            title: task.title,
                            start: '09:00',
                            end: '10:00',
                            type: 'task',
                            day: dayOfWeek,
                            date: task.date
                        });
                    });
                }
            });
        }

        return schedule;
    }

    // 할 일 조회
    async getTasks(req, res) {
        try {
            const { sessionId } = req.params;
            
            if (!sessionId) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '세션 ID가 필요합니다.' 
                });
            }

            const firestoreService = require('../services/firestoreService');
            const tasks = await firestoreService.getTasks(sessionId);
            
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
            const { sessionId, taskId } = req.params;
            
            if (!sessionId || !taskId) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '세션 ID와 할 일 ID가 필요합니다.' 
                });
            }

            const firestoreService = require('../services/firestoreService');
            await firestoreService.deleteTask(sessionId, taskId);
            
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
            const { sessionId, taskId } = req.params;
            const { isActive } = req.body;
            
            if (!sessionId || !taskId || typeof isActive !== 'boolean') {
                return res.status(400).json({ 
                    ok: false, 
                    message: '세션 ID, 할 일 ID, 활성화 상태가 필요합니다.' 
                });
            }

            const firestoreService = require('../services/firestoreService');
            await firestoreService.updateTaskStatus(sessionId, taskId, isActive);
            
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