const axios = require('axios');
const https = require('https');
const { normalizeHHMM, mapDayToWeekday, relDayToWeekdayNumber, extractAllowedDays } = require('../utils/scheduleUtils');
const { parseLifestyleString } = require('../utils/lifestyleUtils');

class AIService {
    constructor() {
        this.openaiApiKey = process.env.OPENAI_API_KEY;
        this.httpsAgent = new https.Agent({ keepAlive: true });
        this.axiosOpts = {
            timeout: 300000,                      // 300초 (5분) - 긴 프롬프트와 스트리밍 응답을 고려
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            httpsAgent: this.httpsAgent,
            validateStatus: (status) => status >= 200 && status < 300
        };
    }

    // 공통 재시도 유틸 (타임아웃/ECONNRESET/ENOTFOUND + 429/5xx 백오프)
    async callWithRetry(fn, tries = 3) {
        let delay = 1000;
        for (let i = 0; i < tries; i++) {
            try {
                return await fn();
            } catch (e) {
                const status = e.response?.status;
                const retriableHttp = [429, 500, 502, 503, 504].includes(status);
                const retriableNet = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(e.code) ||
                                    String(e.message || '').includes('timeout');
                
                if (!(retriableHttp || retriableNet) || i === tries - 1) {
                    e.statusCode = status || 500;
                    throw e;
                }
                
                // 백오프: 지수 백오프 + 랜덤 지터
                await new Promise(r => setTimeout(r, delay + Math.random() * 250));
                delay = Math.min(delay * 2, 8000);
                
                if (retriableHttp) {
                    console.log(`[재시도] HTTP ${status} 에러, ${delay}ms 후 재시도 (${i + 1}/${tries})`);
                } else if (retriableNet) {
                    console.log(`[재시도] 네트워크 에러 (${e.code}), ${delay}ms 후 재시도 (${i + 1}/${tries})`);
                }
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
                taskDays = [baseRelDay];                  // 오늘만
                lifestyleDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);  // 14일 연속
                scheduleLength = 14;
            } else if (forcedTomorrow) {
                taskDays = [baseRelDay + 1];              // 내일만
                lifestyleDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);
                scheduleLength = 14;
            } else if (hasSpecificDate) {
                const extractedDays = extractAllowedDays(messages);
                taskDays = extractedDays;
                lifestyleDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);
                scheduleLength = 14;
            } else if (hasDeadline) {
                const extractedDays = extractAllowedDays(messages);
                if (extractedDays.length > 0) {
                    const maxDay = Math.max(...extractedDays);
                    taskDays = Array.from({ length: maxDay - baseRelDay + 1 }, (_, i) => baseRelDay + i);
                    scheduleLength = maxDay - baseRelDay + 1;
                } else {
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
                
                scheduleLength = Math.min(28, Math.max(14, maxDeadlineDay - baseRelDay + 1)); // 최소 14일, 최대 28일 (상한선)
                taskDays = Array.from({ length: scheduleLength }, (_, i) => baseRelDay + i);
                lifestyleDays = Array.from({ length: scheduleLength }, (_, i) => baseRelDay + i);
            }
            
            let allowedDays = [...new Set([...taskDays, ...lifestyleDays])].sort((a,b)=>a-b);
            const anchorDay = opts.anchorDay ?? (allowedDays.length ? allowedDays[0] : (dayOfWeek===0?7:dayOfWeek));
            
            // 날짜 및 사용자 입력 분석 완료
            
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
                
                // timePreference 파싱 (description이나 title에서 추출)
                let timePreference = 'any';
                const taskText = (task.title || '') + ' ' + (task.description || '');
                const lowerText = taskText.toLowerCase();
                if (/(오전|아침|모닝|morning|아침형|오전에)/.test(lowerText)) {
                    timePreference = 'morning';
                } else if (/(오후|저녁|이브닝|evening|저녁에|밤에)/.test(lowerText)) {
                    timePreference = 'evening';
                }
                
                const taskForAI = {
                    id: taskId,
                    title: task.title,
                    deadline_day: deadlineDay,
                    deadlineTime: task.deadlineTime || null, // 특정 시간이 지정된 경우 (예: "오후 2시" → "14:00")
                    priority: highPriority ? '상' : (task.importance === '중' ? '중' : '하'),
                    difficulty: highDifficulty ? '상' : (task.difficulty === '중' ? '중' : '하'),
                    min_block_minutes: minBlockMinutes,
                    type: task.type || 'task', // type 정보 추가 (appointment인 경우 특별 처리)
                    timePreference: task.timePreference || timePreference, // 오전/오후 선호도
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
                
                // 스케줄 범위 재확장 (기존 범위보다 크면 확장, 상한선 28일)
                const requiredScheduleLength = maxDeadlineDayFromTasks - baseRelDay + 1;
                const newScheduleLength = Math.min(28, Math.max(scheduleLength || 14, requiredScheduleLength));
                
                if (newScheduleLength > (scheduleLength || 14)) {
                    taskDays = Array.from({ length: newScheduleLength }, (_, i) => baseRelDay + i);
                    lifestyleDays = Array.from({ length: newScheduleLength }, (_, i) => baseRelDay + i);
                    scheduleLength = newScheduleLength; // scheduleLength 업데이트
                    // allowedDays도 재계산
                    allowedDays = [...new Set([...taskDays, ...lifestyleDays])].sort((a,b)=>a-b);
                }
            }
            
            
            // 사용자 메시지만 최근 6개 유지
            let userMessages = (messages || []).filter(m => m && m.role === 'user').slice(-6);
            
            // AI에 넘길 tasks (간소화된 스키마)
            const tasksForAIJSON = tasksForAI.map(t => {
                const taskObj = {
                id: t.id,
                title: t.title,
                deadline_day: t.deadline_day,
                priority: t.priority,
                difficulty: t.difficulty,
                min_block_minutes: t.min_block_minutes,
                    type: t.type || 'task', // type 정보 추가 (appointment인 경우 특별 처리)
                    time_preference: t.timePreference || 'any' // 오전/오후 선호도
                };
                
                // deadline_time은 type이 "appointment"인 경우에만 포함
                // type이 "task"인 경우 deadline_time이 있어도 제거 (AI가 자유롭게 배치하도록)
                if (t.type === 'appointment' && t.deadlineTime) {
                    taskObj.deadline_time = t.deadlineTime;
                }
                
                return taskObj;
            });
            

            // 생활 패턴 원본 텍스트 추출
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
            
            // 피드백을 구조화된 JSON과 간소화된 텍스트로 변환
            let feedbackConstraints = {
                preferMorning: false,
                preferEvening: false,
                prohibitWeekendTasks: false,
                allowWeekendTasks: false,
                minRestMinutes: 0,
                noWorkWithin1hAfterWork: false,
                noWorkAfterArrival: false,
                noWorkDuringLunch: false
            };
            let feedbackSection = '';
            let detectedPatterns = [];
            if (opts.userFeedback && opts.userFeedback.trim()) {
                const feedbackText = opts.userFeedback.trim();
                
                // 피드백 내용 분석하여 구조화된 제약 조건 추출
                const feedbackLower = feedbackText.toLowerCase();
                
                // 1. 아침 시간대 선호도 감지
                const morningKeywords = ['아침', '오전', '아침형', '오전에', '오전 시간', '오전에 작업', '아침에 작업', '오전에 집중', '아침에 집중', '아침에 더'];
                const hasMorningPreference = morningKeywords.some(keyword => feedbackLower.includes(keyword));
                if (hasMorningPreference) {
                    feedbackConstraints.preferMorning = true;
                    detectedPatterns.push('아침 시간대 선호도');
                    feedbackSection += `\n- 오전 시간대(06:00~12:00) 우선 배치`;
                }
                
                // 2. 저녁 시간대 선호도 감지
                const eveningKeywords = ['저녁', '저녁형', '저녁에', '밤에', '저녁 시간', '저녁에 작업', '밤에 작업', '저녁에 집중'];
                const hasEveningPreference = eveningKeywords.some(keyword => feedbackLower.includes(keyword));
                if (hasEveningPreference) {
                    feedbackConstraints.preferEvening = true;
                    detectedPatterns.push('저녁 시간대 선호도');
                    feedbackSection += `\n- 저녁 시간대(18:00~23:00) 우선 배치`;
                }
                
                // 3. 주말 업무 허용 감지
                const hasWeekendKeyword = feedbackLower.includes('주말');
                const hasWeekendWorkKeyword = feedbackLower.includes('업무') || feedbackLower.includes('일할') || 
                                      feedbackLower.includes('작업') || feedbackLower.includes('생성') ||
                                      feedbackLower.includes('배치');
                if (hasWeekendKeyword && hasWeekendWorkKeyword) {
                    // 주말 업무 금지 키워드 확인
                    const weekendDeny = feedbackLower.includes('안') || feedbackLower.includes('금지') ||
                                       feedbackLower.includes('하지') || feedbackLower.includes('싶지') ||
                                       feedbackLower.includes('원하지') || feedbackLower.includes('ㄴㄴ');
                    
                    if (weekendDeny) {
                        feedbackConstraints.prohibitWeekendTasks = true;
                        detectedPatterns.push('주말 업무 금지');
                        feedbackSection += `\n- 주말(day:6,7)에 task 배치 금지`;
                    } else {
                        feedbackConstraints.allowWeekendTasks = true;
                        detectedPatterns.push('주말 업무 허용');
                        feedbackSection += `\n- 주말(day:6,7)에도 task 배치`;
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
                    feedbackConstraints.minRestMinutes = restMinutes;
                    feedbackSection += `\n- 작업 간 최소 ${restMinutes}분 휴식`;
                }
                
                // 5. 회사 끝나고/퇴근 후 작업 금지 감지 (최우선)
                const hasCompanyEnd = feedbackLower.includes('회사 끝') || feedbackLower.includes('퇴근') || 
                                     feedbackLower.includes('회사 후') || feedbackLower.includes('업무 끝');
                const hasTimeRestriction = feedbackLower.includes('1시간') || feedbackLower.includes('바로') || 
                                          feedbackLower.includes('이내') || feedbackLower.includes('직후');
                const hasWorkDenial = feedbackLower.includes('안') || feedbackLower.includes('금지') || 
                                    feedbackLower.includes('ㄴㄴ') || feedbackLower.includes('하지 마');
                const hasWorkKeyword = feedbackLower.includes('업무') || feedbackLower.includes('작업') || 
                                     feedbackLower.includes('일') || feedbackLower.includes('배치');
                
                if (hasCompanyEnd && hasTimeRestriction && (hasWorkDenial || hasWorkKeyword)) {
                    feedbackConstraints.noWorkWithin1hAfterWork = true;
                    detectedPatterns.push('회사 끝나고 작업 금지');
                    feedbackSection += `\n- 퇴근 후 1시간 이내 task 배치 금지`;
                }
                
                // 6. 출근 직후 작업 금지 감지
                if (feedbackLower.includes('출근') && (feedbackLower.includes('바로') || feedbackLower.includes('다음')) &&
                    (feedbackLower.includes('일') || feedbackLower.includes('작업') || feedbackLower.includes('배치')) &&
                    (feedbackLower.includes('안') || feedbackLower.includes('금지') || feedbackLower.includes('ㄴㄴ'))) {
                    feedbackConstraints.noWorkAfterArrival = true;
                    detectedPatterns.push('출근 직후 작업 금지');
                    feedbackSection += `\n- 출근 직후 1시간 task 배치 금지`;
                }
                
                // 7. 점심 시간대 작업 금지 감지
                if ((feedbackLower.includes('점심') || feedbackLower.includes('식사')) &&
                    (feedbackLower.includes('안') || feedbackLower.includes('금지') || feedbackLower.includes('ㄴㄴ'))) {
                    feedbackConstraints.noWorkDuringLunch = true;
                    feedbackSection += `\n- 점심 시간대(12:00~14:00) task 배치 금지`;
                }
                
            }
            
            // 최종 스케줄 범위 계산
            const finalStartDay = baseRelDay;
            const finalEndDay = baseRelDay + scheduleLength - 1;
            
            
            // 생활 패턴 매핑 텍스트 생성 (간단한 버전)
            let lifestyleMappingText = '';
            if (lifestyleTexts.length > 0) {
                const dayNames = { 1: '월요일', 2: '화요일', 3: '수요일', 4: '목요일', 5: '금요일', 6: '토요일', 7: '일요일' };
                
                lifestyleTexts.forEach((text, idx) => {
                    const parsed = parseLifestyleString(text);
                    if (parsed && parsed.days) {
                        const dayList = parsed.days.map(d => `day:${d}(${dayNames[d]})`).join(', ');
                        lifestyleMappingText += `${idx + 1}. "${text}"\n`;
                        lifestyleMappingText += `   → 적용 day: ${dayList}\n`;
                        lifestyleMappingText += `   → 시간: ${parsed.start} ~ ${parsed.end}\n`;
                        lifestyleMappingText += `   → 제목: ${parsed.title}\n\n`;
                    }
                });
                
                if (lifestyleMappingText) {
                    lifestyleMappingText = `다음은 사용자가 직접 입력한 고정 생활 패턴입니다. 이 패턴들은 반드시 type: "lifestyle"로 배치하고, 아래 명시된 day에만 정확히 배치하세요.\n\n${lifestyleMappingText}`;
                }
            } else {
                lifestyleMappingText = '사용자가 입력한 고정 생활 패턴이 없습니다.';
            }
            
            // 피드백 제약 조건 텍스트 생성 (간소화된 버전)
            let constraintsText = '';
            if (feedbackSection) {
                constraintsText = `\n\n[제약 조건]\n${feedbackSection}\n`;
            }
            
            // 구조화된 제약 조건이 있으면 JSON으로도 전달
            const hasConstraints = Object.values(feedbackConstraints).some(v => v !== false && v !== 0);
            
            // 새 system 프롬프트 (사용자 제공 템플릿 사용)
            const systemPrompt = {
                role: 'system',
                content: `
당신은 사용자의 생활 패턴(lifestyle)과 할 일(tasks)을 이용해
현실적인 주간/월간 스케줄을 만드는 **스케줄 설계 AI**입니다.

====================
[1] 출력 형식 (반드시 이 형식의 JSON만 출력)
====================

아래 형식 그대로 JSON 객체 한 개만 출력하세요. 설명 문장, 코드블럭, 주석은 절대 쓰지 마세요.

{
  "scheduleData": [
    {
      "day": number,              // ${finalStartDay} ~ ${finalEndDay} 사이 정수
      "weekday": "월요일" | "화요일" | "수요일" | "목요일" | "금요일" | "토요일" | "일요일",
      "activities": [
        {
          "start": "HH:MM",
          "end": "HH:MM",         // start보다 이후, 필요하면 자정 넘겨도 됨
          "title": string,
          "type": "lifestyle" | "task" | "appointment"
        }
      ]
    }
  ],
  "notes": [ string, ... ]        // 배치 전략/피드백 반영 요약
}

- JSON 앞뒤에 \`\`\` 같은 마크다운, 자연어 설명을 쓰면 안 됩니다.
- \`scheduleData\`가 없거나 배열이 아니면 잘못된 출력입니다.

====================
[2] day / 시간 규칙
====================

- day 번호: day:1(월요일) ~ day:7(일요일), 그 뒤로 8,9,...는 계속 이어지는 상대 날짜입니다.
- 이 요청에서 유효한 day 범위는 **${finalStartDay} ~ ${finalEndDay}** 입니다.
- \`scheduleData\`에는 **${finalStartDay}부터 ${finalEndDay}까지의 day를 빠짐없이** 넣어야 합니다.
  - 중간 day를 건너뛰면 안 됩니다.
  - day는 오름차순으로 정렬하세요.

- 시간 문자열:
  - "오전" = 00:00~11:59, "오후" = 12:00~23:59
  - "21:00"은 밤 9시입니다.
  - start < end 이면 같은 날 안에서 끝나는 것으로 간주합니다.
  - 자정을 넘기고 싶으면 예: start:"22:00", end:"03:00" 같이 표현해도 됩니다.

====================
[3] 입력 데이터 설명
====================

서버에서 이미 한국어 자연어를 파싱해서 구조화한 데이터를 제공합니다.  
당신은 **파싱을 다시 할 필요 없고, 주어진 JSON만 정확히 이용하면 됩니다.**

1) 생활 패턴 (lifestyle) 요약  
- 다음 텍스트는 사용자가 직접 입력한 고정 생활 패턴입니다.
- 여기에 없는 생활 패턴(수면, 식사, 자유시간 등)은 **절대 새로 만들지 마세요.**

${lifestyleMappingText}

2) tasks 배열 (JSON)  
- 아래 JSON은 배치해야 할 할 일/일정 목록입니다.
- 이미 서버에서 중요도, 난이도, 마감일, 타입 등을 계산해두었습니다.
- 당신은 이 JSON에 맞춰 스케줄만 설계하면 됩니다.

"tasks": ${JSON.stringify(tasksForAIJSON, null, 2)}

${hasConstraints ? `3) 제약 조건 (JSON) - 반드시 준수
- 아래 JSON 객체의 제약 조건을 **절대적으로** 준수해야 합니다.

"constraints": ${JSON.stringify(feedbackConstraints, null, 2)}

제약 조건 해석:
- \`preferMorning: true\` → task는 06:00~12:00 우선 배치
- \`preferEvening: true\` → task는 18:00~23:00 우선 배치
- \`prohibitWeekendTasks: true\` → day:6,7에 task 배치 금지
- \`allowWeekendTasks: true\` → day:6,7에도 task 배치
- \`minRestMinutes: N\` → 작업 간 최소 N분 휴식
- \`noWorkWithin1hAfterWork: true\` → 퇴근 후 1시간 이내 task 금지
- \`noWorkAfterArrival: true\` → 출근 직후 1시간 task 금지
- \`noWorkDuringLunch: true\` → 12:00~14:00 task 금지` : ''}

각 task 필드는 다음 의미입니다:

- id: 작업 식별자
- title: 작업 이름 또는 일정 제목
- type:
  - "task": 마감일까지 나눠서 배치하는 일반적인 할 일
  - "appointment": **특정 날짜/시간에 고정된 약속(일정)** 입니다.
- deadline_day:
  - 이 작업이 끝나 있어야 하는 마지막 day입니다.
  - "appointment"일 경우, 이 day에 반드시 배치해야 합니다.
- deadline_time (appointment에만 존재):
  - 그 약속의 **시작 시간**입니다. (예: "21:00")
- priority: "상" | "중" | "하"
- difficulty: "상" | "중" | "하"
- min_block_minutes:
  - 이 작업을 한 번에 잡아야 하는 최소 작업 시간(분)입니다.
- time_preference (선택):
  - "morning": 가능하면 06:00~12:00 사이에 우선 배치
  - "evening": 가능하면 18:00~23:00 사이에 우선 배치
  - "any": 시간대 상관 없음 또는 미제공

====================
[4] 배치 순서 (중요)
====================

항상 다음 순서로 생각하고 배치하세요.

1단계) 생활 패턴(lifestyle) 배치
--------------------------------
- 위에서 제공한 생활 패턴 텍스트를 기준으로,
  각 day에 \`type: "lifestyle"\` 활동을 먼저 배치합니다.
- 생활 패턴은 서로 겹쳐도 괜찮습니다.
- 단, 나중에 배치하는 \`task\`, \`appointment\`와는 겹치면 안 됩니다.
- 사용자가 입력하지 않은 생활 패턴은 **절대 추가하지 마세요.**

2단계) 빈 시간 계산
--------------------
- 각 day에 대해 00:00~24:00 전체 중에서
  lifestyle와 이미 배치된 appointment를 제외한 **빈 시간대**를 계산합니다.
- 자정을 넘는 구간도 빈 시간에 포함해야 합니다.
  - 예: 19:30에 마지막 작업이 끝나고, 다음날 01:00에 수면이 시작하면
    19:30~01:00은 빈 시간입니다.

3단계) appointment 배치
------------------------
- \`type: "appointment"\` 인 항목은 **가장 먼저** 배치합니다.
- 규칙:
  - \`deadline_day\`에 반드시 배치해야 합니다.
  - \`deadline_time\`은 **시작 시간(start)** 입니다.
  - end 시간은 \`min_block_minutes\`를 이용해
    \`end = deadline_time + min_block_minutes\`로 계산하세요.
  - 예:
    - deadline_day: 15, deadline_time: "21:00", min_block_minutes: 60
      → day:15, start:"21:00", end:"22:00"
- appointment는 lifestyle와 겹치지 않는 위치에 정확히 넣어야 합니다.
- appointment끼리도 시간 겹침이 나면 안 됩니다.

4단계) task 배치
-----------------
- 이제 남은 빈 시간에 \`type: "task"\` 를 배치합니다.
- 우선순위 계산 기준(대략적인 가이드):
  1) 마감일까지 남은 day 수가 적을수록 우선
  2) priority "상" > "중" > "하"
  3) difficulty "상"일수록 한 번에 긴 블록으로 배치하는 것을 우선 고려
- 배치 규칙:
  - 가능한 한 **오늘 day:${finalStartDay}부터** 작업을 시작합니다.
  - \`deadline_day\` 이후로는 절대 배치하면 안 됩니다.
  - 각 task는 \`min_block_minutes\` 이상 길이의 블록으로 쪼개어,
    여러 day에 나누어 배치할 수 있습니다.
  - 작업들은 서로 겹치지 않아야 합니다.

- time_preference 처리:
  - time_preference가 "morning"이면:
    - 가능한 한 06:00~12:00 사이 빈 시간에 먼저 넣습니다.
    - 이 구간이 부족할 때만 오후/저녁으로 넘깁니다.
  - "evening"이면:
    - 18:00~23:00 사이를 우선 사용합니다.
  - "any" 또는 필드가 없으면 시간대 상관없이 배치해도 됩니다.
${hasConstraints && feedbackConstraints.preferMorning ? `- **제약 조건**: preferMorning=true이므로 모든 task는 06:00~12:00 우선 배치 필수` : ''}
${hasConstraints && feedbackConstraints.prohibitWeekendTasks ? `- **제약 조건**: prohibitWeekendTasks=true이므로 day:6,7에 task 배치 금지` : ''}
${hasConstraints && feedbackConstraints.minRestMinutes > 0 ? `- **제약 조건**: minRestMinutes=${feedbackConstraints.minRestMinutes}이므로 작업 간 최소 ${feedbackConstraints.minRestMinutes}분 휴식 필수` : ''}

- 휴식:
  - 같은 day에서 task/appointment 블록이 연속으로 붙지 않도록,
    블록 사이에 최소 30분 정도의 빈 시간을 남기려고 노력하세요.
  - (완벽하게 맞추지 못하더라도, 되도록 연달아 꽉 채우지 마세요.)

5단계) 피드백/제약 조건 (옵션)
-------------------------------
${hasConstraints ? `- 아래 "constraints" JSON 객체의 제약 조건을 **절대적으로** 준수해야 합니다.
- 제약 조건과 일반 규칙이 충돌하면 제약 조건을 우선합니다.
- 제약 조건 위반은 심각한 오류입니다.` : '- 추가 제약 조건이 없습니다.'}
${constraintsText}
====================
[5] 검증 체크리스트
====================

출력하기 전에 스스로 다음을 점검하세요:

- [ ] \`scheduleData\` 배열이 존재하고, JSON 최상위에 있다.
- [ ] day는 ${finalStartDay}부터 ${finalEndDay}까지 빠짐없이 모두 있다.
- [ ] 각 day의 \`activities\`는 배열이며, 모든 원소에 \`start\`, \`end\`, \`title\`, \`type\`이 있다.
- [ ] appointment들은 모두 \`deadline_day + deadline_time\`에 시작하도록 배치되었다.
- [ ] task들은 서로 겹치지 않는다.
- [ ] deadline_day 이후로 task가 배치된 경우가 없다.
- [ ] lifestyle는 사용자가 제공한 패턴만 있다 (새로 만든 lifestyle 없음).
- [ ] \`notes\` 배열에, 빈 시간 활용 전략과 피드백/제약 반영 내용을 간단히 적었다.

다시 강조합니다:
→ **설명 문장 없이, 위에서 정의한 JSON 객체 한 개만 출력하세요.**`
            };

            // 타이밍 로그 시작
            const T0 = Date.now();
            
            // 프롬프트 길이 체크 (대략적 토큰 추정: 1토큰 ≈ 4자)
            const totalChars = systemPrompt.content.length + userMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
            const approxTokens = Math.ceil(totalChars / 4);
            
            if (approxTokens > 120000) { // gpt-4o-mini 컨텍스트 한계 대략 128k
                console.warn(`[경고] 프롬프트가 매우 깁니다 (${approxTokens}토큰). 일부 메시지를 축약합니다.`);
                // userMessages를 최근 3개로 제한
                userMessages = userMessages.slice(-3);
            }
            
            // 시스템 프롬프트를 맨 앞에 추가 (userMessages 줄인 후에 생성)
            const enhancedMessages = [systemPrompt, ...userMessages]
                .filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
        
            const basePayload = {
                model: 'gpt-4o-mini',
                messages: enhancedMessages,
                temperature: 0.3,
                response_format: { type: 'json_object' }
            };
            
            const T1 = Date.now();

            // 비스트리밍 호출 (JSON 모드에 가장 안전)
            const nonStreamCall = async (payload) => {
                const resp = await axios.post(
                    'https://api.openai.com/v1/chat/completions',
                    { ...payload, stream: false },
                    {
                        ...this.axiosOpts,
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.openaiApiKey}`
                        }
                    }
                );
                const raw = resp.data?.choices?.[0]?.message?.content?.trim() || '';
                if (!raw.startsWith('{') || !raw.endsWith('}')) {
                    throw new Error('AI 응답이 올바른 JSON이 아닙니다.');
                }
                return JSON.parse(raw);
            };

            // 스트리밍 호출 (폴백용)
            const streamCall = async (payload) => {
                const T3 = Date.now();
                const response = await this.callWithRetry(() => {
                    return axios.post(
                        'https://api.openai.com/v1/chat/completions',
                        { ...payload, stream: true },
                        {
                            ...this.axiosOpts,
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.openaiApiKey}`
                            },
                            responseType: 'stream'
                        }
                    );
                });

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
                                    // JSON 파싱 실패는 무시
                                }
                            }
                        }
                    });
                    
                    stream.on('end', () => {
                        resolve();
                    });
                    
                    stream.on('error', (error) => {
                        reject(error);
                    });
                });
                
                if (!content || content.trim().length === 0) {
                    throw new Error('스트리밍 응답이 비어있습니다.');
                }
                
                const trimmed = content.trim();
                if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
                    throw new Error('스트리밍 응답이 불완전한 JSON입니다.');
                }
                
                return JSON.parse(trimmed);
            };

            // 1차 시도: 비스트리밍 (기본)
            let parsed;
            const T2 = Date.now();
            
            try {
                parsed = await this.callWithRetry(() => nonStreamCall(basePayload));
            } catch (e1) {
                try {
                    parsed = await streamCall(basePayload);
                } catch (e2) {
                    // 최종 폴백: JSON 모드 해제
                    const payloadNoJson = { ...basePayload, response_format: undefined, stream: false };
                    const resp = await this.callWithRetry(() => {
                        return axios.post(
                            'https://api.openai.com/v1/chat/completions',
                            payloadNoJson,
                            {
                                ...this.axiosOpts,
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${this.openaiApiKey}`
                                }
                            }
                        );
                    });
                    const text = resp.data?.choices?.[0]?.message?.content || '{}';
                    // 코드블럭 제거 후 JSON 추출
                    const jsonMatch = text.match(/\{[\s\S]*\}/);
                    if (!jsonMatch) {
                        throw new Error('AI 응답에서 JSON을 추출할 수 없습니다: ' + e2.message);
                    }
                    parsed = JSON.parse(jsonMatch[0]);
                }
            }
            
            
            // 응답 검증 및 보정
            let dayArrays = Array.isArray(parsed?.schedule) ? parsed.schedule
                           : Array.isArray(parsed?.scheduleData) ? parsed.scheduleData
                           : Array.isArray(parsed?.result) ? parsed.result
                           : Array.isArray(parsed?.data) ? parsed.data
                           : null;
            
            // 중첩 구조 처리: parsed.result.scheduleData 같은 경우
            if (!dayArrays && parsed) {
                if (Array.isArray(parsed?.result?.scheduleData)) dayArrays = parsed.result.scheduleData;
                else if (Array.isArray(parsed?.data?.scheduleData)) dayArrays = parsed.data.scheduleData;
                else if (Array.isArray(parsed?.result?.schedule)) dayArrays = parsed.result.schedule;
                else if (Array.isArray(parsed?.data?.schedule)) dayArrays = parsed.data.schedule;
            }
            
            // 1차 보정: 단일 day 객체인 경우
            if (!dayArrays && parsed && typeof parsed === 'object' && Array.isArray(parsed.activities) && Number.isFinite(parsed.day)) {
                dayArrays = [parsed];
            }
            
            // scheduleData가 없으면 에러 (디버깅 정보 포함)
            if (!dayArrays || dayArrays.length === 0) {
                const keys = parsed ? Object.keys(parsed) : [];
                throw new Error(`AI 응답에 scheduleData가 없습니다. 발견된 키: ${keys.join(', ')}`);
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
                console.warn(`[경고] AI 응답이 불완전합니다. day ${expectedEndDay}까지 생성해야 하는데 day ${actualEndDay}까지만 생성했습니다.`);
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
            
            // ===== 서버 측 검증 및 수정 =====
            // 1. appointment 검증 및 수정
            const appointmentTasks = tasksForAI.filter(t => t.type === 'appointment' && t.deadlineTime);
            if (appointmentTasks.length > 0) {
                appointmentTasks.forEach(apt => {
                    const targetDay = apt.deadline_day;
                    const targetTime = apt.deadlineTime;
                    const dayObj = finalSchedule.find(d => d.day === targetDay);
                    
                    if (!dayObj) {
                        return;
                    }
                    
                    // 해당 일정 찾기 (느슨한 제목 매칭 + 타입 확인)
                    const normalizeTitle = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, '');
                    const targetTitle = normalizeTitle(apt.title);
                    const activity = dayObj.activities.find(a => {
                        if (a.type !== 'task' && a.type !== 'appointment') return false;
                        const actTitle = normalizeTitle(a.title);
                        // 완전 일치 또는 포함 관계 확인
                        return actTitle === targetTitle || 
                               actTitle.includes(targetTitle) || 
                               targetTitle.includes(actTitle);
                    });
                    
                    if (activity) {
                        const [targetH, targetM] = targetTime.split(':').map(Number);
                        const [actualH, actualM] = (activity.start || '').split(':').map(Number);
                        
                        if (targetH !== actualH || targetM !== actualM) {
                            // 강제로 올바른 시간으로 수정
                            activity.start = targetTime;
                            const duration = apt.min_block_minutes || 60;
                            const endMinutes = (targetH * 60 + targetM + duration) % (24 * 60);
                            const endH = Math.floor(endMinutes / 60);
                            const endM = endMinutes % 60;
                            activity.end = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
                            activity.type = 'appointment';
                        } else {
                            activity.type = 'appointment';
                        }
                    } else {
                        // 강제로 추가
                        const duration = apt.min_block_minutes || 60;
                        const [targetH, targetM] = targetTime.split(':').map(Number);
                        const endMinutes = (targetH * 60 + targetM + duration) % (24 * 60);
                        const endH = Math.floor(endMinutes / 60);
                        const endM = endMinutes % 60;
                        const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
                        
                        dayObj.activities.push({
                            title: apt.title,
                            start: targetTime,
                            end: endTime,
                            type: 'appointment'
                        });
                    }
                });
            }
            
            // 2. time_preference 검증 및 수정 (전체 범위 검사)
            const morningTasks = tasksForAI.filter(t => t.timePreference === 'morning');
            if (morningTasks.length > 0) {
                morningTasks.forEach(task => {
                    // deadline_day까지의 모든 day에서 검사
                    const targetDays = finalSchedule.filter(d => 
                        d.day >= baseRelDay && d.day <= task.deadline_day
                    );
                    
                    targetDays.forEach(dayObj => {
                        // 해당 작업 찾기 (느슨한 제목 매칭)
                        const normalizeTitle = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, '');
                        const targetTitle = normalizeTitle(task.title);
                        const activity = dayObj.activities.find(a => {
                            if (a.type !== 'task' && a.type !== 'appointment') return false;
                            const actTitle = normalizeTitle(a.title);
                            return actTitle === targetTitle || 
                                   actTitle.includes(targetTitle) || 
                                   targetTitle.includes(actTitle);
                        });
                    
                        if (activity) {
                            const [startH] = (activity.start || '').split(':').map(Number);
                            // 12:00 이후에 배치되어 있으면 오전으로 이동 시도
                            if (startH >= 12) {
                                // 오전 빈 시간 찾기 (06:00~12:00)
                                const morningSlots = [];
                                const sortedActivities = [...dayObj.activities]
                                    .filter(a => {
                                        // 현재 작업이 아닌 것만 필터
                                        const aTitle = normalizeTitle(a.title);
                                        return a.type !== 'task' || aTitle !== targetTitle;
                                    })
                                    .sort((a, b) => {
                                        const [ah, am] = (a.start || '00:00').split(':').map(Number);
                                        const [bh, bm] = (b.start || '00:00').split(':').map(Number);
                                        return (ah * 60 + am) - (bh * 60 + bm);
                                    });
                                
                                // 오전 시간대 빈 슬롯 찾기
                                let lastEnd = 6 * 60; // 06:00
                                for (const act of sortedActivities) {
                                    const [sh, sm] = (act.start || '00:00').split(':').map(Number);
                                    const [eh, em] = (act.end || '00:00').split(':').map(Number);
                                    const startMin = sh * 60 + sm;
                                    const endMin = eh * 60 + em;
                                    
                                    if (startMin >= 12 * 60) break; // 오후는 무시
                                    if (startMin > lastEnd && startMin < 12 * 60) {
                                        morningSlots.push({ start: lastEnd, end: startMin });
                                    }
                                    if (endMin > lastEnd) lastEnd = endMin;
                                }
                                
                                // 12:00까지 빈 슬롯이 있으면 추가
                                if (lastEnd < 12 * 60) {
                                    morningSlots.push({ start: lastEnd, end: 12 * 60 });
                                }
                                
                                // 작업 시간 계산
                                const [actStartH, actStartM] = (activity.start || '00:00').split(':').map(Number);
                                const [actEndH, actEndM] = (activity.end || '00:00').split(':').map(Number);
                                const duration = (actEndH * 60 + actEndM) - (actStartH * 60 + actStartM);
                                
                                // 적합한 오전 슬롯 찾기
                                const suitableSlot = morningSlots.find(slot => (slot.end - slot.start) >= duration);
                                
                                if (suitableSlot) {
                                    const newStartH = Math.floor(suitableSlot.start / 60);
                                    const newStartM = suitableSlot.start % 60;
                                    const newEndMin = suitableSlot.start + duration;
                                    const newEndH = Math.floor(newEndMin / 60);
                                    const newEndM = newEndMin % 60;
                                    
                                    activity.start = `${String(newStartH).padStart(2, '0')}:${String(newStartM).padStart(2, '0')}`;
                                    activity.end = `${String(newEndH).padStart(2, '0')}:${String(newEndM).padStart(2, '0')}`;
                                }
                            }
                        }
                    });
                });
            }
            
            // 3. 사용자가 입력하지 않은 생활패턴 필터링 (선택적 - 필요시 활성화)
            // const allowedLifestyleTitles = lifestyleTexts.length > 0 
            //     ? lifestyleTexts.map(t => {
            //         const parsed = parseLifestyleString(t);
            //         return parsed ? parsed.title.toLowerCase().trim() : null;
            //     }).filter(t => t !== null)
            //     : [];
            // 
            // if (allowedLifestyleTitles.length > 0) {
            //     let removedCount = 0;
            //     finalSchedule.forEach(dayObj => {
            //         dayObj.activities = dayObj.activities.filter(act => {
            //             if (act.type === 'lifestyle') {
            //                 const actTitle = (act.title || '').toLowerCase().trim();
            //                 const isAllowed = allowedLifestyleTitles.some(allowed => 
            //                     actTitle === allowed || actTitle.includes(allowed) || allowed.includes(actTitle)
            //                 );
            //                 if (!isAllowed) {
            //                     removedCount++;
            //                     console.warn(`[⚠️ 검증] 사용자가 입력하지 않은 생활패턴 제거: day ${dayObj.day}, "${act.title}"`);
            //                     return false;
            //                 }
            //             }
            //             return true;
            //         });
            //     });
            //     if (removedCount > 0) {
            //         console.warn(`[⚠️ 검증] 총 ${removedCount}개의 허용되지 않은 생활패턴이 제거되었습니다.`);
            //     }
            // }
            
            // 4. 피드백 위반 검증 및 수정 (선택적 - 필요시 활성화)
            // if (opts.userFeedback && opts.userFeedback.trim()) {
            //     const feedbackLower = opts.userFeedback.toLowerCase();
            //     
            //     // 주말 업무 금지 확인 및 수정
            //     if (feedbackLower.includes('주말') && (feedbackLower.includes('업무') || feedbackLower.includes('작업')) && 
            //         (feedbackLower.includes('안') || feedbackLower.includes('금지') || feedbackLower.includes('하지'))) {
            //         let removedTaskCount = 0;
            //         finalSchedule.forEach(dayObj => {
            //             if (dayObj.day === 6 || dayObj.day === 7) {
            //                 dayObj.activities = dayObj.activities.filter(act => {
            //                     if (act.type === 'task') {
            //                         removedTaskCount++;
            //                         console.warn(`[⚠️ 피드백 위반 수정] 주말 업무 금지: day ${dayObj.day}, "${act.title}" 제거`);
            //                         return false;
            //                     }
            //                     return true;
            //                 });
            //             }
            //         });
            //         if (removedTaskCount > 0) {
            //             console.warn(`[⚠️ 피드백 위반 수정] 총 ${removedTaskCount}개의 주말 작업이 제거되었습니다.`);
            //         }
            //     }
            //     
            //     // 회사 끝나고 1시간 이내 작업 금지 확인 및 수정
            //     if (feedbackLower.includes('회사 끝') && feedbackLower.includes('1시간')) {
            //         let movedTaskCount = 0;
            //         finalSchedule.forEach(dayObj => {
            //             dayObj.activities = dayObj.activities.map(act => {
            //                 if (act.type === 'task') {
            //                     const actStart = act.start || '';
            //                     const actStartHour = parseInt(actStart.split(':')[0]) || 0;
            //                     if (actStartHour === 17) {
            //                         const actEnd = act.end || '';
            //                         const actEndHour = parseInt(actEnd.split(':')[0]) || 0;
            //                         const actEndMin = parseInt(actEnd.split(':')[1]) || 0;
            //                         const duration = (actEndHour * 60 + actEndMin) - (actStartHour * 60);
            //                         
            //                         const newStart = '18:00';
            //                         const newEndMinutes = 18 * 60 + duration;
            //                         const newEndHour = Math.floor(newEndMinutes / 60) % 24;
            //                         const newEndMin = newEndMinutes % 60;
            //                         const newEnd = `${String(newEndHour).padStart(2, '0')}:${String(newEndMin).padStart(2, '0')}`;
            //                         
            //                         movedTaskCount++;
            //                         console.warn(`[⚠️ 피드백 위반 수정] 회사 끝나고 1시간 이내 작업 이동: day ${dayObj.day}, "${act.title}" ${act.start} → ${newStart}`);
            //                         return { ...act, start: newStart, end: newEnd };
            //                     }
            //                 }
            //                 return act;
            //             });
            //         });
            //         if (movedTaskCount > 0) {
            //             console.warn(`[⚠️ 피드백 위반 수정] 총 ${movedTaskCount}개의 작업이 회사 종료 직후에서 이동되었습니다.`);
            //         }
            //     }
            // }
            
            // notes를 explanation에 통합 (notes가 있으면 우선 사용)
            let finalExplanation = '';
            if (notes.length > 0) {
                finalExplanation = notes.join('\n');
            } else if (explanation?.trim()) {
                finalExplanation = explanation.trim();
            }
            
            const T_END = Date.now();
            
            // AI 응답과 스케줄 생성 시간만 로그 출력
            console.log(`[AI 응답]`, JSON.stringify(parsed, null, 2));
            console.log(`[스케줄 생성 시간] ${T_END - T0}ms`);
            
            return {
                schedule: finalSchedule,
                explanation: finalExplanation,
                notes: notes,
                taxonomy: parsed.taxonomy || [],
                activityAnalysis: parsed.activityAnalysis || {},
                unplaced: parsed.unplaced || []
            };
        } catch (error) {
            const status = error.statusCode || error.response?.status;
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
            if (data?.error) {
                console.error('OpenAI 에러 타입:', data.error.type);
                console.error('OpenAI 에러 코드:', data.error.code);
                console.error('OpenAI 에러 메시지:', data.error.message);
            }
            console.error('에러 스택:', error.stack);
            console.error('===============================');
            
            if (isTimeout) {
                console.error('[⚠️ 타임아웃] OpenAI API 호출이 시간 초과되었습니다. 타임아웃 설정을 확인하세요.');
            }
            
            // 상태코드와 원본 에러 정보를 포함한 에러 객체 생성
            const enhancedError = new Error('시간표 생성 실패: ' + (data?.error?.message || error.message));
            enhancedError.statusCode = status || 500;
            enhancedError.originalError = error;
            enhancedError.openAIError = data?.error;
            throw enhancedError;
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
                                const parsed = parseLifestyleString(pattern.patternText);
                                if (parsed) {
                                    startTime = parsed.start;
                                    endTime = parsed.end;
                                } else {
                                    startTime = normalizeHHMM(pattern.start);
                                    endTime = normalizeHHMM(pattern.end);
                                }
                            } else {
                                startTime = normalizeHHMM(pattern.start);
                                endTime = normalizeHHMM(pattern.end);
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
