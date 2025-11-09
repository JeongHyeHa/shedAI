const axios = require('axios');
const https = require('https');
const { normalizeHHMM, timeToMinutes, minutesToTime, mapDayToWeekday, relDayToWeekdayNumber, extractAllowedDays } = require('../utils/scheduleUtils');
const { convertLifestyleToBusy, parseLifestyleString } = require('../utils/lifestyleUtils');
const { calculateFreeWindows, splitLargeFreeWindows } = require('../utils/freeWindowsUtils');

class AIService {
    constructor() {
        this.openaiApiKey = process.env.OPENAI_API_KEY;
        this.httpsAgent = new https.Agent({ keepAlive: true });
        this.axiosOpts = {
            timeout: 180000,                      // 180초
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            httpsAgent: this.httpsAgent,
            validateStatus: (status) => status >= 200 && status < 300
        };
    }

    // 공통 재시도 유틸 (타임아웃/ECONNRESET/ENOTFOUND)
    async callWithRetry(fn, tries = 2) {
        let delay = 1000;
        for (let i = 0; i <= tries; i++) {
            try {
                return await fn();
            } catch (e) {
                const retriable = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(e.code) ||
                                  String(e.message || '').includes('timeout');
                if (!retriable || i === tries) throw e;
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
            }
        }
    }

