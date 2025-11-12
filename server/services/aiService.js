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
        for (let i = 0; i <= tries; i++) {
            try {
                return await fn();
            } catch (e) {
                const status = e.response?.status;
                const retriableHttp = [429, 500, 502, 503, 504].includes(status);
                const retriableNet = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(e.code) ||
                                    String(e.message || '').includes('timeout');
                
                if (!(retriableHttp || retriableNet) || i === tries) {
                    // 재시도 불가능하거나 마지막 시도면 원본 에러 전달 (상태코드 포함)
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
                
                scheduleLength = Math.min(28, Math.max(14, maxDeadlineDay - baseRelDay + 1)); // 최소 14일, 최대 28일 (상한선)
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
                
                // 디버깅: 원본 task 데이터 확인
                if (idx === 0) {
                    console.log('[AI Service] 첫 번째 할 일 원본 데이터:', {
                        title: task.title,
                        deadline: task.deadline,
                        deadlineTime: task.deadlineTime,
                        importance: task.importance,
                        difficulty: task.difficulty,
                        type: task.type
                    });
                }
                
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
                
                // 디버깅: deadline_day 계산 결과 확인
                if (idx === 0) {
                    console.log('[AI Service] deadline_day 계산:', {
                        deadline: task.deadline,
                        deadlineDay: deadlineDay,
                        getDeadlineDay_result: getDeadlineDay(task.deadline)
                    });
                }
                
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
                
                // 스케줄 범위 재확장 (기존 범위보다 크면 확장, 상한선 28일)
                const requiredScheduleLength = maxDeadlineDayFromTasks - baseRelDay + 1;
                const newScheduleLength = Math.min(28, Math.max(scheduleLength || 14, requiredScheduleLength));
                
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
            
            // 4) 최종 텍스트 생성 - 생활패턴을 파싱하여 각 패턴이 어떤 day에 적용되는지 명확히 나열
            const { parseLifestyleString } = require('../utils/lifestyleUtils');
            const hasWeekendPattern = lifestyleTexts.some(t => /주말|토요일|일요일|day:6|day:7/.test(t));
            const hasWeekdayOnlyPattern = lifestyleTexts.some(t => /평일/.test(t)) && !hasWeekendPattern;
            
            if (lifestyleTexts.length > 0) {
                // 각 생활패턴을 파싱하여 적용 day 명시
                const parsedPatterns = lifestyleTexts.map((text, idx) => {
                    const parsed = parseLifestyleString(text);
                    if (parsed && parsed.days) {
                        const dayNames = { 1: '월요일', 2: '화요일', 3: '수요일', 4: '목요일', 5: '금요일', 6: '토요일', 7: '일요일' };
                        const dayList = parsed.days.map(d => `day:${d}(${dayNames[d]})`).join(', ');
                        return {
                            index: idx + 1,
                            text: text,
                            title: parsed.title,
                            start: parsed.start,
                            end: parsed.end,
                            days: parsed.days,
                            dayList: dayList
                        };
                    }
                    return null;
                }).filter(p => p !== null);
                
                let lifestyleMappingSection = `\n\n**🚨🚨🚨 생활 패턴 매핑 (반드시 이대로 배치하세요)**:\n\n`;
                parsedPatterns.forEach(p => {
                    lifestyleMappingSection += `${p.index}. "${p.text}"\n`;
                    lifestyleMappingSection += `   → 적용 day: ${p.dayList}\n`;
                    lifestyleMappingSection += `   → 시간: ${p.start} ~ ${p.end}\n`;
                    lifestyleMappingSection += `   → 제목: ${p.title}\n`;
                    lifestyleMappingSection += `   → **반드시 위 day들에만 배치하세요. 다른 day에는 절대 배치하지 마세요!**\n\n`;
                });
                
                let weekendWarning = '';
                if (hasWeekdayOnlyPattern) {
                    weekendWarning = `\n\n🚨🚨🚨 **절대 금지 - 주말 생활패턴 자동 추가 금지**:\n` +
                        `- 사용자가 입력한 생활 패턴은 모두 "평일" 패턴입니다.\n` +
                        `- **주말(day:6 토요일, day:7 일요일)에는 사용자가 입력하지 않은 생활 패턴을 절대 추가하지 마세요.**\n` +
                        `- 주말(day:6, day:7)의 activities 배열은 비워두거나 할 일만 배치하세요.\n` +
                        `- ⚠️ **절대 금지**: 주말에 취침, 식사, 자유시간 등 어떤 생활 패턴도 자동으로 추가하지 마세요!\n` +
                        `- ⚠️ **검증 필수**: 생성 후 반드시 확인하세요. 주말(day:6, day:7)에 사용자가 입력하지 않은 생활 패턴이 있다면 즉시 제거하세요!`;
                }
                
                lifestyleTextDisplay = `\n\n**사용자가 입력한 생활 패턴 (원본 텍스트):**\n${lifestyleTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}${lifestyleMappingSection}\n⚠️ **위 생활 패턴들은 반드시 type: "lifestyle"로 배치하고, 매핑된 day에만 정확히 배치하세요.**${weekendWarning}`;
            } else {
                console.warn('[AI Service] 생활패턴 원본 텍스트가 없습니다!');
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
                    feedbackSection += `\n\n🚨🚨🚨🚨🚨 **아침/오전 시간대 선호도 (최우선 반영 필수 - 절대 위반 금지)**:\n` +
                        `- 사용자가 아침/오전 시간대에 작업을 선호한다고 **명시적으로** 요청했습니다.\n` +
                        `- 🚨🚨🚨 **절대 금지**: 오전 시간대(06:00~12:00)가 비어있는데도 오후 시간대(12:00 이후)에 작업을 배치하는 것은 **심각한 피드백 위반**입니다.\n` +
                        `- 🚨🚨🚨 **배치 순서 (절대 준수)**: 1) 오전 시간대(06:00~12:00)에 먼저 배치 → 2) 오전 시간대가 모두 채워진 후에도 작업이 남으면 그때만 오후 시간대(12:00 이후, 피드백 제약 이후) 사용\n` +
                        `- 평일에는 회사(08:00~17:00)가 있으므로, 회사 전(06:00~08:00) 시간대를 **반드시 우선 활용**하세요. 오전 시간대가 비어있는데 회사 후(18:00 이후)에 배치하는 것은 **절대 금지**입니다.\n` +
                        `- 🚨🚨🚨 **검증 필수**: 생성 후 반드시 확인하세요. 오전 시간대(06:00~12:00)가 비어있는데 오후에 작업이 배치되었다면 즉시 오전으로 이동하세요.`;
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
                const hasWeekendWorkKeyword = feedbackLower.includes('업무') || feedbackLower.includes('일할') || 
                                      feedbackLower.includes('작업') || feedbackLower.includes('생성') ||
                                      feedbackLower.includes('배치');
                if (hasWeekendKeyword && hasWeekendWorkKeyword) {
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
                    detectedPatterns.push('회사 끝나고 작업 금지');
                    feedbackSection += `\n\n🚨🚨🚨 **회사 끝나고/퇴근 후 작업 금지 (최우선 반영 필수 - 절대 위반 금지)**:\n` +
                        `- 사용자가 회사가 끝난 후(퇴근 후) 1시간 이내에는 작업을 배치하지 않기를 원합니다.\n` +
                        `- **회사가 끝나는 시간(예: 17:00) 이후 최소 1시간(예: 18:00까지) 동안에는 할 일(task)을 절대 배치하지 마세요.**\n` +
                        `- 예: 회사가 17:00에 끝나면, 할 일은 18:00 이후에만 배치하세요. 17:00~18:00 사이에는 절대 배치하지 마세요.\n` +
                        `- ⚠️ **절대 금지**: 회사 종료 시간 직후에 할 일을 배치하는 것은 심각한 피드백 위반입니다.\n` +
                        `- ⚠️ **검증 필수**: 생성 후 반드시 확인하세요. 회사 종료 시간 직후에 할 일이 배치되었다면 즉시 1시간 이후로 이동하세요.`;
                }
                
                // 6. 출근 직후 작업 금지 감지
                if (feedbackLower.includes('출근') && (feedbackLower.includes('바로') || feedbackLower.includes('다음')) &&
                    (feedbackLower.includes('일') || feedbackLower.includes('작업') || feedbackLower.includes('배치')) &&
                    (feedbackLower.includes('안') || feedbackLower.includes('금지') || feedbackLower.includes('ㄴㄴ'))) {
                    detectedPatterns.push('출근 직후 작업 금지');
                    feedbackSection += `\n\n⚠️⚠️⚠️ **출근 직후 작업 금지 (최우선 반영 필수)**:\n` +
                        `- 사용자가 출근 직후(회사 시작 직후)에는 작업을 배치하지 않기를 원합니다.\n` +
                        `- **출근 시간(예: 08:00) 직후 1시간 동안(예: 08:00~09:00)에는 할 일(task)을 배치하지 마세요.**\n` +
                        `- 출근 직후 시간대는 생활 패턴(회사)만 배치하고, 할 일은 배치하지 마세요.\n` +
                        `- ⚠️ **절대 금지**: 출근 직후 시간대에 할 일을 배치하는 것은 피드백 위반입니다.`;
                }
                
                // 7. 점심 시간대 작업 금지 감지
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
                content: `당신은 사용자의 **생활 패턴(lifestyle)**과 **할 일(tasks)**, 그리고 **피드백(feedback)**을 바탕으로 **현실적인 2주 스케줄**을 설계하는 전문가입니다.

# 0) 우선순위 체계 (충돌 시 아래 순서로 우선 적용)
1. 사용자가 명시한 **피드백/제약** (\`feedbackSection\`)
2. **생성 범위 규칙** (day ${finalStartDay} ~ day ${finalEndDay} 전체 생성)
3. **평일/주말 매핑 규칙** + **시간 파싱 규칙**
4. 일반 배치 규칙(빈 시간 계산 → 우선순위 배치 → 휴식 간격 등)

${feedbackSection ? `\n## 사용자 피드백 (최우선 반영)
${feedbackSection}${emptyTimeGuide}
` : '\n## 사용자 피드백: (없음)\n'}

# 1) 용어/매핑 규칙
- **day 번호 체계**: day:1(월) ~ day:7(일) 반복. 현재 기준 day = ${anchorDay}.
- **평일(weekday)**: day:1~5만. **주말(weekend)**: day:6~7만.
- **생활 패턴(lifestyle)**: 사용자가 명시한 고정 일정. **반드시 type:"lifestyle"**.
  - 평일 패턴 → **day:1~5에만** 반복 배치
  - 주말 패턴 → **day:6~7에만** 반복 배치
  - 매일 패턴 → **day:1~7 모두** 반복 배치
  - 🚨🚨🚨 **절대 금지**: 사용자가 **입력하지 않은** 생활 패턴(자유 시간, 운동, 식사, 브런치 등)을 **절대 추가하지 마세요**. 오직 사용자가 명시적으로 입력한 생활 패턴만 배치하세요.
  - 생활 패턴끼리 **겹칠 수 있음**(허용). 단, **할 일과는 겹치면 안 됨**.
- **할 일(task)**: 빈 시간에 배치하는 작업. **type:"task"**.
- **약속(appointment)**: 특정 날짜/시간 고정 일정. **type:"appointment"**.
  - appointment는 **deadline_day + deadline_time을 정확히 준수**해야 함.

# 2) 시간 파싱(한국어) — 오전/오후 정확 구분
- "오전" = 00:00~11:59, "오후" = 12:00~23:59
- 예) 오전 1시=01:00, 오전 8시=08:00, 오후 12시=12:00, 오후 1시=13:00, 저녁 9시=21:00, 밤 11시=23:00
- ⚠️ "오전 1시"를 21:00으로 파싱하는 오류 **금지**.

# 3) 생성 범위
- **반드시 day ${finalStartDay} ~ day ${finalEndDay}**까지 **연속한 ${scheduleLength}개** day 객체를 생성.
- 마지막 day는 **반드시 ${finalEndDay}**. 중간에서 끊기면 실패.

# 4) 절차(반드시 이 순서)
**1단계. 생활 패턴 배치**
- 아래 매핑을 정확히 반영해 day별로 **type:"lifestyle"** 활동을 먼저 채운다.
${lifestyleTextDisplay}
- 평일/주말/매일 규칙을 **엄수**한다.
- 사용자가 주말 패턴을 주지 않았다면 **주말 day:6,7은 lifestyle을 배치하지 않는다**(비워둘 수 있음).

**2단계. 빈 시간 계산**
- lifestyle을 배치한 뒤 day별 **빈 시간대 목록**을 만든다(자정 넘어감도 계산).
- 🚨🚨🚨 **빈 시간 계산 규칙 (매우 중요)**:
  - 하루는 00:00~24:00 (또는 00:00~다음날 00:00)로 구성됩니다.
  - lifestyle을 배치한 후, **남은 모든 시간대**를 빈 시간으로 계산하세요.
  - 예: 평일에 취침(01:00~06:00), 회사(08:00~17:00), 작업(18:00~19:30)이 있으면:
    * 빈 시간: 06:00~08:00 (취침 후 ~ 회사 전)
    * 빈 시간: 19:30~01:00 (작업 후 ~ 다음날 취침 전, 자정 넘어감)
  - 🚨🚨🚨 **절대 금지**: 자정을 넘어가는 시간대(예: 19:30~01:00)를 빈 시간에서 제외하지 마세요. 반드시 포함하세요.
  - 모든 빈 시간대를 **완전히** 나열하세요. 일부만 나열하는 것은 절대 금지입니다.
- 피드백 제약(예: *회사 후 1시간 금지*, *주말 업무 금지* 등)을 빈 시간에서 **제외**한다.
${hasMorningPreferenceGlobal ? `- 사용자가 **아침형 선호**라면 06:00~12:00 빈 시간을 우선 고려한다.` : ''}

**3단계. 작업 우선순위 산정**
- Eisenhower(+남은일수)로 우선순위를 산정:
  - 마감 임박 & 중요도='상' & 난이도='상' → 최우선(매일 배치)
  - 그 외 긴급/중요/난이도에 따라 순위 결정
- 블록 권장: 기본 60~120분, 임박·난이도 상이면 120분 이상도 허용.

**4단계. 작업 배치**
- 🚨🚨🚨 **오늘(day:${finalStartDay})부터 즉시 배치 시작**: 모든 작업은 **오늘(day:${finalStartDay})부터 배치를 시작**해야 합니다. 내일이나 다음 주부터 배치하는 것은 절대 금지입니다.
- **appointment**: \`deadline_day\`의 \`deadline_time\`에 **정확히** 배치.
- **task**:
  - \`deadline_time\`이 있더라도 **"마감 시각" 의미**로 취급(그 시각에 고정 배치하지 않음). 마감 **이전** 빈 시간에 배치.
  - 🚨🚨🚨 **오늘부터 배치**: **중요도='상' AND 난이도='상'** 작업은 **반드시 오늘(day:${finalStartDay})부터** 배치를 시작하고, 생성 범위 내 **매일** 배치(주말 허용 정책에 따름). 오늘을 건너뛰고 내일부터 배치하는 것은 절대 금지입니다.
  - 우선순위 높은 작업부터 빈 시간대에 배치.
  - ${hasMorningPreferenceGlobal ? `🚨🚨🚨 **아침형 선호 (절대 위반 금지)**: 사용자가 오전 시간대를 선호한다고 명시했습니다. **반드시 오전 시간대(06:00~12:00)에 먼저 배치**하고, 오전 시간대가 모두 채워진 후에도 작업이 남으면 그때만 오후 시간대(12:00 이후, 피드백 제약 이후)를 사용하세요. 오전 시간대가 비어있는데 오후에 배치하는 것은 **심각한 피드백 위반**입니다.` : `시간대 선호가 없으면 빈 시간을 자유롭게 활용.`}
- **겹침 금지**: 모든 task/appointment는 서로 겹치지 않는다.
- **휴식**: 인접 작업 사이 **최소 30분** 휴식 확보.

**5단계. 주말 정책**
- 🚨🚨🚨🚨🚨 **주말 업무 금지 (절대 위반 금지)**: 피드백에 **주말 업무 금지**가 명시되어 있으면 day:6(토요일)과 day:7(일요일)에는 **절대 tasks를 배치하지 마세요**. 주말에 할 일을 배치하면 **생성 실패**입니다.
- 🚨🚨🚨 **검증 필수**: 생성 후 반드시 day:6과 day:7을 확인하세요. 주말 업무 금지 피드백이 있는데 주말에 task가 배치되었다면 즉시 제거하세요.
- 피드백이 없으면 주말에도 배치 가능(특히 중요·난이도 상은 주말 활용 권장).

# 5) 출력 형식 (JSON)
아래 스키마로만 출력한다.

\`\`\`json
{
  "scheduleData": [
    {
      "day": ${finalStartDay},
      "weekday": "토요일",
      "activities": [
        { "start": "21:00", "end": "07:00", "title": "취침", "type": "lifestyle" }
      ]
    }
    // ... day ${finalEndDay}까지 연속 생성 (총 ${scheduleLength}개)
  ],
  "notes": [
    "빈 시간 요약: 평일 06:00~08:00(2h), 18:00~22:00(4h) / 주말 07:00~12:00(5h), 13:00~15:00(2h), 18:00~22:00(4h)",
    "배치 전략: '오픽 준비'(상/상)를 평일 오전 1h + 저녁 1h, 주말 오전 3h로 분산 배치",
    "피드백 반영: 회사 후 1h 금지 적용, 아침형 선호 반영"
  ]
}
\`\`\`

# 6) 입력 (tasks만 배치)

\`\`\`json
{ "tasks": ${JSON.stringify(tasksForAIJSON, null, 2)} }
\`\`\`

# 7) 검증 체크리스트 (생성 전·후)

* [ ] \`scheduleData.length === ${scheduleLength}\` 인가?
* [ ] 첫 day는 ${finalStartDay}, 마지막 day는 **${finalEndDay}** 인가?
* [ ] **오늘(day:${finalStartDay})부터 작업이 배치되었나?** 오늘을 건너뛰고 내일부터 배치했다면 즉시 오늘부터 배치하세요.
* [ ] lifestyle는 **type:"lifestyle"**로만, 평일/주말/매일 규칙을 어기지 않았나?
* [ ] 사용자가 **입력하지 않은** lifestyle가 추가되지 않았나? (있으면 제거)
* [ ] **주말 업무 금지 피드백이 있는데 day:6, day:7에 task가 배치되었나?** 있다면 즉시 제거하세요.
* [ ] **오전 선호 피드백이 있는데 오전 시간대(06:00~12:00)가 비어있는데 오후에 작업이 배치되었나?** 있다면 즉시 오전으로 이동하세요.
* [ ] appointment는 지정된 **deadline_day + time**에 정확히 배치했나?
* [ ] task는 빈 시간대에만, 마감 **이전**에 배치했나?
* [ ] 작업 간 겹침 없음, 인접 작업 사이 **30분 휴식** 반영했나?
* [ ] notes에 **빈 시간 요약 / 배치 전략 / 피드백 반영**을 **구체적으로** 기술했나?`
            };

            // 시스템 프롬프트를 맨 앞에 추가
            const enhancedMessages = [systemPrompt, ...userMessages]
                .filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
            
            // 핵심 정보만 로깅
            console.log('[AI Service] 생활패턴:', lifestyleTexts.length, '개');
            console.log('[AI Service] 할 일:', existingTasks.length, '개');
            console.log('[AI Service] 피드백:', opts.userFeedback ? '있음' : '없음');

            // 타이밍 로그 시작
            const T0 = Date.now();
        
            const basePayload = {
                model: 'gpt-4o-mini',
                messages: enhancedMessages,
                temperature: 0.3,
                response_format: { type: 'json_object' }
            };
            
            // 프롬프트 길이 체크 (대략적 토큰 추정: 1토큰 ≈ 4자)
            const totalChars = systemPrompt.content.length + userMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
            const approxTokens = Math.ceil(totalChars / 4);
            
            if (approxTokens > 120000) { // gpt-4o-mini 컨텍스트 한계 대략 128k
                console.warn('[⚠️ 경고] 프롬프트가 매우 깁니다 (', approxTokens, '토큰). 일부 메시지를 축약합니다.');
                // userMessages를 최근 3개로 제한
                userMessages = userMessages.slice(-3);
            }
            
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
                        const T4 = Date.now();
                        console.log('[타이밍] OpenAI 스트리밍 응답 시간:', T4 - T3, 'ms');
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
                const T3 = Date.now();
                parsed = await this.callWithRetry(() => nonStreamCall(basePayload));
                const T4 = Date.now();
                console.log('[타이밍] OpenAI 응답 시간:', T4 - T3, 'ms, 총 소요:', T4 - T0, 'ms');
            } catch (e1) {
                console.warn('[⚠️ 비스트리밍 실패] 스트리밍으로 폴백');
                try {
                    const T3 = Date.now();
                    parsed = await streamCall(basePayload);
                    const T4 = Date.now();
                    console.log('[타이밍] OpenAI 스트리밍 응답 시간:', T4 - T3, 'ms, 총 소요:', T4 - T0, 'ms');
                } catch (e2) {
                    console.warn('[⚠️ 스트리밍도 실패] JSON 모드 해제로 최종 폴백:', e2.message);
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
            
            // 1차 보정: 단일 day 객체인 경우
            if (!dayArrays && parsed && typeof parsed === 'object' && Array.isArray(parsed.activities) && Number.isFinite(parsed.day)) {
                dayArrays = [parsed];
            }
            
            // scheduleData가 없으면 에러
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
            
            // AI 생성 스케줄 디버깅 출력
            console.log('[📅 AI 생성 스케줄]');
            console.log(JSON.stringify(finalSchedule, null, 2));
            
            // ===== 서버 측 검증 및 수정 (주석 처리 - AI가 잘 지키는지 테스트) =====
            /*
            // 1. 사용자가 입력하지 않은 생활패턴 필터링
            const allowedLifestyleTitles = lifestyleTexts.length > 0 
                ? lifestyleTexts.map(t => {
                    const parsed = parseLifestyleString(t);
                    return parsed ? parsed.title.toLowerCase().trim() : null;
                }).filter(t => t !== null)
                : [];
            
            if (allowedLifestyleTitles.length > 0) {
                let removedCount = 0;
                finalSchedule.forEach(dayObj => {
                    const originalLength = dayObj.activities.length;
                    dayObj.activities = dayObj.activities.filter(act => {
                        if (act.type === 'lifestyle') {
                            const actTitle = (act.title || '').toLowerCase().trim();
                            const isAllowed = allowedLifestyleTitles.some(allowed => 
                                actTitle === allowed || actTitle.includes(allowed) || allowed.includes(actTitle)
                            );
                            if (!isAllowed) {
                                removedCount++;
                                console.warn(`[⚠️ 검증] 사용자가 입력하지 않은 생활패턴 제거: day ${dayObj.day}, "${act.title}"`);
                                return false;
                            }
                        }
                        return true;
                    });
                });
                if (removedCount > 0) {
                    console.warn(`[⚠️ 검증] 총 ${removedCount}개의 허용되지 않은 생활패턴이 제거되었습니다.`);
                }
            }
            
            // 2. 피드백 위반 검증 및 수정
            if (opts.userFeedback && opts.userFeedback.trim()) {
                const feedbackLower = opts.userFeedback.toLowerCase();
                
                // 2-1. 주말 업무 금지 확인 및 수정
                if (feedbackLower.includes('주말') && (feedbackLower.includes('업무') || feedbackLower.includes('작업')) && 
                    (feedbackLower.includes('안') || feedbackLower.includes('금지') || feedbackLower.includes('하지'))) {
                    let removedTaskCount = 0;
                    finalSchedule.forEach(dayObj => {
                        if (dayObj.day === 6 || dayObj.day === 7) {
                            const originalLength = dayObj.activities.length;
                            dayObj.activities = dayObj.activities.filter(act => {
                                if (act.type === 'task') {
                                    removedTaskCount++;
                                    console.warn(`[⚠️ 피드백 위반 수정] 주말 업무 금지: day ${dayObj.day}, "${act.title}" 제거`);
                                    return false;
                                }
                                return true;
                            });
                        }
                    });
                    if (removedTaskCount > 0) {
                        console.warn(`[⚠️ 피드백 위반 수정] 총 ${removedTaskCount}개의 주말 작업이 제거되었습니다.`);
                    }
                }
                
                // 2-2. 회사 끝나고 1시간 이내 작업 금지 확인 및 수정
                if (feedbackLower.includes('회사 끝') && feedbackLower.includes('1시간')) {
                    let movedTaskCount = 0;
                    finalSchedule.forEach(dayObj => {
                        dayObj.activities = dayObj.activities.map(act => {
                            if (act.type === 'task') {
                                const actStart = act.start || '';
                                const actStartHour = parseInt(actStart.split(':')[0]) || 0;
                                // 회사가 17:00에 끝나고, 작업이 17:00~18:00 사이에 시작하면 18:00 이후로 이동
                                if (actStartHour === 17) {
                                    const actEnd = act.end || '';
                                    const actEndHour = parseInt(actEnd.split(':')[0]) || 0;
                                    const actEndMin = parseInt(actEnd.split(':')[1]) || 0;
                                    const duration = (actEndHour * 60 + actEndMin) - (actStartHour * 60);
                                    
                                    // 18:00 이후로 이동
                                    const newStart = '18:00';
                                    const newEndMinutes = 18 * 60 + duration;
                                    const newEndHour = Math.floor(newEndMinutes / 60) % 24;
                                    const newEndMin = newEndMinutes % 60;
                                    const newEnd = `${String(newEndHour).padStart(2, '0')}:${String(newEndMin).padStart(2, '0')}`;
                                    
                                    movedTaskCount++;
                                    console.warn(`[⚠️ 피드백 위반 수정] 회사 끝나고 1시간 이내 작업 이동: day ${dayObj.day}, "${act.title}" ${act.start} → ${newStart}`);
                                    return { ...act, start: newStart, end: newEnd };
                                }
                            }
                            return act;
                        });
                    });
                    if (movedTaskCount > 0) {
                        console.warn(`[⚠️ 피드백 위반 수정] 총 ${movedTaskCount}개의 작업이 회사 종료 직후에서 이동되었습니다.`);
                    }
                }
            }
            
            // 검증 후 최종 스케줄 로그
            console.log('[✅ 검증 완료 스케줄]');
            console.log(JSON.stringify(finalSchedule, null, 2));
            */
            
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