    // 스케줄 생성 (AI가 scheduleData를 직접 생성)
    async generateSchedule(messages, lifestylePatterns = [], existingTasks = [], opts = {}) {
        try {
            // API 키 검증 - 개발 모드에서는 더미 데이터 반환
            if (!this.openaiApiKey) {
                console.log('[개발 모드] OpenAI API 키가 없어서 더미 스케줄을 생성합니다.');
                return this.generateDummySchedule(lifestylePatterns, existingTasks, opts);
            }
            
            // AI 서비스 스케줄 생성 시작
            
            // 현재 날짜 정보 생성 (오버라이드 지원)
            const now = opts.nowOverride ? new Date(opts.nowOverride) : new Date();
            const baseDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
            
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const date = now.getDate();
            const dayOfWeek = now.getDay(); // 0=일요일, 1=월요일, ..., 6=토요일
            const koreanDays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
            const currentDayName = koreanDays[dayOfWeek];
            
            // 현재 날짜 정보
            const baseRelDay = (dayOfWeek === 0 ? 7 : dayOfWeek); // 오늘의 상대 day (예: 일=7)
            
            // 허용 day 집합 추출 (오늘/내일/특정일)
            const rawUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
            const forcedToday = /(오늘|금일)(까지)?/.test(rawUser);
            const forcedTomorrow = /(내일|익일|명일)(까지)?/.test(rawUser);
            const hasSpecificDate = /\(day:\d+\)/.test(rawUser);
            const hasDeadline =
                /마감일.*day:\d+/.test(rawUser) ||
                /(\d+월\s*\d+일|다음주|이번주)/.test(rawUser) ||
                /(\d+)\s*일\s*(내|이내|안에)/.test(rawUser) ||
                /(\d+)\s*주\s*(내|이내|안에)/.test(rawUser) ||
                /(\d+)\s*(일|주)\s*(후|뒤)/.test(rawUser);
            
            // 작업용 day와 생활패턴용 day 분리
            let taskDays = [];
            let lifestyleDays = [];
            let scheduleLength; // 스코프 밖에서 선언하여 모든 케이스에서 사용 가능
            
            if (forcedToday) {
                // "오늘까지" 작업: 작업은 오늘만, 생활패턴은 7일치
                taskDays = [baseRelDay];                  // 오늘만
                lifestyleDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);  // 14일 연속
                scheduleLength = 14;
            } else if (forcedTomorrow) {
                // "내일까지" 작업: 작업은 내일만, 생활패턴은 7일치
                taskDays = [baseRelDay + 1];              // 내일만
                lifestyleDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);
                scheduleLength = 14;
            } else if (hasSpecificDate) {
                // 특정 날짜 작업: 해당 날짜에만 작업, 생활패턴은 7일치
                const extractedDays = extractAllowedDays(messages);
                taskDays = extractedDays;
                lifestyleDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);
                scheduleLength = 14;
            } else if (hasDeadline) {
                // 마감일이 있는 작업: 오늘부터 마감일까지 연속된 스케줄 생성
                const extractedDays = extractAllowedDays(messages);
                if (extractedDays.length > 0) {
                    const maxDay = Math.max(...extractedDays);
                    taskDays = Array.from({ length: maxDay - baseRelDay + 1 }, (_, i) => baseRelDay + i);
                    scheduleLength = maxDay - baseRelDay + 1;
                } else {
                    // 상대 표현에서 기간 추출 (예: 3일 내, 2주 내, 3일 후)
                    let windowDays = 14;
                    const mDayWithin = rawUser.match(/(\d+)\s*일\s*(내|이내|안에)/);
                    const mWeekWithin = rawUser.match(/(\d+)\s*주\s*(내|이내|안에)/);
                    const mAfter = rawUser.match(/(\d+)\s*(일|주)\s*(후|뒤)/);
                    if (mDayWithin) {
                        const n = parseInt(mDayWithin[1], 10);
                        if (Number.isFinite(n) && n > 0) windowDays = Math.min(14, Math.max(1, n));
                    } else if (mWeekWithin) {
                        const n = parseInt(mWeekWithin[1], 10);
                        if (Number.isFinite(n) && n > 0) windowDays = Math.min(28, Math.max(7, n * 7));
                    } else if (mAfter) {
                        const n = parseInt(mAfter[1], 10);
                        const unit = mAfter[2];
                        if (unit === '주') {
                            const days = n * 7;
                            windowDays = Math.min(28, Math.max(1, days));
                        } else {
                            windowDays = Math.min(14, Math.max(1, n));
                        }
                    }
                    taskDays = Array.from({ length: windowDays }, (_, i) => baseRelDay + i);
                    scheduleLength = windowDays;
                }
                lifestyleDays = Array.from({ length: scheduleLength }, (_, i) => baseRelDay + i);
            } else {
                // 일반 작업: 오늘부터 14일간, 생활패턴은 14일치
                // 하지만 작업의 마감일이 14일을 넘으면 그만큼 범위 확장
                let maxDeadlineDay = baseRelDay + 13; // 기본 14일
                
                // 모든 작업의 deadline_day 확인하여 최대값 구하기
                // 1) existingTasks의 deadline 확인
                if (existingTasks && existingTasks.length > 0) {
                    for (const task of existingTasks) {
                    if (task.deadline) {
                            const deadlineDate = task.deadline instanceof Date ? task.deadline : new Date(task.deadline);
                            if (!isNaN(deadlineDate.getTime())) {
                                const deadlineMidnight = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate());
                        const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                                const diffTime = deadlineMidnight.getTime() - nowMidnight.getTime();
                                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                                const taskDeadlineDay = baseRelDay + diffDays;
                                
                                // deadline_day가 기본 범위를 넘으면 범위 확장
                                if (taskDeadlineDay > maxDeadlineDay) {
                                    maxDeadlineDay = taskDeadlineDay;
                                }
                            }
                        }
                    }
                }
                
                scheduleLength = Math.max(14, maxDeadlineDay - baseRelDay + 1); // 최소 14일, 최대 마감일까지
                taskDays = Array.from({ length: scheduleLength }, (_, i) => baseRelDay + i);
                lifestyleDays = Array.from({ length: scheduleLength }, (_, i) => baseRelDay + i);
            }
            
            let allowedDays = [...new Set([...taskDays, ...lifestyleDays])].sort((a,b)=>a-b);
            const anchorDay = opts.anchorDay ?? (allowedDays.length ? allowedDays[0] : (dayOfWeek===0?7:dayOfWeek));
            
            // 날짜 및 사용자 입력 분석 완료
            
            // === 새 아키텍처: busy 배열 생성 ===
            // lifestyle patterns를 busy로 변환 (고정 구간)
            let busy = convertLifestyleToBusy(lifestylePatterns, now, allowedDays);
            
            // 고정 일정 분리 기능 제거 - AI가 모든 작업을 자유롭게 배치하도록 함
            
            // tasks를 새 스키마로 변환 (taskId 추가) - 모든 task 포함 + 전략 주입
            const tasksById = {};
            
            // 마감일까지 일수 계산 헬퍼
            const daysUntil = (deadline) => {
                if (!deadline) return 999;
                const deadlineDate = deadline instanceof Date ? deadline : new Date(deadline);
                const diffTime = deadlineDate.getTime() - now.getTime();
                return Math.floor(diffTime / (1000 * 60 * 60 * 24));
            };
            
            // day별 deadline_day 계산 (DB의 deadline 문자열을 정확히 파싱)
            const getDeadlineDay = (deadline) => {
                if (!deadline) return 999;
                
                let deadlineDate = null;
                
                // 문자열인 경우 (예: "2025-11-10")
                if (typeof deadline === 'string') {
                    // YYYY-MM-DD 형식 파싱
                    const match = deadline.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
                    if (match) {
                        const year = parseInt(match[1], 10);
                        const month = parseInt(match[2], 10) - 1; // 0-based
                        const day = parseInt(match[3], 10);
                        deadlineDate = new Date(year, month, day, 0, 0, 0, 0);
                    } else {
                        // 다른 형식 시도
                        deadlineDate = new Date(deadline);
                    }
                } else if (deadline instanceof Date) {
                    deadlineDate = deadline;
                } else {
                    deadlineDate = new Date(deadline);
                }
                
                if (!deadlineDate || isNaN(deadlineDate.getTime())) return 999;
                
                // 자정 기준으로 날짜 차이 계산
                const deadlineMidnight = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate());
                const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const diffTime = deadlineMidnight.getTime() - nowMidnight.getTime();
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                return baseRelDay + diffDays;
            };
            
                const tasksForAI = (existingTasks || []).map((task, idx) => {
                const taskId = task.id || `t${idx + 1}`;
                tasksById[taskId] = task;
                
                // 전략 계산: 중요/난이도 高 + 임박 마감 + 집중 작업 여부
                const daysUntilDeadline = daysUntil(task.deadline);
                const urgent = daysUntilDeadline <= 3;  // D-3 이내
                const veryUrgent = daysUntilDeadline <= 2;  // D-2 이내
                const highPriority = task.importance === '상';
                const highDifficulty = task.difficulty === '상';
                const high = (highPriority || highDifficulty);
                
                // 집중해서 빠르게 끝낼 수 있는 작업 판단 (과제, 보고서, 발표 준비 등)
                const canFocusFinish = /(과제|보고서|프로젝트|발표|문서|자료|준비|작성|정리)/.test(task.title || '');
                
                // 블록 길이 결정:
                // 1) 매우 긴급 + 집중 작업: 180분 (3시간)
                // 2) 긴급 + 집중 작업: 150분 (2.5시간)
                // 3) 매우 긴급 + 고난이도: 150분
                // 4) 긴급 + 고난이도: 120분
                // 5) 나머지: 60분
                let minBlockMinutes = 60;
                if (veryUrgent && canFocusFinish) {
                    minBlockMinutes = 180; // 3시간
                } else if (urgent && canFocusFinish) {
                    minBlockMinutes = 150; // 2.5시간
                } else if (veryUrgent && high) {
                    minBlockMinutes = 150; // 2.5시간
                } else if (urgent && high) {
                    minBlockMinutes = 120; // 2시간
                } else if (high) {
                    minBlockMinutes = 90; // 1.5시간
                }
                
                // DB의 deadline을 직접 사용하여 deadline_day 계산
                let deadlineDay = getDeadlineDay(task.deadline);
                
                // deadlineTime이 있으면 deadline이 정확한지 재확인
                // DB에 저장된 deadline 문자열을 직접 사용
                if (task.deadlineTime && task.deadline) {
                    // deadline 문자열을 정확히 파싱하여 재계산
                    const recalculated = getDeadlineDay(task.deadline);
                    if (recalculated !== 999) {
                        deadlineDay = recalculated;
                    }
                }
                
                // 중요도와 난이도가 모두 상이면 매일 배치 필요
                const bothHigh = highPriority && highDifficulty;
                
                const taskForAI = {
                    id: taskId,
                    title: task.title,
                    deadline_day: deadlineDay,
                    deadlineTime: task.deadlineTime || null, // 특정 시간이 지정된 경우 (예: "오후 2시" → "14:00")
                    priority: highPriority ? '상' : (task.importance === '중' ? '중' : '하'),
                    difficulty: highDifficulty ? '상' : (task.difficulty === '중' ? '중' : '하'),
                    min_block_minutes: minBlockMinutes,
                    type: task.type || 'task', // type 정보 추가 (appointment인 경우 특별 처리)
                    // 긴급도 정보 추가 (AI가 우선순위 판단에 사용)
                    urgency_level: bothHigh ? '매우중요' : (veryUrgent ? '매우긴급' : (urgent ? '긴급' : '보통')),
                    days_until_deadline: daysUntilDeadline,
                    can_focus_finish: canFocusFinish,
                    // 매일 배치 필요 플래그 (중요도+난이도 모두 상이거나, 긴급한 경우)
                    require_daily: bothHigh || urgent || veryUrgent,
                    // 메타 정보 (검증용 - 서버에서만 사용)
                    _original: {
                        deadline: task.deadline,
                        deadline_day: deadlineDay,
                        importance: task.importance || '중',
                        difficulty: task.difficulty || '중',
                        daysUntil: daysUntilDeadline,
                        estimatedMinutes: task.estimatedMinutes || task.durationMin || 60
                    }
                };
                
                return taskForAI;
            });
            
            // tasksForAI 생성 후, deadline_day 최대값 확인하여 스케줄 범위 재확장
            if (tasksForAI && tasksForAI.length > 0) {
                let maxDeadlineDayFromTasks = baseRelDay + 13; // 기본 14일
                
                for (const task of tasksForAI) {
                    if (task.deadline_day && task.deadline_day !== 999) {
                        // deadline_day가 기본 범위를 넘으면 범위 확장
                        if (task.deadline_day > maxDeadlineDayFromTasks) {
                            maxDeadlineDayFromTasks = task.deadline_day;
                        }
                    }
                }
                
                // 스케줄 범위 재확장 (기존 범위보다 크면 확장)
                const requiredScheduleLength = maxDeadlineDayFromTasks - baseRelDay + 1;
                const newScheduleLength = Math.max(scheduleLength || 14, requiredScheduleLength);
                
                if (newScheduleLength > (scheduleLength || 14)) {
                    taskDays = Array.from({ length: newScheduleLength }, (_, i) => baseRelDay + i);
                    lifestyleDays = Array.from({ length: newScheduleLength }, (_, i) => baseRelDay + i);
                    scheduleLength = newScheduleLength; // scheduleLength 업데이트
                    // allowedDays도 재계산
                    allowedDays = [...new Set([...taskDays, ...lifestyleDays])].sort((a,b)=>a-b);
                    // busy도 재확장된 allowedDays를 기반으로 다시 생성
                    busy = convertLifestyleToBusy(lifestylePatterns, now, allowedDays);
                }
            }
            
            
            // 사용자 메시지만 최근 6개 유지
            let userMessages = (messages || []).filter(m => m && m.role === 'user').slice(-6);
            
            // === 새 아키텍처: 프롬프트 재작성 (간소화) ===
            // AI가 모든 작업을 자유롭게 배치하도록 함 (빈 시간 목록 제거)
            
            // AI에 넘길 tasks (간소화된 스키마)
            const tasksForAIJSON = tasksForAI.map(t => {
                const taskObj = {
                id: t.id,
                title: t.title,
                deadline_day: t.deadline_day,
                priority: t.priority,
                difficulty: t.difficulty,
                min_block_minutes: t.min_block_minutes,
                    type: t.type || 'task' // type 정보 추가 (appointment인 경우 특별 처리)
                };
                
                // deadline_time은 type이 "appointment"인 경우에만 포함
                // type이 "task"인 경우 deadline_time이 있어도 제거 (AI가 자유롭게 배치하도록)
                if (t.type === 'appointment' && t.deadlineTime) {
                    taskObj.deadline_time = t.deadlineTime;
                } else if (t.deadlineTime) {
                    // task인데 deadline_time이 있으면 제거 (날짜만 지정된 경우)
                    // taskObj.deadline_time = null; // 명시적으로 제거하지 않음 (null로 설정)
                }
                
                return taskObj;
            });
            

            // 생활 패턴 원본 텍스트 추출 - 원본 텍스트를 그대로 사용
            let lifestyleTextDisplay = '';
            let lifestyleTexts = [];
            
            // 1) opts에서 원본 텍스트 추출 (우선순위 1)
            if (opts.lifestylePatternsOriginal && Array.isArray(opts.lifestylePatternsOriginal)) {
                lifestyleTexts = opts.lifestylePatternsOriginal
                    .map(t => typeof t === 'string' ? t.trim() : null)
                    .filter(t => t && t.length > 0);
            }
            
            // 2) lifestylePatterns 배열에서 원본 텍스트 추출 (우선순위 2)
            if (lifestyleTexts.length === 0 && lifestylePatterns && Array.isArray(lifestylePatterns) && lifestylePatterns.length > 0) {
                lifestyleTexts = lifestylePatterns
                    .map(p => {
                        // 문자열이면 그대로 사용 (원본 텍스트)
                        if (typeof p === 'string') {
                            return p.trim();
                        }
                        // 객체인 경우 patternText 필드 확인 (원본 텍스트)
                        if (p && typeof p === 'object' && p.patternText) {
                            return p.patternText.trim();
                        }
                        // 원본 텍스트가 없으면 null 반환
                        return null;
                    })
                    .filter(t => t && t.length > 0);
            }
            
            // 3) userMessages에서 [생활 패턴] 섹션 추출 (fallback)
            if (lifestyleTexts.length === 0) {
                const allUserContent = userMessages.map(m => m.content || '').join('\n');
                const lifestyleSectionMatch = allUserContent.match(/\[생활 패턴\]([\s\S]*?)(?:\[할 일 목록\]|$)/i);
                if (lifestyleSectionMatch && lifestyleSectionMatch[1]) {
                    const extractedTexts = lifestyleSectionMatch[1]
                        .split('\n')
                        .map(t => t.trim())
                        .filter(t => t && t.length > 0 && !t.match(/^\[/))
                        .filter(t => t.length > 0);
                    lifestyleTexts = extractedTexts;
                }
            }
            
            // 4) 최종 텍스트 생성
            if (lifestyleTexts.length > 0) {
                lifestyleTextDisplay = `\n\n**사용자가 입력한 생활 패턴 (원본 텍스트):**\n${lifestyleTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n⚠️ **위 생활 패턴들은 반드시 type: "lifestyle"로 배치하고, 해당 요일마다 반복 배치해야 합니다.**`;
            }
            
            // 피드백을 프롬프트에 명확히 반영 (최우선)
            let feedbackSection = '';
            let detectedPatterns = [];
            let hasMorningPreferenceGlobal = false; // 전역 변수로 설정
            if (opts.userFeedback && opts.userFeedback.trim()) {
                const feedbackText = opts.userFeedback.trim();
                feedbackSection = `\n\n${feedbackText}`;
                
                // 피드백 내용 분석하여 추가 규칙 생성
                const feedbackLower = feedbackText.toLowerCase();
                
                // 1. 아침 시간대 선호도 감지
                const morningKeywords = ['아침', '오전', '아침형', '오전에', '오전 시간', '오전에 작업', '아침에 작업', '오전에 집중', '아침에 집중', '아침에 더'];
                const hasMorningPreference = morningKeywords.some(keyword => feedbackLower.includes(keyword));
                if (hasMorningPreference) {
                    hasMorningPreferenceGlobal = true;
                    detectedPatterns.push('아침 시간대 선호도');
                    feedbackSection += `\n\n**아침 시간대 선호도**:\n` +
                        `- 사용자가 아침/오전 시간대에 작업을 선호한다고 명시했습니다.\n` +
                        `- 오전 시간대(06:00~12:00)의 빈 시간을 우선 활용하세요. 단, 필요한 작업 시간이 오전 시간대만으로 부족하면 오후 시간대(17:00~19:00)에도 추가로 배치하세요.\n` +
                        `- 예: 하루에 3시간이 필요한 작업이면, 오전 2시간(06:00~08:00) + 오후 1시간(17:00~18:00)으로 배치하세요.\n` +
                        `- 평일에는 회사(08:00~17:00)가 있으므로, 회사 전(06:00~08:00) 시간대를 우선 활용하되, 추가 시간이 필요하면 회사 후(17:00~19:00) 시간대도 사용하세요.\n` +
                        `- 저녁 시간대(19:00 이후)에는 배치하지 마세요.`;
                }
                
                // 2. 저녁 시간대 선호도 감지
                const eveningKeywords = ['저녁', '저녁형', '저녁에', '밤에', '저녁 시간', '저녁에 작업', '밤에 작업', '저녁에 집중'];
                const hasEveningPreference = eveningKeywords.some(keyword => feedbackLower.includes(keyword));
                if (hasEveningPreference) {
                    detectedPatterns.push('저녁 시간대 선호도');
                    feedbackSection += `\n\n🚨🚨🚨 **저녁 시간대 선호도 (최우선 반영 필수 - 절대 위반 금지)**:\n` +
                        `- 사용자가 저녁/밤 시간대에 작업을 선호한다고 명시했습니다.\n` +
                        `- **모든 할 일(task)은 가능한 한 저녁 시간대(18:00~23:00)에 우선 배치하세요.**\n` +
                        `- 저녁 시간대가 부족하면 오후 시간대를 사용하되, **저녁 시간대를 최대한 활용**하세요.\n` +
                        `- 예: "오픽 시험 준비" 같은 중요한 작업은 **저녁 18:00~23:00 시간대에 우선 배치**하세요.\n` +
                        `- ⚠️ **절대 금지**: 할 일을 오전 시간대(12:00 이전)에만 배치하는 것은 피드백 위반입니다. 저녁 시간대를 우선 사용하세요.`;
                }
                
                // 3. 주말 업무 허용 감지
                const hasWeekendKeyword = feedbackLower.includes('주말');
                const hasWorkKeyword = feedbackLower.includes('업무') || feedbackLower.includes('일할') || 
                                      feedbackLower.includes('작업') || feedbackLower.includes('생성') ||
                                      feedbackLower.includes('배치');
                if (hasWeekendKeyword && hasWorkKeyword) {
                    // 주말 업무 금지 키워드 확인
                    const weekendDeny = feedbackLower.includes('안') || feedbackLower.includes('금지') ||
                                       feedbackLower.includes('하지') || feedbackLower.includes('싶지') ||
                                       feedbackLower.includes('원하지') || feedbackLower.includes('ㄴㄴ');
                    
                    if (weekendDeny) {
                        detectedPatterns.push('주말 업무 금지');
                        feedbackSection += `\n\n🚨🚨🚨 **주말 업무 금지 (최우선 반영 필수 - 절대 위반 금지)**:\n` +
                            `- 사용자가 주말에 업무/작업을 원하지 않는다고 명시했습니다.\n` +
                            `- **모든 할 일(task)은 주말(토요일 day:6, 일요일 day:7)에 절대 배치하지 마세요.**\n` +
                            `- 주말에는 생활 패턴(lifestyle)만 배치하고, 할 일(task)은 배치하지 마세요.\n` +
                            `- ⚠️ **절대 금지**: 주말에 할 일을 배치하는 것은 피드백 위반입니다. 주말에는 반드시 할 일을 배치하지 마세요.`;
                    } else {
                        detectedPatterns.push('주말 업무 허용');
                        feedbackSection += `\n\n🚨🚨🚨 **주말 업무 배치 (최우선 반영 필수 - 절대 위반 금지)**:\n` +
                            `- 사용자가 주말에도 업무/작업을 원한다고 명시했습니다.\n` +
                            `- **모든 할 일(task)은 주말(토요일 day:6, 일요일 day:7)에도 반드시 배치하세요.**\n` +
                            `- 특히 중요도가 높거나 난이도가 높은 할 일은 **주말에도 매일 배치**하세요.\n` +
                            `- 예: "오픽 시험 준비" (중요도: 상, 난이도: 상)는 **주말(day:6, day:7)에도 반드시 배치**하세요.\n` +
                            `- ⚠️ **절대 금지**: 주말에 할 일을 배치하지 않는 것은 피드백 위반입니다. 주말에도 반드시 배치하세요.\n` +
                            `- ⚠️ **검증 필수**: 생성 후 반드시 확인하세요. 주말(day:6, day:7)에 할 일이 배치되었는지 확인하고, 없으면 즉시 추가하세요.`;
                    }
                }
                
                // 4. 휴식 시간 선호도 감지
                const restTimeMatch = feedbackLower.match(/(?:쉬는|휴식|쉼|브레이크).*?(?:시간|분|30|60|1시간|30분)/);
                if (restTimeMatch || feedbackLower.includes('쉬는시간') || feedbackLower.includes('휴식시간')) {
                    let restMinutes = 30; // 기본값
                    if (feedbackLower.includes('30') || feedbackLower.includes('30분')) {
                        restMinutes = 30;
                    } else if (feedbackLower.includes('60') || feedbackLower.includes('1시간') || feedbackLower.includes('60분')) {
                        restMinutes = 60;
                    } else if (feedbackLower.includes('90') || feedbackLower.includes('1.5시간')) {
                        restMinutes = 90;
                    } else if (feedbackLower.includes('120') || feedbackLower.includes('2시간')) {
                        restMinutes = 120;
                    }
                    
                    feedbackSection += `\n\n⚠️⚠️⚠️ **휴식 시간 선호도 (최우선 반영 필수)**:\n` +
                        `- 사용자가 작업 간 휴식 시간을 ${restMinutes}분으로 선호한다고 명시했습니다.\n` +
                        `- **모든 작업 간에는 반드시 최소 ${restMinutes}분의 휴식 시간을 두세요.**\n` +
                        `- 예: 작업이 17:00에 끝나면 다음 작업은 ${restMinutes}분 후인 ${restMinutes === 30 ? '17:30' : restMinutes === 60 ? '18:00' : restMinutes === 90 ? '18:30' : '19:00'} 이후에 배치하세요.\n` +
                        `- ⚠️ **절대 금지**: 작업을 연속으로 배치하거나 휴식 시간이 ${restMinutes}분 미만인 것은 피드백 위반입니다. 반드시 ${restMinutes}분 이상의 휴식 시간을 두세요.`;
                }
                
                // 5. 특정 시간대 작업 금지 감지
                if (feedbackLower.includes('출근') && (feedbackLower.includes('바로') || feedbackLower.includes('다음')) &&
                    (feedbackLower.includes('일') || feedbackLower.includes('작업') || feedbackLower.includes('배치')) &&
                    (feedbackLower.includes('안') || feedbackLower.includes('금지') || feedbackLower.includes('ㄴㄴ'))) {
                    feedbackSection += `\n\n⚠️⚠️⚠️ **출근 직후 작업 금지 (최우선 반영 필수)**:\n` +
                        `- 사용자가 출근 직후(회사 시작 직후)에는 작업을 배치하지 않기를 원합니다.\n` +
                        `- **출근 시간(예: 08:00) 직후 1시간 동안(예: 08:00~09:00)에는 할 일(task)을 배치하지 마세요.**\n` +
                        `- 출근 직후 시간대는 생활 패턴(회사)만 배치하고, 할 일은 배치하지 마세요.\n` +
                        `- ⚠️ **절대 금지**: 출근 직후 시간대에 할 일을 배치하는 것은 피드백 위반입니다.`;
                }
                
                // 6. 점심 시간대 작업 금지 감지
                if ((feedbackLower.includes('점심') || feedbackLower.includes('식사')) &&
                    (feedbackLower.includes('안') || feedbackLower.includes('금지') || feedbackLower.includes('ㄴㄴ'))) {
                    feedbackSection += `\n\n⚠️⚠️⚠️ **점심 시간대 작업 금지 (최우선 반영 필수)**:\n` +
                        `- 사용자가 점심 시간대(12:00~14:00)에는 작업을 배치하지 않기를 원합니다.\n` +
                        `- **점심 시간대(12:00~14:00)에는 할 일(task)을 배치하지 마세요.**\n` +
                        `- 점심 시간대는 생활 패턴(식사)만 배치하고, 할 일은 배치하지 마세요.\n` +
                        `- ⚠️ **절대 금지**: 점심 시간대에 할 일을 배치하는 것은 피드백 위반입니다.`;
                }
                
                // 디버깅 로그
                if (detectedPatterns.length > 0) {
                    console.log('[🔍 피드백 패턴 감지]', detectedPatterns);
                } else {
                    console.log('[🔍 피드백 패턴 감지] 패턴 없음 - 원본 피드백만 사용');
                }
            }
            
            // 최종 스케줄 범위 계산
            const finalStartDay = baseRelDay;
            const finalEndDay = baseRelDay + scheduleLength - 1;
            
            
            // 빈 시간 감지 및 활용 가이드 생성
            let emptyTimeGuide = '';
            if (hasMorningPreferenceGlobal) {
                emptyTimeGuide = `\n\n**빈 시간 감지 및 활용 가이드**:\n` +
                    `1. 각 day의 빈 시간을 먼저 파악하세요:\n` +
                    `   - 생활 패턴을 배치한 후 남은 시간대를 확인하세요.\n` +
                    `   - 예: 평일(day:1~5)에는 회사(08:00~17:00)가 있으므로, 회사 전(06:00~08:00)과 회사 후(17:00~21:00) 시간대가 비어있습니다.\n` +
                    `   - 예: 주말(day:6, day:7)에는 자유시간(15:00~17:00)이 있으므로, 그 외 시간대가 비어있습니다.\n` +
                    `2. 빈 시간대에 할 일을 우선 배치하세요:\n` +
                    `   - 오전 시간대(06:00~12:00)의 빈 시간을 우선 활용하세요.\n` +
                    `   - 단, 필요한 작업 시간이 오전 시간대만으로 부족하면 오후 시간대(17:00~19:00)에도 추가로 배치하세요.\n` +
                    `   - 평일: 회사 전(06:00~08:00) 시간대를 우선 사용하되, 추가 시간이 필요하면 회사 후(17:00~19:00) 시간대도 사용하세요.\n` +
                    `   - 주말: 오전 전체(06:00~12:00) 시간대를 우선 사용하되, 필요한 만큼 오후 시간대도 활용하세요.`;
            }
            
            // 피드백 섹션을 최상단에 배치하고 강조
            const systemPrompt = {
                role: 'system',
                content: `${feedbackSection ? `🚨🚨🚨🚨🚨 **사용자 피드백 (최우선 반영 - 절대 위반 금지 - 반드시 읽고 준수하세요)**\n${feedbackSection}${emptyTimeGuide}\n\n⚠️⚠️⚠️⚠️⚠️ **위 피드백을 최우선으로 반영하여 스케줄을 설계하세요. 피드백과 일반 규칙이 충돌하면 피드백을 우선하세요. 피드백을 무시하면 생성 실패입니다.**\n\n` : ''}당신은 사용자의 생활 패턴과 할 일을 바탕으로 완전한 스케줄을 생성하는 전문가입니다.

**스케줄 생성 단계 (반드시 이 순서대로 진행하세요):**

**1단계: 생활 패턴 배치**
${lifestyleTextDisplay}
- 생활 패턴을 먼저 해당 요일, 해당 시간에 배치하세요.
- 생활 패턴은 type: "lifestyle"로 설정하세요.
- 생활 패턴은 생성 기간 내의 해당 요일마다 반복 배치하세요.

**2단계: 할 일 우선순위 계산**
- 각 할 일의 중요도(priority), 난이도(difficulty), 마감일(deadline_day)을 분석하세요.
- 아이젠하워 매트릭스 기법을 기반으로 우선순위를 정하세요:
  * 긴급하고 중요한 작업 (deadline_day가 가까움 + priority='상' + difficulty='상') → 최우선
  * 긴급하지만 덜 중요한 작업 → 두 번째 우선순위
  * 덜 긴급하지만 중요한 작업 → 세 번째 우선순위
  * 덜 긴급하고 덜 중요한 작업 → 네 번째 우선순위

**3단계: 빈 시간 찾기**
- 생활 패턴을 배치한 후, 각 day에서 남은 빈 시간을 명시적으로 계산하세요.
- 빈 시간 = 24시간 중 생활 패턴이 차지하지 않은 시간대
- 반드시 각 day별로 빈 시간 목록을 먼저 작성하세요:
  * 예: day:8 (월요일) - 생활 패턴: 회사(08:00~17:00), 취침(21:00~07:00)
    → 빈 시간: 07:00~08:00 (1시간), 17:00~21:00 (4시간)
  * 예: day:7 (일요일) - 생활 패턴: 브런치(12:00~13:00), 자유시간(15:00~17:00), 취침(21:00~07:00)
    → 빈 시간: 07:00~12:00 (5시간), 13:00~15:00 (2시간), 17:00~21:00 (4시간)
- 빈 시간을 찾지 않고 할 일을 배치하면 안 됩니다. 반드시 빈 시간을 먼저 계산하세요.
- 빈 시간 계산 결과는 반드시 notes에 포함해야 합니다.

**4단계: 할 일 배치 (피드백 반영 필수)**
${feedbackSection ? `- 사용자 피드백을 최우선으로 반영하세요. 피드백과 일반 규칙이 충돌하면 피드백을 우선하세요.` : ''}
- 반드시 3단계에서 계산한 빈 시간 목록을 확인하세요.
- 우선순위가 높은 할 일부터 빈 시간 목록에 배치하세요.
${hasMorningPreferenceGlobal ? `- 사용자가 아침형 선호를 명시했으므로, 빈 시간 중 오전 시간대(06:00~12:00)를 우선 선택하세요. 단, 필요한 작업 시간이 오전 시간대만으로 부족하면 오후 시간대(17:00~19:00)에도 추가로 배치하세요. 저녁 시간대(19:00 이후)의 빈 시간은 사용하지 마세요.` : ''}
- 할 일은 type: "task"로 설정하세요.
- 할 일끼리는 겹치지 않도록 배치하세요.
- deadline_time이 있는 작업은 반드시 deadline_day의 deadline_time에 배치하세요.
- 검증: 할 일을 배치한 후, 해당 시간대가 실제로 빈 시간이었는지 확인하세요.

**현재 날짜: ${year}년 ${month}월 ${date}일 (${currentDayName})**
**기준 day: ${anchorDay}**
**스케줄 생성 범위: day ${finalStartDay}부터 day ${finalEndDay}까지 (총 ${scheduleLength}일)**

⚠️⚠️⚠️ **절대 위반 금지 - 스케줄 범위 생성 (최우선 규칙)**: 
- **반드시 day ${finalStartDay}부터 day ${finalEndDay}까지 모든 day에 대해 스케줄을 생성하세요.**
- **기본 스케줄 길이는 14일(2주)이지만, 할 일의 마감일(deadline_day)이 더 길면 마감일을 기준으로 스케줄을 생성하세요.**
- **현재 스케줄 생성 범위는 day ${finalStartDay}~${finalEndDay} (총 ${scheduleLength}일)입니다.**
- **반드시 ${scheduleLength}개의 day 객체를 생성하세요: day ${finalStartDay}, day ${finalStartDay + 1}, day ${finalStartDay + 2}, ..., day ${finalEndDay}**
- **day ${finalEndDay}까지 생성하지 않고 중간에 멈추는 것은 절대 금지입니다.**
- **예: day ${finalStartDay}부터 day ${finalEndDay}까지 생성해야 하는데, day ${finalEndDay - 1}까지만 생성하는 것은 심각한 오류입니다.**
- **day ${finalEndDay}를 생성하지 않으면 생성 실패입니다. 반드시 다시 생성하세요.**
- **⚠️ 매우 중요: 마지막 day는 day ${finalEndDay}입니다. day ${finalEndDay}를 반드시 포함해야 합니다.**
- **⚠️⚠️⚠️ 절대 금지: day ${finalEndDay}를 생성하지 않고 day ${finalEndDay - 1}까지만 생성하는 것은 심각한 오류입니다. 반드시 day ${finalEndDay}까지 생성하세요.**
- **⚠️⚠️⚠️ 검증 필수: 생성 후 반드시 scheduleData 배열의 마지막 요소가 day ${finalEndDay}인지 확인하세요. day ${finalEndDay}가 없으면 생성 실패입니다.**
- **⚠️⚠️⚠️ 중요: deadline_day가 ${finalEndDay}인 작업이 있으면, 반드시 day ${finalEndDay}까지 스케줄을 생성해야 합니다. day ${finalEndDay - 1}까지만 생성하면 그 작업을 배치할 수 없습니다.**

**중요:**
- **생활 패턴은 생성 기간 내의 해당 요일에 반복 배치되어야 합니다.**
  * 예: "일요일 오후 12시~13시 브런치"는 생성 기간의 **모든 일요일(day:7)에 반복** 배치되어야 합니다.
  * 예: "매일 저녁 9시~아침 7시 취침"은 생성 기간의 **모든 요일(day:1~7)에 반복** 배치되어야 합니다.

**⚠️⚠️⚠️ 주말 정책 (매우 중요):**
- **사용자 피드백에 "주말에도 업무를 생성해줘" 또는 "주말에도 일할 거야"가 포함되어 있으면, 주말(토요일 day:6, 일요일 day:7)에도 할 일을 반드시 배치해야 합니다.**
- **주말 정책이 'allow'이거나 사용자 피드백에서 주말 업무를 허용하면, 주말에도 할 일을 배치할 수 있습니다.**
- **중요도가 높거나 난이도가 높은 할 일은 주말에도 배치할 수 있습니다.**
- **예: "오픽 시험 준비" (중요도: 상, 난이도: 상)는 주말에도 배치할 수 있습니다.**
- **⚠️ 매우 중요: 사용자 피드백이 주말 업무를 허용하면, 주말에도 할 일을 반드시 배치하세요. 주말에 할 일을 배치하지 않는 것은 심각한 오류입니다.**
  * 예: "평일 오전 8시~오후 5시 회사"는 생성 기간의 **모든 평일(day:1~5)에 반복** 배치되어야 합니다.
  * 예: "주말 22시~24시 자유시간"은 생성 기간의 **모든 주말(day:6, day:7)에 반복** 배치되어야 합니다.
- **생활 패턴은 반드시 type: "lifestyle"이어야 합니다. 절대로 type: "task"로 설정하지 마세요.**
- **할 일은 type: "task"이고 생활 패턴과 겹치지 않도록 배치하세요.**
- **생활 패턴 간 겹침 허용**: 생활 패턴끼리는 시간이 겹쳐도 됩니다. 예: "주말 22시~24시 자유시간"과 "매일 저녁 9시~아침 7시 취침"이 겹치더라도 둘 다 배치해야 합니다.
- **생활 패턴 누락 금지**: 사용자가 입력한 모든 생활 패턴은 반드시 배치되어야 합니다. 일부만 배치하고 나머지를 누락하는 것은 절대 금지입니다.
- **생활 패턴 검증**: 생성 후 반드시 확인하세요. 예를 들어 "일요일 오후 12시~13시 브런치"가 있으면 모든 일요일(day:7)에 type: "lifestyle"로 배치되었는지 확인하세요. "주말 22시~24시 자유시간"이 있으면 모든 주말(day:6, day:7)에 type: "lifestyle"로 배치되었는지 확인하세요.
- **절대 금지**: 사용자가 입력하지 않은 생활 패턴(식사, 브런치, 점심 등)을 자동으로 추가하지 마세요. 오직 사용자가 명시적으로 입력한 생활 패턴만 반복 배치하세요.

**요일 구분 (매우 중요):**
- **평일 (weekday)**: day:1 (월요일), day:2 (화요일), day:3 (수요일), day:4 (목요일), day:5 (금요일) **만**
- **주말 (weekend)**: day:6 (토요일), day:7 (일요일) **만**
- ⚠️ **절대 혼동 금지**: day:6은 **토요일**이고 **평일이 아닙니다**. "평일" 패턴은 day:1~5에만 배치하세요.
- ⚠️ **절대 혼동 금지**: day:7은 **일요일**이고 **평일이 아닙니다**. "평일" 패턴은 day:1~5에만 배치하세요.

**반드시 준수할 규칙:**
0) **생활 패턴 제한 (매우 중요)**: 사용자가 명시적으로 입력한 생활 패턴만 반복 배치하세요. 사용자가 입력하지 않은 활동(식사, 브런치, 점심, 저녁식사, 아침식사 등)을 자동으로 추가하지 마세요.
0-0) **생활 패턴 type 필드 (매우 중요)**: 
  * **생활 패턴은 반드시 type: "lifestyle"이어야 합니다.**
  * **할 일은 반드시 type: "task"이어야 합니다.**
  * **생활 패턴을 type: "task"로 설정하는 것은 절대 금지입니다.**
  * ⚠️ **생활 패턴 텍스트(예: "일요일 오후 12시~13시 브런치", "주말 22시~24시 자유시간")에서 파싱된 활동은 무조건 type: "lifestyle"입니다.**
  * 예: "일요일 오후 12시~13시 브런치" → { "start": "12:00", "end": "13:00", "title": "브런치", "type": "lifestyle" } (반드시 lifestyle!)
  * 예: "평일 오전 8시~오후 5시 회사" → { "start": "08:00", "end": "17:00", "title": "회사", "type": "lifestyle" } (반드시 lifestyle!)
  * 예: "주말 22시~24시 자유시간" → { "start": "22:00", "end": "00:00", "title": "자유시간", "type": "lifestyle" } (반드시 lifestyle!)
0-3) **생활 패턴 간 겹침 허용 (매우 중요)**: 
  * **생활 패턴끼리는 시간이 겹쳐도 됩니다. 모든 생활 패턴을 반드시 배치하세요.**
  * 예: "주말 22시~24시 자유시간"과 "매일 저녁 9시~아침 7시 취침"이 겹치더라도(22:00-00:00와 21:00-07:00) 둘 다 배치해야 합니다.
  * 예: "일요일 오후 12시~13시 브런치"와 "매일 저녁 9시~아침 7시 취침"이 겹치지 않더라도 둘 다 배치해야 합니다.
0-1) **평일/주말 구분 (매우 중요)**: "평일" 패턴은 **오직 day:1,2,3,4,5에만** 배치하세요. day:6(토요일)이나 day:7(일요일)에는 절대 배치하지 마세요. "주말" 패턴은 **오직 day:6,7에만** 배치하세요.
0-2) **생활 패턴 반복 배치 (매우 중요)**: 
  * **생활 패턴은 해당 요일마다 반복되어야 합니다. 한 번만 배치하는 것은 절대 금지입니다.**
  * 예: "일요일 오후 12시~13시 브런치" → 생성 기간의 **모든 일요일(day:7)에 반복** 배치
  * 예: "매일 저녁 9시~아침 7시 취침" → 생성 기간의 **모든 요일(day:1~7)에 반복** 배치
  * 예: "평일 오전 8시~오후 5시 회사" → 생성 기간의 **모든 평일(day:1~5)에 반복** 배치 
1) **할 일은** 생활 패턴과 겹치지 않도록 배치하세요. **생활 패턴은** 해당 요일에 반드시 배치하세요.
2) **마감일 엄수**: 각 작업은 반드시 deadline_day를 넘기지 마세요 (deadline_day보다 큰 day에 배치 절대 금지)
2-1) **특정 시간 지정 (매우 중요 - 절대 위반 금지)**: 
  * **deadline_time이 있는 작업만** 이 규칙을 적용하세요. deadline_time이 없는 작업은 이 규칙을 무시하고 자유롭게 배치하세요.
  * 작업에 deadline_time이 있으면(예: "14:00"), **반드시 deadline_day의 해당 시간에 배치**하세요.
  * 예: deadline_day=8, deadline_time="14:00"이면 → **반드시** day:8, start:"14:00"에 배치
  * deadline_time이 "14:00"이면 start는 **정확히 "14:00"**이어야 합니다. deadline_time을 무시하고 다른 시간에 배치하는 것은 **절대 금지**입니다.
  * deadline_time이 있으면 **반드시 deadline_day에만 배치**하고, 다른 day에 배치하는 것은 **절대 금지**입니다.
  * ⚠️ **중요**: deadline_time이 있는 작업을 deadline_day가 아닌 다른 day에 배치하거나, deadline_time이 아닌 다른 시간에 배치하면 **심각한 오류**입니다.
  * 예: { "title": "회의", "deadline_day": 8, "deadline_time": "14:00" } → **반드시** day:8, start:"14:00", end:"15:00" (또는 적절한 종료 시간)에 배치
  * ⚠️ **type: "appointment"인 작업 (최우선 처리)**: type이 "appointment"인 작업은 특정 날짜/시간에 고정된 일정입니다. deadline_day와 deadline_time을 **절대적으로 준수**해야 합니다. 다른 날짜나 시간에 배치하는 것은 **절대 금지**입니다.
  * ⚠️ **type: "task"인 작업**: type이 "task"인 작업은 deadline_time이 없으면 **자유롭게 배치**하세요. deadline_day 이전의 어떤 시간에든 배치할 수 있습니다.
  * ⚠️ **절대 금지 사항**: deadline_day=8, deadline_time="14:00"인 작업을 day 10에 배치하거나, 14:00가 아닌 다른 시간에 배치하는 것은 **심각한 오류**입니다. 반드시 day 8, 14:00에 배치하세요.
  * ⚠️ **검증 필수**: 생성 후 반드시 확인하세요. deadline_time이 있는 작업이 deadline_day가 아닌 다른 day에 배치되었는지, deadline_time이 아닌 다른 시간에 배치되었는지 확인하고, 잘못 배치되었다면 즉시 수정하세요.
3) **중요도+난이도 모두 상인 작업 (priority='상' AND difficulty='상')**: 반드시 **마감일까지 매일 매일(평일+주말 모두 포함) 배치**하세요. 예를 들어 "오픽 시험 준비"가 priority='상', difficulty='상'이면 deadline_day까지 **평일과 주말을 구분하지 말고 매일 배치**해야 합니다. 주말(토요일 day:6, 일요일 day:7)에도 빈 시간이 있으면 **반드시 배치**하세요. 하루도 빠뜨리지 마세요!
  * 🚨🚨🚨 **시간대 선호도 반영 (최우선 - 절대 위반 금지)**: 
    - 사용자 피드백에 아침/오전 시간대 선호가 있으면, 오전 시간대(06:00~12:00)의 빈 시간에 우선 배치하세요. 단, 필요한 작업 시간이 오전 시간대만으로 부족하면 오후 시간대(17:00~)에도 추가로 배치하세요. 
    - **사용자 피드백에 저녁 시간대 선호가 있으면, 반드시 저녁 시간대(18:00~23:00)의 빈 시간에 우선 배치하세요.**
    - **피드백이 없으면 빈 시간을 찾아 자유롭게 배치하세요.**
  * ⚠️ **중요**: deadline_day가 스케줄 생성 범위(day ${finalStartDay}~${finalEndDay})를 벗어나더라도, **스케줄 생성 범위 내에서 매일 배치**하세요. 예: deadline_day=24인 작업도 day ${finalStartDay}~${finalEndDay} 범위 내에서 매일 배치해야 합니다.
4) **우선순위 기반 배치**: 
   - **긴급 작업 (deadline_day <= ${finalStartDay + 3})**: 반드시 **매일 일정 시간 투자**하도록 배치하세요. 같은 작업을 여러 날에 걸쳐 매일 배치하여 마감일까지 꾸준히 진행하세요.
   - **매우 긴급 (deadline_day <= ${finalStartDay + 2})**: 당일부터 매일 배치, 하루 2시간 이상 배치
   - **긴급 (deadline_day <= ${finalStartDay + 4})**: 당일 또는 다음날부터 매일 배치, 하루 1시간 이상 배치
5) **중요도/난이도 상 작업**: (priority='상' 또는 difficulty='상')인 작업은 **마감일까지 여러 날에 걸쳐 충분히 배치**하세요. 특히 (priority='상' 또는 difficulty='상') **이고 동시에** (deadline_day<=${finalStartDay + 3}) 인 작업은 블록 길이를 **min_block_minutes(120분) 이상**으로 배치하고, **여러 날에 분산 배치**하세요.
  * ⚠️ **중요**: deadline_day가 스케줄 생성 범위(day ${finalStartDay}~${finalEndDay})를 벗어나더라도, **스케줄 생성 범위 내에서 매일 배치**하세요. deadline_day가 멀리 있어도 스케줄 생성 범위 내에서 매일 배치해야 합니다.
6) **마감일 임박 + 집중 작업**: 마감일이 얼마 안 남았고(deadline_day <= ${finalStartDay + 2}), 집중해서 빠르게 끝낼 수 있는 작업은 **긴 시간(2-3시간 블록)**을 투자하여 배치하세요. 한 번에 몰아서 끝내는 것이 효율적입니다.
7) **시간 활용 (매우 중요)**: 하루에 **생활 패턴을 제외한 시간이 60분 이상 남으면 반드시 채워야** 합니다. 같은 작업을 **하루에 여러 블록으로 분할 배치**하거나, 여러 작업을 **병렬 배치**하여 시간을 최대한 활용하세요.
8) **같은 작업 하루 여러 번 배치**: **특히 중요도+난이도 상 작업**은 같은 날에 **여러 시간대에 분산 배치**하세요. 
  * **시간대 선호도 우선**: 사용자 피드백에 아침/오전 시간대 선호가 있으면, 오전 시간대(06:00~12:00)에 우선 배치하세요. 단, 필요한 작업 시간이 오전 시간대만으로 부족하면 오후 시간대(17:00~)에도 추가로 배치하세요. 예를 들어 "오픽 시험 준비"가 하루에 3시간 필요하면 오전 2시간(06:00~08:00) + 오후 1시간(17:00~18:00)으로 배치하세요. 
9) **시간 활용 전략**: 각 day의 가능한 시간대를 확인하고, **가능한 모든 시간대에 배치**하세요.
10) **할 일 간 겹침 금지, 생활패턴/고정일정 침범 금지**: 할 일끼리는 겹치면 안 되지만, **생활 패턴끼리는 겹쳐도 됩니다.**
11) **휴식 간격 필수**: 같은 작업이나 다른 작업을 연속으로 배치할 때는 **최소 30분** 간격을 두세요 (예: 17:00-19:00 작업 후 다음 작업은 19:30 이후). **쉬는 시간을 반드시 포함**하세요.
12) **주말 정책**: 
  * **사용자 피드백에 주말 관련 내용이 있으면 그에 따라 배치하세요.**
  * **피드백이 없으면 주말(day:6 토요일, day:7 일요일)도 스케줄 배치가 가능합니다. 필요한 경우 주말에도 배치하세요.**
  * **특히 priority='상' AND difficulty='상' 작업은 주말에도 매일, 필요 시 하루 여러 블록을 배치하세요.**
13) **생활 패턴 필수 배치**: 사용자가 입력한 모든 생활 패턴은 반드시 해당 요일에 배치되어야 합니다. 생활 패턴이 겹치더라도 모두 배치하세요. 예: "주말 22시~24시 자유시간"은 모든 주말(day:6, day:7)에 반드시 배치되어야 합니다.
14) **모든 작업 필수 배치 (매우 중요)**: tasks 배열의 **모든 작업은 반드시 스케줄에 배치**되어야 합니다. deadline_day가 스케줄 생성 범위(day ${finalStartDay}~${finalEndDay})를 벗어나더라도, **스케줄 생성 범위 내에서 배치**하세요. priority='상' AND difficulty='상'인 작업은 **스케줄 생성 범위 내에서 매일 배치**하세요. 작업을 배치하지 않는 것은 **절대 금지**입니다.

**입력 (tasks만 배치하세요):**
\`\`\`json
{
  "tasks": ${JSON.stringify(tasksForAIJSON, null, 2)}
}
\`\`\`

**⚠️ 중요: 빈 시간 목록을 제공하지 않으므로, AI가 생활 패턴과 할 일을 고려하여 자유롭게 스케줄을 설계하세요.**

**deadline_time 처리:**
- deadline_time이 있는 작업은 **반드시 deadline_day의 deadline_time에 배치**하세요.
- type: "appointment"인 작업은 deadline_day와 deadline_time을 **절대적으로 준수**해야 합니다.

**출력 형식:**
- **반드시 day ${finalStartDay}부터 day ${finalEndDay}까지 모든 day에 대해 scheduleData를 생성하세요.**
- **반드시 ${scheduleLength}개의 day 객체를 생성하세요: day ${finalStartDay}, day ${finalStartDay + 1}, ..., day ${finalEndDay}**
- **day ${finalEndDay}를 생성하지 않으면 생성 실패입니다.**

\`\`\`json
{
  "scheduleData": [
    {
      "day": ${finalStartDay},
      "weekday": "토요일",
      "activities": [
        {
          "start": "21:00",
          "end": "07:00",
          "title": "취침",
          "type": "lifestyle"
        }
      ]
    },
    {
      "day": ${finalStartDay + 1},
      "weekday": "일요일",
      "activities": [
        {
          "start": "21:00",
          "end": "07:00",
          "title": "취침",
          "type": "lifestyle"
        }
      ]
    },
    {
      "day": ${finalStartDay + 2},
      "weekday": "월요일",
      "activities": [
        {
          "start": "21:00",
          "end": "07:00",
          "title": "취침",
          "type": "lifestyle"
        }
      ]
    },
    ... (day ${finalStartDay + 3}부터 day ${finalEndDay - 1}까지 **모든 day를 반드시 포함**하세요. 일부 day만 생성하는 것은 절대 금지입니다.) ...,
    {
      "day": ${finalEndDay - 1},
      "weekday": "목요일",
      "activities": [
        {
          "start": "21:00",
          "end": "07:00",
          "title": "취침",
          "type": "lifestyle"
        }
      ]
    },
    {
      "day": ${finalEndDay},
      "weekday": "금요일",
      "activities": [
        {
          "start": "21:00",
          "end": "07:00",
          "title": "취침",
          "type": "lifestyle"
        }
      ]
    }
  ],
  "notes": [
    "생활 패턴을 반복 배치했습니다.",
    "모든 빈 시간을 최대한 활용하여 작업을 배치했습니다."
  ]
}
\`\`\`

⚠️ **최종 확인 (생성 전 반드시 확인하세요)**: 
- scheduleData 배열에 **정확히 ${scheduleLength}개의 day 객체**가 있는지 확인하세요.
- **반드시 day ${finalStartDay}부터 day ${finalEndDay}까지 모든 day가 포함되어 있는지 확인하세요.**
- **day ${finalEndDay}가 반드시 포함되어 있는지 확인하세요.**
- **day ${finalEndDay}가 없으면 생성 실패입니다. 반드시 다시 생성하세요.**
- **생성 후 검증: scheduleData 배열의 길이가 정확히 ${scheduleLength}개인지 확인하세요.**
- **생성 후 검증: scheduleData 배열의 마지막 요소의 day가 정확히 ${finalEndDay}인지 확인하세요.**
- **⚠️ 매우 중요: 마지막 day는 day ${finalEndDay}입니다. day ${finalEndDay}를 반드시 포함해야 합니다.**

**⚠️ 매우 중요:**
- **생활 패턴은 반드시 type: "lifestyle"이어야 합니다.**
- **생활 패턴은 해당 요일마다 반복되어야 합니다. 한 번만 배치하는 것은 절대 금지입니다.**
- 예: "일요일 오후 12시~13시 브런치"가 있으면, 생성 기간의 **모든 일요일(day:7)에 반복** 배치해야 합니다.
- 예: "매일 저녁 9시~아침 7시 취침"이 있으면, 생성 기간의 **모든 요일(day:1~7)에 반복** 배치해야 합니다.

**중요:**
- 반드시 "scheduleData" 키를 사용하세요. "scheduleData"는 day별 객체 배열입니다.
- **반드시 day ${finalStartDay}부터 day ${finalEndDay}까지 모든 day에 대해 스케줄을 생성하세요.** 일부 day만 생성하는 것은 절대 금지입니다.
- **⚠️ 매우 중요: 마지막 day는 day ${finalEndDay}입니다. day ${finalEndDay}를 반드시 포함해야 합니다.**
- 각 day 객체는 "day", "weekday", "activities" 필드를 포함해야 합니다.
- 각 activity는 "start", "end", "title", "type" 필드를 포함해야 합니다.
- **"notes"는 스케줄 생성 이유와 배치 전략을 간결하게 설명하는 문자열 배열입니다 (최대 3-4줄).**
  * 반드시 포함해야 할 내용:
    1. 빈 시간 계산 결과: 각 day별로 계산한 빈 시간 요약
       - 예: "평일 빈 시간: 07:00~08:00(1h), 17:00~21:00(4h) / 주말 빈 시간: 07:00~12:00(5h), 13:00~15:00(2h), 17:00~21:00(4h)"
    2. 할 일 배치 전략: 어떤 빈 시간을 선택했는지
       - 예: "오픽 시험 준비를 아침형 선호도에 따라 평일 07:00~08:00(1h) + 17:00~18:00(1h), 주말 07:00~12:00(5h)의 빈 시간에 배치"
    3. 피드백 반영 여부: 사용자 피드백을 어떻게 반영했는지
       - 예: "아침형 선호도에 따라 오전 시간대를 우선 활용했으며, 필요한 만큼 오후 시간대에도 추가 배치했습니다"
  * 제네릭한 문구("기존 일정에 따라 모든 활동을 유지하며", "생활 패턴을 반복 배치했습니다" 등)는 사용하지 마세요.
  * 대신 실제 스케줄 설계 이유를 구체적으로 작성하세요:
    - 올바른 예: "평일 빈 시간: 07:00~08:00(1h), 17:00~21:00(4h). 주말 빈 시간: 07:00~12:00(5h), 13:00~15:00(2h), 17:00~21:00(4h). 중요도 상 작업 '오픽 시험 준비'를 아침형 선호도에 따라 평일 07:00~08:00(1h) + 17:00~18:00(1h), 주말 07:00~12:00(5h)의 빈 시간에 배치했습니다."
    - 잘못된 예: "기존 일정에 따라 모든 활동을 유지하며, 새로운 작업을 추가하여 스케줄을 조정했습니다." (빈 시간 정보 없음)
  * 할 일이 있는 경우: 각 작업의 배치 이유와 우선순위, 그리고 사용한 빈 시간을 구체적으로 설명하세요.`
            };

            // 시스템 프롬프트를 맨 앞에 추가
            const enhancedMessages = [systemPrompt, ...userMessages]
                .filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
            

            // 타이밍 로그 시작
            const T0 = Date.now();
        
            const payload = {
                model: 'gpt-4o-mini',
                messages: enhancedMessages,
                temperature: 0.3, // 약간 높여서 더 자연스러운 notes 생성
                response_format: { type: 'json_object' },
                stream: true // 스트리밍 활성화
            };
            
            const T1 = Date.now();
            console.log('[타이밍] 프롬프트 구성 시간:', T1 - T0, 'ms');

            // 스트리밍 응답 처리
            const T2 = Date.now();
            console.log('[타이밍] 대기열 시간:', T2 - T1, 'ms');
            const T3 = Date.now();
            
            const response = await this.callWithRetry(() => {
                return axios.post(
                    'https://api.openai.com/v1/chat/completions',
                    payload,
                    {
                        ...this.axiosOpts,
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.openaiApiKey}`
                        },
                        responseType: 'stream' // 스트리밍 응답 처리
                    }
                );
            });

            // 스트리밍 응답을 문자열로 수집
            let content = '';
            const stream = response.data;
            
            await new Promise((resolve, reject) => {
                stream.on('data', (chunk) => {
                    const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') {
                                resolve();
                                return;
                            }
                            try {
                                const json = JSON.parse(data);
                                const delta = json.choices?.[0]?.delta?.content;
                                if (delta) {
                                    content += delta;
                                }
                            } catch (e) {
                                // JSON 파싱 실패는 무시 (일부 chunk는 불완전할 수 있음)
                            }
                        }
                    }
                });
                
                stream.on('end', () => {
                    const T4 = Date.now();
                    console.log('[타이밍] OpenAI 응답 시간:', T4 - T3, 'ms');
                    console.log('[타이밍] 총 소요 시간:', T4 - T0, 'ms');
                    resolve();
                });
                
                stream.on('error', (error) => {
                    reject(error);
                });
            });
            
            if (!content || content.trim().length === 0) {
                throw new Error('AI 응답이 비어있습니다.');
            }
            
            // 스트리밍 응답이 완전한 JSON인지 확인
            const trimmedContent = content.trim();
            if (!trimmedContent.startsWith('{') || !trimmedContent.endsWith('}')) {
                console.warn('[⚠️ 경고] 스트리밍 응답이 불완전할 수 있습니다. 응답 시작:', trimmedContent.substring(0, 100));
                console.warn('[⚠️ 경고] 응답 끝:', trimmedContent.substring(Math.max(0, trimmedContent.length - 100)));
            }
            
            console.log('[🧠 AI 응답 원본 스케줄 JSON]');
            console.log(content || '(응답 없음)');
            
            // AI 원본 응답을 파일로 저장 (디버깅용)
            try {
                const fs = require('fs');
                const path = require('path');
                const debugPath = path.join(__dirname, '../debug-last-ai.json');
                fs.writeFileSync(debugPath, content || '{}', 'utf-8');
            } catch (fsError) {
                console.warn('[디버그] 파일 저장 실패 (무시 가능):', fsError.message);
            }
            
            // JSON 파싱 - response_format이 json_object이므로 순수 JSON만 반환됨
            let parsed;
            try {
                const trimmedContent = content.trim();
                // JSON이 불완전할 수 있으므로 닫는 괄호 확인
                let jsonContent = trimmedContent;
                if (!jsonContent.endsWith('}')) {
                    // 불완전한 JSON인 경우 닫는 괄호 추가 시도
                    const openBraces = (jsonContent.match(/{/g) || []).length;
                    const closeBraces = (jsonContent.match(/}/g) || []).length;
                    const missingBraces = openBraces - closeBraces;
                    if (missingBraces > 0) {
                        jsonContent += '\n' + '}'.repeat(missingBraces);
                        console.warn(`[⚠️ 경고] JSON이 불완전하여 ${missingBraces}개의 닫는 괄호를 추가했습니다.`);
                    }
                }
                parsed = JSON.parse(jsonContent);
            } catch (jsonError) {
                console.error('JSON 파싱 실패:', jsonError.message);
                console.error('AI 응답 길이:', content.length);
                console.error('AI 응답 시작 부분:', content.substring(0, Math.min(500, content.length)));
                console.error('AI 응답 끝 부분:', content.substring(Math.max(0, content.length - 500)));
                throw new Error('AI 응답을 JSON으로 파싱할 수 없습니다: ' + jsonError.message);
            }
            
            // AI가 항상 scheduleData를 제공하므로, 그대로 사용
            let dayArrays = Array.isArray(parsed?.schedule) ? parsed.schedule
                           : Array.isArray(parsed?.scheduleData) ? parsed.scheduleData
                           : null;
            if (!dayArrays && parsed && typeof parsed === 'object' && Array.isArray(parsed.activities) && Number.isFinite(parsed.day)) {
                dayArrays = [parsed];
            }
            
            if (!dayArrays || dayArrays.length === 0) {
                throw new Error('AI 응답에 scheduleData가 없습니다. AI는 항상 scheduleData를 제공해야 합니다.');
            }
            
            // 중복 day 제거 (같은 day가 여러 번 있으면 마지막 것만 사용)
            const dayMap = new Map();
            for (const dayObj of dayArrays) {
                if (dayObj && Number.isFinite(dayObj.day)) {
                    dayMap.set(dayObj.day, dayObj);
                }
            }
            
            // AI 응답 검증: day 범위 확인
            const generatedDays = Array.from(dayMap.keys()).sort((a, b) => a - b);
            const expectedStartDay = finalStartDay;
            const expectedEndDay = finalEndDay;
            const actualStartDay = generatedDays.length > 0 ? generatedDays[0] : null;
            const actualEndDay = generatedDays.length > 0 ? generatedDays[generatedDays.length - 1] : null;
            
            // 경고: day 범위가 부족하면 경고 로그만 출력
            if (actualEndDay < expectedEndDay) {
                const missingDays = Array.from({ length: expectedEndDay - actualEndDay }, (_, i) => actualEndDay + 1 + i);
                console.warn(`[⚠️ 경고] AI 응답이 불완전합니다! day ${expectedEndDay}까지 생성해야 하는데 day ${actualEndDay}까지만 생성했습니다. 누락된 day: ${missingDays.join(', ')}`);
                console.warn(`[⚠️ 경고] 예상 범위: day ${expectedStartDay}~${expectedEndDay} (총 ${scheduleLength}일), 실제 생성: day ${actualStartDay || '없음'}~${actualEndDay || '없음'} (총 ${generatedDays.length}일)`);
            }
            
            dayArrays = Array.from(dayMap.values()).sort((a, b) => a.day - b.day);
                        
            const explanation = parsed.explanation || parsed.reason || '';
            const notes = Array.isArray(parsed.notes) ? parsed.notes : (parsed.notes ? [parsed.notes] : []);
            
            // AI가 생성한 schedule을 그대로 반환
            const finalSchedule = dayArrays.map(dayObj => ({
                day: dayObj.day,
                weekday: dayObj.weekday,
                activities: Array.isArray(dayObj.activities) ? dayObj.activities : []
            }));
            
            // notes를 explanation에 통합 (notes가 있으면 우선 사용)
            let finalExplanation = '';
            if (notes.length > 0) {
                finalExplanation = notes.join('\n');
            } else if (explanation?.trim()) {
                finalExplanation = explanation.trim();
            }
            
            return {
                schedule: finalSchedule,
                explanation: finalExplanation,
                notes: notes,
                taxonomy: parsed.taxonomy || [],
                activityAnalysis: parsed.activityAnalysis || {},
                unplaced: parsed.unplaced || []
            };
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            const isTimeout = String(error.message || '').includes('timeout') || 
                             error.code === 'ETIMEDOUT' || 
                             error.code === 'ECONNRESET';
            
            console.error('=== GPT 호출 실패 상세 정보 ===');
            console.error('에러 타입:', error.constructor.name);
            console.error('에러 메시지:', error.message);
            console.error('에러 코드:', error.code);
            console.error('타임아웃 여부:', isTimeout);
            console.error('HTTP 상태:', status);
            console.error('응답 데이터:', data);
            console.error('에러 스택:', error.stack);
            console.error('===============================');
            
            if (isTimeout) {
                console.error('[⚠️ 타임아웃] OpenAI API 호출이 시간 초과되었습니다. 타임아웃 설정을 확인하세요.');
            }
            
            throw new Error('시간표 생성 실패: ' + (error.response?.data?.error?.message || error.message));
        }
    }

    // 피드백 분석
    async analyzeFeedback(feedbackText, userData) {
        try {
            // FEEDBACK_PROMPT가 정의되지 않은 경우 폴백
            let feedbackPrompt;
            try {
                feedbackPrompt = global.FEEDBACK_PROMPT;
            } catch (e) {
                // ReferenceError 방지
            }
            
            if (!feedbackPrompt || typeof feedbackPrompt.system !== 'string' || typeof feedbackPrompt.user !== 'function') {
                console.warn('[aiService.analyzeFeedback] FEEDBACK_PROMPT가 정의되지 않았습니다. 폴백 분석을 사용합니다.');
                return this.fallbackAnalysis(feedbackText);
            }
            
            const messages = [
                {
                    role: 'system',
                    content: feedbackPrompt.system
                },
                {
                    role: 'user',
                    content: feedbackPrompt.user(feedbackText, userData)
                }
            ];

            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4o',
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 1500
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.openaiApiKey}`
                    }
                }
            );

            const aiResponse = response.data.choices[0].message.content;
            
            // JSON 응답 파싱
            try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                } else {
                    return this.fallbackAnalysis(feedbackText);
                }
            } catch (parseError) {
                console.error('AI 응답 파싱 실패:', parseError);
                return this.fallbackAnalysis(feedbackText);
            }
        } catch (error) {
            console.error('AI 피드백 분석 실패:', error);
            return this.fallbackAnalysis(feedbackText);
        }
    }

    // 이미지 처리
    async processImage(image, prompt) {
        try {
            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: '당신은 이미지에서 텍스트를 정확히 추출하고 해석하는 전문가입니다. 시간표나 일정 정보를 명확하게 정리해주세요.'
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: prompt || '이 이미지에서 시간표나 일정 정보를 텍스트로 추출해주세요.'
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: image,
                                    detail: 'high'
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000,
                temperature: 0.1
            }, {
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('GPT-4o 이미지 처리 실패:', error.response?.data || error.message);
            throw new Error('이미지 처리에 실패했습니다.');
        }
    }

    // 음성 인식
    async transcribeAudio(audioBuffer) {
        try {
            const FormData = require('form-data');
            const formData = new FormData();
            
            formData.append('file', audioBuffer, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
            });
            formData.append('model', 'whisper-1');
            formData.append('language', 'ko');

            const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    ...formData.getHeaders()
                }
            });

            return response.data.text;
        } catch (error) {
            console.error('Whisper 음성 인식 실패:', error.response?.data || error.message);
            throw new Error('음성 인식에 실패했습니다.');
        }
    }

  // 대화형 피드백 분석 (전체 히스토리 기반)
  async analyzeConversationalFeedback(conversationalFeedbacks) {
    try {
      const conversationText = conversationalFeedbacks.map(feedback => 
        `사용자: ${feedback.userMessage}\nAI: ${feedback.aiResponse}`
      ).join('\n\n');

      // 사용자 피드백에서 반복되는 패턴과 선호도 추출
      const timePatterns = this.extractTimePatterns(conversationalFeedbacks);
      const activityPatterns = this.extractActivityPatterns(conversationalFeedbacks);
      const workloadPatterns = this.extractWorkloadPatterns(conversationalFeedbacks);

      const prompt = `
사용자와의 대화 기록을 분석하여 사용자의 선호도와 패턴을 추출해주세요.

대화 기록:
${conversationText}

추출된 패턴들:
- 시간 관련: ${JSON.stringify(timePatterns)}
- 활동 관련: ${JSON.stringify(activityPatterns)}
- 작업량 관련: ${JSON.stringify(workloadPatterns)}

다음 JSON 형식으로 분석 결과를 반환해주세요:
{
  "preferences": [
    {
      "preferenceType": "time_preference|activity_preference|workload_preference",
      "preferenceKey": "구체적인 키워드",
      "preferenceValue": "prefer|avoid|reduce|increase|maintain",
      "confidence": 0.0-1.0,
      "reasoning": "분석 근거",
      "originalFeedback": "원본 피드백 텍스트"
    }
  ],
  "insights": [
    {
      "type": "strength|improvement|pattern",
      "title": "인사이트 제목",
      "description": "구체적인 설명",
      "confidence": 0.0-1.0,
      "basedOn": "어떤 피드백에서 추출되었는지"
    }
  ],
  "analysis": "전체적인 분석 결과",
  "recommendations": [
    {
      "type": "schedule_optimization|time_management|productivity",
      "title": "추천 제목",
      "description": "구체적인 추천 내용",
      "priority": "high|medium|low",
      "reasoning": "추천 근거"
    }
  ],
  "memoryPoints": [
    {
      "key": "기억해야 할 핵심 포인트",
      "value": "구체적인 내용",
      "importance": "high|medium|low",
      "lastMentioned": "언급된 날짜"
    }
  ]
}

분석할 때 다음을 고려해주세요:
1. 사용자의 감정과 톤 (긍정적/부정적/중립적)
2. 반복되는 불만사항이나 선호사항
3. 시간대, 활동, 작업량에 대한 언급
4. AI의 응답에 대한 사용자의 반응
5. 대화의 맥락과 흐름
6. 사용자가 강조하거나 반복해서 언급한 내용
7. 구체적인 요청사항이나 불만사항
`;

      const response = await this.callGPT(prompt);
      return response;
    } catch (error) {
      console.error('대화형 피드백 분석 실패:', error);
      return this.fallbackConversationalAnalysis(conversationalFeedbacks);
    }
  }

  // 시간 관련 패턴 추출
  extractTimePatterns(feedbacks) {
    const patterns = [];
    feedbacks.forEach(feedback => {
      const message = feedback.userMessage?.toLowerCase() || '';
      if (message.includes('아침') || message.includes('오전')) {
        patterns.push({
          time: 'morning',
          sentiment: message.includes('부지런') ? 'positive' : 'negative',
          feedback: feedback.userMessage
        });
      }
      if (message.includes('쉬는시간') || message.includes('휴식')) {
        patterns.push({
          time: 'break',
          sentiment: message.includes('길') ? 'positive' : 'negative',
          feedback: feedback.userMessage
        });
      }
    });
    return patterns;
  }

  // AI 조언 생성
  async generateDailyAdvice(userData, activityAnalysis, goal = '') {
    try {
      // 목표 정보를 프롬프트에 반영
      const goalContext = goal.trim() 
        ? `\n**사용자 목표:** ${goal.trim()}\n이 목표를 달성하기 위해 현재 활동 패턴이 얼마나 효과적인지, 어떤 개선이 필요한지 구체적으로 분석해주세요.`
        : '';
      
      const systemPrompt = {
        role: 'system',
        content: `당신은 사용자의 일일 활동 패턴을 분석하여 개인화된 조언을 제공하는 AI 어시스턴트입니다.

사용자의 활동 데이터를 바탕으로 다음과 같은 조언을 제공해주세요:
1. 활동 비중 분석 (어떤 활동이 많은지, 부족한지)
2. 균형 잡힌 라이프스타일을 위한 구체적인 제안
3. 개선이 필요한 영역과 해결방안
4. 격려와 동기부여 메시지${goalContext}

**중요**: 활동 분류를 정확히 파악하고, 각 카테고리별로 구체적인 조언을 제공하세요.
- work(업무): 업무 관련 활동
- study(공부): 학습, 자기계발, 공부 관련 활동  
- exercise(운동): 신체 활동, 운동 관련
- reading(독서): 독서, 읽기 활동
- hobby(취미): 여가, 취미 활동
- others(기타): 기타 활동

         조언은 친근하고 실용적이며, 사용자가 실제로 실행할 수 있는 구체적인 내용으로 작성해주세요.
         
         **응답 형식**:
         - 각 조언 항목은 번호와 함께 명확히 구분해주세요
         - 각 항목 내에서도 적절한 줄바꿈을 사용하여 가독성을 높여주세요
         - 이모지를 적절히 사용하여 친근함을 표현해주세요
         
         한국어로 응답하고, 300자 이내로 작성해주세요.`
      };

      // 목표 정보를 userPrompt에 반영
      const goalSection = goal.trim() 
        ? `\n**사용자 목표:** ${goal.trim()}\n이 목표를 달성하기 위해 현재 활동 패턴이 얼마나 효과적인지, 어떤 개선이 필요한지 구체적으로 분석해주세요.`
        : '';
      
      const userPrompt = {
        role: 'user',
        content: `사용자 활동 분석 데이터:
- 활동 비중 (시간 단위): ${JSON.stringify(activityAnalysis)}
- 생활 패턴: ${userData.lifestylePatterns?.join(', ') || '없음'}
- 최근 스케줄: ${userData.lastSchedule ? '있음' : '없음'}${goalSection}

**분석 요청사항**:
1. 각 활동 카테고리별 시간 비중을 분석해주세요
2. 가장 많은 시간을 소요한 활동과 가장 적은 시간을 소요한 활동을 파악해주세요
3. 균형 잡힌 라이프스타일을 위해 개선이 필요한 영역을 제안해주세요
4. 구체적이고 실행 가능한 조언을 제공해주세요${goal.trim() ? '\n5. 사용자가 설정한 목표를 달성하기 위한 구체적인 전략과 조언을 제공해주세요.' : ''}

위 데이터를 바탕으로 개인화된 AI 조언을 생성해주세요.`
      };

      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [systemPrompt, userPrompt],
          temperature: 0.7,
          max_tokens: 300
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.openaiApiKey}`
          },
          timeout: 10000
        }
      );

      return response.data.choices?.[0]?.message?.content;
    } catch (error) {
      console.error('AI 조언 생성 실패:', error);
      return '오늘 하루도 수고하셨습니다! 내일도 화이팅하세요! 💪';
    }
  }

  // 활동 관련 패턴 추출
  extractActivityPatterns(feedbacks) {
    const patterns = [];
    feedbacks.forEach(feedback => {
      const message = feedback.userMessage?.toLowerCase() || '';
      if (message.includes('운동')) {
        patterns.push({
          activity: 'exercise',
          sentiment: message.includes('더') ? 'positive' : 'negative',
          feedback: feedback.userMessage
        });
      }
      if (message.includes('공부') || message.includes('학습')) {
        patterns.push({
          activity: 'study',
          sentiment: message.includes('더') ? 'positive' : 'negative',
          feedback: feedback.userMessage
        });
      }
    });
    return patterns;
  }

  // 작업량 관련 패턴 추출
  extractWorkloadPatterns(feedbacks) {
    const patterns = [];
    feedbacks.forEach(feedback => {
      const message = feedback.userMessage?.toLowerCase() || '';
      if (message.includes('너무') || message.includes('많이')) {
        patterns.push({
          workload: 'heavy',
          sentiment: 'negative',
          feedback: feedback.userMessage
        });
      }
      if (message.includes('적당') || message.includes('좋')) {
        patterns.push({
          workload: 'moderate',
          sentiment: 'positive',
          feedback: feedback.userMessage
        });
      }
    });
    return patterns;
  }

    // GPT 호출 (공통 메서드)
    async callGPT(prompt) {
        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: '당신은 사용자 행동 패턴을 분석하는 전문가입니다. 대화 기록을 분석하여 사용자의 선호도와 패턴을 정확히 추출해주세요.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 2000
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.openaiApiKey}`
                    }
                }
            );

            const aiResponse = response.data.choices[0].message.content;
            
            // JSON 응답 파싱
            try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('JSON 형식이 아닙니다.');
                }
            } catch (parseError) {
                console.error('AI 응답 파싱 실패:', parseError);
                throw new Error('AI 응답을 파싱할 수 없습니다.');
            }
        } catch (error) {
            console.error('GPT 호출 실패:', error.response?.data || error.message);
            throw new Error('AI 분석에 실패했습니다.');
        }
    }

    // 기본 분석 결과 (AI 실패 시)
    fallbackAnalysis(feedbackText) {
        return {
            preferences: [],
            advice: [],
            analysis: "기본 분석을 수행했습니다."
        };
    }

    // 대화형 피드백 기본 분석 (AI 실패 시)
    fallbackConversationalAnalysis(conversationalFeedbacks) {
        return {
            preferences: [],
            insights: [],
            analysis: "대화형 피드백 기본 분석을 수행했습니다.",
            recommendations: []
        };
    }

    // OpenAI 연결 진단
    async debugOpenAIConnection() {
        try {
            const resp = await axios.get('https://api.openai.com/v1/models', {
                headers: { Authorization: `Bearer ${this.openaiApiKey}` }
            });
            return { status: resp.status, data: resp.data, message: 'OK' };
        } catch (e) {
            throw e;
        }
    }

    // 개발용 더미 스케줄 생성
    generateDummySchedule(lifestylePatterns, existingTasks, opts) {
        console.log('[더미 스케줄] 생성 시작');
        
        const now = opts.nowOverride ? new Date(opts.nowOverride) : new Date();
        const baseRelDay = now.getDay() === 0 ? 7 : now.getDay();
        
        // 생활패턴을 기반으로 더미 스케줄 생성
        const schedule = [];
        
        // 14일간의 스케줄 생성
        for (let i = 1; i <= 14; i++) {
            const dayRel = baseRelDay + i - 1;
            const weekdayNum = relDayToWeekdayNumber(dayRel, now);
            const weekday = mapDayToWeekday(dayRel, now);
            
            const activities = [];
            
            // 생활패턴에서 해당 요일에 맞는 활동 추가
            if (lifestylePatterns && Array.isArray(lifestylePatterns)) {
                lifestylePatterns.forEach(pattern => {
                    if (typeof pattern === 'string') {
                        // 문자열 패턴 파싱
                        const parsed = parseLifestyleString(pattern);
                        if (parsed && Array.isArray(parsed.days) && parsed.days.includes(weekdayNum)) {
                            activities.push({
                                title: parsed.title,
                                start: parsed.start,
                                end: parsed.end,
                                type: 'lifestyle'
                            });
                        }
                    } else if (pattern && typeof pattern === 'object') {
                        // 객체 패턴 처리 - patternText가 있으면 파싱해서 사용
                        if (Array.isArray(pattern.days) && pattern.days.includes(weekdayNum)) {
                            let startTime, endTime;
                            
                            if (pattern.patternText) {
                                // patternText에서 시간 파싱
                                const parsed = this.parseLifestyleString(pattern.patternText);
                                if (parsed) {
                                    startTime = parsed.start;
                                    endTime = parsed.end;
                                } else {
                                    startTime = normalizeHHMM(pattern.start);
                                    endTime = normalizeHHMM(pattern.end);
                                }
                            } else {
                                startTime = this.normalizeHHMM(pattern.start);
                                endTime = this.normalizeHHMM(pattern.end);
                            }
                            
                            // 제목에서 시간 부분 제거
                            const cleanTitle = (pattern.title || '활동').replace(/\d{1,2}시~?\d{1,2}시?/g, '').replace(/\s+/g, ' ').trim();
                            
                            activities.push({
                                title: cleanTitle || '활동',
                                start: startTime,
                                end: endTime,
                                type: 'lifestyle'
                            });
                        }
                    }
                });
            }
            
            // 기존 할 일 분산 주입 (라운드로빈 + 마감일 윈도우)
            const slots = [['09:00','10:30'], ['10:30','12:00'], ['14:00','15:30'], ['15:30','17:00']];
            let rrIndex = (dayRel - baseRelDay) % slots.length;
            if (existingTasks?.length) {
                const todaysTasks = existingTasks.filter(t => {
                    const untilRel = Number.isFinite(t.relativeDay) ? t.relativeDay : (baseRelDay + 13);
                    return dayRel <= untilRel;
                });
                todaysTasks.forEach((t, i) => {
                    const [start, end] = slots[(rrIndex + i) % slots.length];
                    activities.push({ title: t.title || '할 일', start, end, type: 'task' });
                });
            }
            
            // 기본 활동이 없으면 추가
            if (activities.length === 0) {
                activities.push({
                    title: '기본 활동',
                    start: '09:00',
                    end: '10:00',
                    type: 'lifestyle'
                });
            }
            
            schedule.push({
                day: dayRel,
                weekday: weekday,
                activities: activities
            });
        }
        
        return {
            schedule: schedule,
            explanation: '개발 모드에서 생성된 더미 스케줄입니다. OpenAI API 키를 설정하면 실제 AI가 생성한 스케줄을 받을 수 있습니다.',
            activityAnalysis: {
                work: 30,
                study: 20,
                exercise: 10,
                reading: 10,
                hobby: 15,
                others: 15
            },
            notes: ['개발 모드 - 더미 데이터', '⚠️ 이 스케줄은 로컬 폴백으로 생성되었습니다. AI 호출이 실패했을 가능성이 높습니다.'],
            __debug: {
                mode: 'dummy',
                isFallback: true,
                lifestylePatterns: lifestylePatterns?.length || 0,
                existingTasks: existingTasks?.length || 0,
                reason: 'API 키가 없거나 AI 호출이 실패하여 더미 스케줄을 생성했습니다.'
            }
        };
    }
}

module.exports = new AIService();
