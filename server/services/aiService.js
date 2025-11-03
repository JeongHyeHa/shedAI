const axios = require('axios');
const https = require('https');
const { hhmm, normalizeHHMM, timeToMinutes, minutesToTime, mapDayToWeekday, relDayToWeekdayNumber, extractAllowedDays } = require('../utils/scheduleUtils');
const { convertLifestyleToBusy, parseLifestyleString } = require('../utils/lifestyleUtils');
const { calculateFreeWindows, splitLargeFreeWindows } = require('../utils/freeWindowsUtils');
const { mergeAIPlacements } = require('./scheduleValidator');

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

    // 모든 유틸리티 함수들은 utils에서 직접 import하여 사용

    // 검증 및 재배치는 scheduleValidator.js로 이동됨
    validateAndRepair(placements, freeWindows, tasksById, now, baseRelDay, busy, weekendPolicy = 'allow') {
        const { validateAndRepair: validate } = require('./scheduleValidator');
        return validate(placements, freeWindows, tasksById, now, baseRelDay, busy, weekendPolicy);
    }

    // AI placements 병합은 scheduleValidator.js로 이동됨
    mergeAIPlacements({ baseDate, busy, placements, breaks, tasksById, freeWindows = null, weekendPolicy = 'allow' }) {
        return mergeAIPlacements({ baseDate, busy, placements, breaks, tasksById, freeWindows, weekendPolicy });
    }

    // 스케줄 생성 (새 아키텍처: busy 고정, AI는 할 일 배치만)
    async generateSchedule(messages, lifestylePatterns = [], existingTasks = [], opts = {}) {
        try {
            // API 키 상태 로깅 (개발 모드에서만)
            if (process.env.NODE_ENV !== 'production') {
                console.log('[aiService.generateSchedule] OpenAI API 키 상태:', {
                    hasKey: !!this.openaiApiKey,
                    keyLength: this.openaiApiKey ? this.openaiApiKey.length : 0,
                    keyPrefix: this.openaiApiKey ? this.openaiApiKey.substring(0, 10) + '...' : 'none'
                });
            }
            
            // API 키 검증 - 개발 모드에서는 더미 데이터 반환
            if (!this.openaiApiKey) {
                console.log('[개발 모드] OpenAI API 키가 없어서 더미 스케줄을 생성합니다.');
                return this.generateDummySchedule(lifestylePatterns, existingTasks, opts);
            }
            
            console.log('[aiService.generateSchedule] 실제 OpenAI API를 사용하여 스케줄을 생성합니다.');
            console.log('[aiService.generateSchedule] 전달받은 할 일 개수:', existingTasks.length);
            if (existingTasks.length > 0) {
                console.log('[aiService.generateSchedule] 할 일 목록:', existingTasks.map(t => `${t.title} (${t.deadline})`));
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
            
            if (forcedToday) {
                // "오늘까지" 작업: 작업은 오늘만, 생활패턴은 7일치
                taskDays = [baseRelDay];                  // 오늘만
                lifestyleDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);  // 14일 연속
            } else if (forcedTomorrow) {
                // "내일까지" 작업: 작업은 내일만, 생활패턴은 7일치
                taskDays = [baseRelDay + 1];              // 내일만
                lifestyleDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);
            } else if (hasSpecificDate) {
                // 특정 날짜 작업: 해당 날짜에만 작업, 생활패턴은 7일치
                const extractedDays = extractAllowedDays(messages);
                taskDays = extractedDays;
                lifestyleDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);
            } else if (hasDeadline) {
                // 마감일이 있는 작업: 오늘부터 마감일까지 연속된 스케줄 생성
                const extractedDays = extractAllowedDays(messages);
                if (extractedDays.length > 0) {
                    const maxDay = Math.max(...extractedDays);
                    taskDays = Array.from({ length: maxDay - baseRelDay + 1 }, (_, i) => baseRelDay + i);
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
                }
                lifestyleDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);
            } else {
                // 일반 작업: 오늘부터 7일간, 생활패턴은 7일치
                taskDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);
                lifestyleDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);
            }
            
            const allowedDays = [...new Set([...taskDays, ...lifestyleDays])].sort((a,b)=>a-b);
            const anchorDay = opts.anchorDay ?? (allowedDays.length ? allowedDays[0] : (dayOfWeek===0?7:dayOfWeek));
            
            // 날짜 및 사용자 입력 분석 완료
            
            // === 새 아키텍처: busy 배열 생성 ===
            // lifestyle patterns를 busy로 변환 (고정 구간)
            let busy = convertLifestyleToBusy(lifestylePatterns, now, allowedDays);
            
            // 고정 일정(event/appointment)을 tasks에서 분리하여 busy에 추가
            // 수정: "준비/공부/연습"이 포함된 작업은 task로 남김
            const fixedEvents = [];
            const tasksOnly = [];
            
            // 고정 일정 키워드
            const EVENT_KEYWORDS = ['회의', '미팅', '수업', '세미나', '발표', '진료', '인터뷰', '약속', '행사', '촬영', '면담', '상담', '강의'];
            // 이벤트가 아닌 힌트 (준비/공부/연습이 포함되면 task로 처리)
            const NON_EVENT_HINTS = ['준비', '공부', '연습'];
            for (const task of (existingTasks || [])) {
                const taskType = task.type || 'task';
                const taskTitle = (task.title || '').trim();
                
                // 이벤트 판정: 키워드와 힌트 체크
                const hasEventKeyword = EVENT_KEYWORDS.some(k => taskTitle.includes(k));
                const hasNonEventHint = NON_EVENT_HINTS.some(k => taskTitle.includes(k));
                
                // "준비/공부/연습"이 포함되면 무조건 task로 처리 (deadlineTime이 있어도 task)
                // 예: "발표 준비", "시험 준비", "인턴 프로젝트 발표 준비", "오픽 시험 준비"
                if (hasNonEventHint) {
                    // "준비" 등 힌트가 있으면 task로 처리
                    tasksOnly.push(task);
                    continue;
                }
                
                // 이벤트 판정: "준비" 힌트가 없을 때만 이벤트 판정
                const isEvent = 
                    (taskType === 'appointment' || taskType === 'event') ||
                    (task.deadlineTime) ||
                    (hasEventKeyword);
                
                if (isEvent) {
                    // 1) 날짜 산출: deadline | date | startDate | occursOn(day) 순서
                    let eventDate = null;
                    if (task.deadline) {
                        eventDate = new Date(task.deadline);
                    } else if (task.deadlineAtMidnight) {
                        eventDate = new Date(task.deadlineAtMidnight);
                    } else if (task.date) {
                        eventDate = new Date(task.date);
                    } else if (task.startDate) {
                        eventDate = new Date(task.startDate);
                    }
                    
                    // occursOn이 상대 day 숫자로 들어오는 경우도 허용
                    let taskDay = null;
                    if (eventDate instanceof Date && !isNaN(eventDate.getTime())) {
                        // 타임존 문제 방지: 날짜만 비교 (자정 기준)
                        const eventMidnight = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
                        const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                        const msDiff = eventMidnight.getTime() - nowMidnight.getTime();
                        // 미래 날짜는 올림, 과거 날짜는 내림 (0일 깎임 방지)
                        const daysDiff = msDiff >= 0 
                            ? Math.ceil(msDiff / (1000 * 60 * 60 * 24))   // 미래는 올림
                            : Math.floor(msDiff / (1000 * 60 * 60 * 24)); // 과거는 내림
                        taskDay = baseRelDay + daysDiff;
                    } else if (Number.isFinite(task.occursOn)) {
                        taskDay = task.occursOn;
                    }
                    
                    // 2) 시간 산출: start/end 우선, 없으면 startTime+duration, 마지막으로 deadlineTime+duration
                    let start = null, end = null;
                    if (task.start && task.end) {
                        start = normalizeHHMM(task.start);
                        end = normalizeHHMM(task.end);
                    } else if (task.startTime && (task.endTime || task.durationMin || task.estimatedMinutes)) {
                        start = normalizeHHMM(task.startTime);
                        const dur = task.durationMin || task.estimatedMinutes || 60;
                        if (task.endTime) {
                            end = normalizeHHMM(task.endTime);
                        } else {
                            end = minutesToTime(timeToMinutes(start) + dur);
                        }
                    } else if (task.deadlineTime && (task.durationMin || task.estimatedMinutes)) {
                        start = normalizeHHMM(task.deadlineTime);
                        const dur = task.durationMin || task.estimatedMinutes || 60;
                        end = minutesToTime(timeToMinutes(start) + dur);
                    }
                    
                    if (taskDay && start && end && allowedDays.includes(taskDay)) {
                        fixedEvents.push({
                            day: taskDay,
                            start,
                            end,
                            title: taskTitle,
                            source: 'event'
                        });
                        console.log(`[새 아키텍처] 고정 일정으로 분리: ${taskTitle} → day ${taskDay}, ${start}-${end}`);
                    } else {
                        console.warn(`[새 아키텍처] 고정 일정 판단 but 필수값 부족/범위 외: title=${taskTitle}, taskDay=${taskDay}, start=${start}, end=${end}, allowedDays=${allowedDays.includes(taskDay ? taskDay : -1)}`);
                    }
      } else {
                    // task만 tasksOnly에 추가
                    tasksOnly.push(task);
                }
            }
            
            // busy에 고정 일정 추가
            busy = [...busy, ...fixedEvents];
            console.log('[새 아키텍처] busy 블록 개수 (lifestyle + events):', busy.length);
            console.log('[새 아키텍처] 고정 일정(event) 개수:', fixedEvents.length);
            
            // tasks를 새 스키마로 변환 (taskId 추가) - task만 포함 + 전략 주입
            const tasksById = {};
            
            // 마감일까지 일수 계산 헬퍼
            const daysUntil = (deadline) => {
                if (!deadline) return 999;
                const deadlineDate = deadline instanceof Date ? deadline : new Date(deadline);
                const diffTime = deadlineDate.getTime() - now.getTime();
                return Math.floor(diffTime / (1000 * 60 * 60 * 24));
            };
            
            // day별 deadline_day 계산
            const getDeadlineDay = (deadline) => {
                if (!deadline) return 999;
                const deadlineDate = deadline instanceof Date ? deadline : new Date(deadline);
                const diffTime = deadlineDate.getTime() - now.getTime();
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                return baseRelDay + diffDays;
            };
            
                const tasksForAI = tasksOnly.map((task, idx) => {
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
                
                const deadlineDay = getDeadlineDay(task.deadline);
                
                // 중요도와 난이도가 모두 상이면 매일 배치 필요
                const bothHigh = highPriority && highDifficulty;
                
                const taskForAI = {
                    id: taskId,
                    title: task.title,
                    deadline_day: deadlineDay,
                    priority: highPriority ? '상' : (task.importance === '중' ? '중' : '하'),
                    difficulty: highDifficulty ? '상' : (task.difficulty === '중' ? '중' : '하'),
                    min_block_minutes: minBlockMinutes,
                    prefer_around: task.preferNear || '19:00',
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
            // tasksForAI 개수만 로깅 (상세 로그 제거)
            
            // === freeWindows 계산 ===
            // 수정: 개선된 calculateFreeWindows 사용 (겹침 병합, 경계 클램핑, nowFloor 지원)
            // free windows: 검증용(raw)과 프롬프트용(split) 분리
            let freeWindows = {};
            let freeWindowsRaw = {};
            try {
                // 오늘(첫 번째 day)의 지난 시간 제외 옵션
                const firstDay = allowedDays[0];
                const isToday = firstDay === baseRelDay;
                
                freeWindowsRaw = calculateFreeWindows(busy, allowedDays, '23:59', {
                    workdayStart: '00:00',
                    nowFloor: isToday,  // 오늘이면 지난 시간 제외 (완화: 아래 스냅으로 보완)
                    baseNow: now,
                    minMinutes: 30
                });
                
                // 큰 free window를 2시간 단위로 분할 (최대한 활용)
                freeWindows = splitLargeFreeWindows(freeWindowsRaw, 120, 60); // 2시간 단위, 최소 1시간 (프롬프트용)
            } catch (fwError) {
                console.error('[새 아키텍처] freeWindows 계산 실패:', fwError);
                console.error('busy:', busy);
                console.error('allowedDays:', allowedDays);
                // 빈 freeWindows로 계속 진행 (검증은 스킵됨)
                freeWindowsRaw = {};
                freeWindows = {};
            }
            
            // 오늘 배치 완화: 오늘 배치 제안은 now+5분 이후로 스냅
            try {
                const padMinutes = 5;
                const toMin = (s) => {
                    const [h, m] = String(s || '00:00').split(':').map(x => parseInt(x || '0', 10));
                    return (h || 0) * 60 + (m || 0);
                };
                const toTime = (m) => minutesToTime(m);
                if (Array.isArray(placements)) {
                    const nowMin = now.getHours() * 60 + now.getMinutes() + padMinutes;
                    for (const p of placements) {
                        if (!p || (p.day !== baseRelDay)) continue;
                        const dur = toMin(p.end) - toMin(p.start);
                        const pStart = toMin(p.start);
                        if (pStart < nowMin) {
                            const newStart = nowMin;
                            const newEnd = newStart + Math.max(dur, 0);
                            p.start = toTime(newStart);
                            p.end = toTime(newEnd);
                        }
                    }
                }
            } catch (snapErr) {
                console.warn('[새 아키텍처] 오늘 배치 스냅 중 경고:', snapErr?.message);
            }
            
            // 사용자 메시지만 최근 6개 유지
            let userMessages = (messages || []).filter(m => m && m.role === 'user').slice(-6);
            
            // === 새 아키텍처: 프롬프트 재작성 (간소화) ===
            // AI에는 규칙 힌트만, 보장은 서버에서
            // freeWindowsList 정규화 (start/end 시간 정규화)
            const freeWindowsList = Object.keys(freeWindows).map(day => ({
                day: parseInt(day, 10),
                free_windows: (freeWindows[day] || []).map(w => ({
                    start: normalizeHHMM(w.start),
                    end: normalizeHHMM(w.end)
                }))
            }));
            
            // AI에 넘길 tasks (간소화된 스키마)
            const tasksForAIJSON = tasksForAI.map(t => ({
                id: t.id,
                title: t.title,
                deadline_day: t.deadline_day,
                priority: t.priority,
                difficulty: t.difficulty,
                min_block_minutes: t.min_block_minutes,
                prefer_around: t.prefer_around
            }));
            
            // 주말 정책 확인 (사용자 피드백 또는 기본 설정)
            // 수정: 기본 허용, 사용자가 명시적으로 "주말은 하지 말아줘"라고 했을 때만 차단
            let weekendPolicy = 'allow'; // 기본: 주말 허용
            
            // 인용/코드/따옴표 제거 (메타 설명 무시)
            const raw = userMessages.map(m => m.content || '').join('\n');
            const clean = raw
                .replace(/```[\s\S]*?```/g, ' ')
                .replace(/"[^"]*"/g, ' ')
                .replace(/'[^']*'/g, ' ')
                .replace(/`[^`]*`/g, ' ')
                .toLowerCase();
            
            // 명시적 차단/허용 패턴
            const weekendOptOut = /(주말(?:엔|에는)?\s*(일|작업|스케줄).*(하지\s*말|배치\s*하지|안해|안\s*해|금지))|(주말(?:엔|에는)?\s*(쉬고\s*싶|휴식\s*하고\s*싶))/;
            const weekendOptIn = /(주말(?:엔|에는)?\s*(일|작업|스케줄).*(해도\s*돼|허용|배치해|넣어|가능))/;
            
            if (weekendOptOut.test(clean)) {
                weekendPolicy = 'rest';
            } else if (weekendOptIn.test(clean)) {
                weekendPolicy = 'allow';
            }
            
            // 피드백에서 시간대 선호도 추출 (오전/오후 작업형)
            const morningPreference = /(오전|아침|새벽|일찍|평일.*오전).*(작업|공부|할일|일정)/i.test(clean);
            const eveningPreference = /(오후|저녁|밤|늦|21시|9시.*이후|오후.*9시).*(작업|공부|할일|일정|빈.*시간)/i.test(clean);
            
            // 피드백을 명확한 사용자 메시지로 변환하여 추가
            const feedbackMessages = [];
            if (morningPreference) {
                feedbackMessages.push({
                    role: 'user',
                    content: '요청사항: 오전 시간대(00:00-12:00)에 작업을 배치해주세요. 오전 시간대 free_windows가 있으면 우선적으로 활용해주세요.'
                });
            }
            if (eveningPreference) {
                feedbackMessages.push({
                    role: 'user',
                    content: '요청사항: 오후 9시(21:00) 이후 시간대도 적극 활용해주세요. free_windows에서 21:00-23:59 구간이 있는 날에는 **반드시 해당 시간대에도 배치**해주세요. 단, 다른 시간대(오전, 오후)의 free_windows도 함께 활용하여 하루 전체를 효율적으로 채워주세요.'
                });
            }
            if (weekendOptOut.test(clean)) {
                feedbackMessages.push({
                    role: 'user',
                    content: '요청사항: 주말(day:6 토요일, day:7 일요일)에는 할 일을 배치하지 말아주세요.'
                });
            } else if (weekendOptIn.test(clean) || weekendPolicy === 'allow') {
                // 주말 허용 시에도 명시적으로 전달 (피드백이 없어도)
                feedbackMessages.push({
                    role: 'user',
                    content: '요청사항: 주말(day:6 토요일, day:7 일요일)에도 작업 배치가 가능합니다. 주말의 free_windows가 있으면 적극적으로 활용해주세요.'
                });
            }
            
            // 피드백 메시지를 userMessages 앞에 추가 (AI가 명확히 읽을 수 있도록)
            if (feedbackMessages.length > 0) {
                userMessages = [...feedbackMessages, ...userMessages];
                console.log(`[피드백 반영] ${feedbackMessages.length}개의 피드백 메시지를 userMessages에 추가했습니다.`);
            }
            
            // 프롬프트에 주말 정책 반영
            const weekendInstruction = weekendPolicy === 'rest' 
                ? '사용자가 주말에는 쉬고 싶다고 했습니다. 주말(day:6 토요일, day:7 일요일)에는 할 일을 배치하지 마세요.'
                : '주말(day:6 토요일, day:7 일요일)도 스케줄 배치가 가능합니다. 필요한 경우 주말에도 배치하세요.';
            
            // 피드백 기반 시간대 선호도 반영
            let timePreferenceInstruction = '';
            if (morningPreference) {
                timePreferenceInstruction = '\n- **오전 작업 선호**: 사용자가 오전 시간대 작업을 선호합니다. 가능한 한 오전 시간(00:00-12:00)에 작업을 배치하세요.';
            }
            if (eveningPreference) {
                timePreferenceInstruction += '\n- **저녁 시간 활용**: 사용자가 오후 9시(21:00) 이후 시간대를 활용하고 싶어합니다. 21:00 이후 빈 시간에도 작업을 배치하세요.';
            }
            
            const systemPrompt = {
                role: 'system',
                content: `당신은 할 일(task) 배치 전문가입니다. 오직 제공된 tasks만 placements 형식으로 배치하세요.${timePreferenceInstruction}

**현재 날짜: ${year}년 ${month}월 ${date}일 (${currentDayName})**
**기준 day: ${anchorDay}**

**절대 금지 사항:**
- lifestyle, appointment, schedule 형식 생성 금지
- 제공되지 않은 tasks 생성 금지
- 기존 생활패턴이나 고정일정 중복 생성 금지

**반드시 준수할 규칙:**
1) 배치는 오직 제공된 free_windows 내부에서만
2) **마감일 엄수**: 각 작업은 반드시 deadline_day를 넘기지 마세요 (deadline_day보다 큰 day에 배치 절대 금지)
3) **중요도+난이도 모두 상인 작업 (priority='상' AND difficulty='상')**: 반드시 **마감일까지 매일 매일(평일+주말 모두 포함), 비슷한 시간에 배치**하세요. 예를 들어 "오픽 시험 준비"가 priority='상', difficulty='상'이면 deadline_day까지 **평일과 주말을 구분하지 말고 매일 같은 시간대(예: 19:00-21:00)에 배치**해야 합니다. 주말(토요일 day:6, 일요일 day:7)에도 free_windows가 있으면 **반드시 배치**하세요. 하루도 빠뜨리지 마세요!
4) **우선순위 기반 배치**: 
   - **긴급 작업 (deadline_day <= ${baseRelDay + 3})**: 반드시 **매일 일정 시간 투자**하도록 배치하세요. 같은 작업을 여러 날에 걸쳐 매일 배치하여 마감일까지 꾸준히 진행하세요.
   - **매우 긴급 (deadline_day <= ${baseRelDay + 2})**: 당일부터 매일 배치, 하루 2시간 이상 배치
   - **긴급 (deadline_day <= ${baseRelDay + 4})**: 당일 또는 다음날부터 매일 배치, 하루 1시간 이상 배치
5) **중요도/난이도 상 작업**: (priority='상' 또는 difficulty='상')인 작업은 **마감일까지 여러 날에 걸쳐 충분히 배치**하세요. 특히 (priority='상' 또는 difficulty='상') **이고 동시에** (deadline_day<=${baseRelDay + 3}) 인 작업은 블록 길이를 **min_block_minutes(120분) 이상**으로 배치하고, **여러 날에 분산 배치**하세요.
6) **마감일 임박 + 집중 작업**: 마감일이 얼마 안 남았고(deadline_day <= ${baseRelDay + 2}), 집중해서 빠르게 끝낼 수 있는 작업은 **긴 시간(2-3시간 블록)**을 투자하여 배치하세요. 한 번에 몰아서 끝내는 것이 효율적입니다.
7) **빈 시간 적극 활용 (매우 중요)**: free_windows에 제공된 **모든 빈 시간을 최대한 활용**하세요. 하루에 **빈 시간이 60분 이상 남으면 반드시 채워야** 합니다. 같은 작업을 **하루에 여러 블록으로 분할 배치**하거나, 여러 작업을 **병렬 배치**하여 빈 시간을 최대한 줄이세요.
8) **같은 작업 하루 여러 번 배치**: **특히 중요도+난이도 상 작업**은 같은 날에 **여러 시간대에 분산 배치**하세요. 예를 들어 "오픽 시험 준비"가 하루에 4시간 필요하면 **오전 2시간, 오후 2시간**으로 나누어 배치하세요. free_windows에 공간이 있으면 **하나의 긴 블록보다 여러 개의 짧은 블록으로 분산**하는 것이 좋습니다.
9) **free_windows 활용 전략**: 각 day의 free_windows 목록을 확인하고, **가능한 모든 시간대에 배치**하세요. 예: free_windows가 [11:00-13:00, 14:00-17:00, 19:00-23:00]이면, 최소한 2-3개 구간에 배치하세요.
10) 겹치기 금지, 생활패턴/고정일정 침범 금지
11) **휴식 간격 필수**: 같은 작업이나 다른 작업을 연속으로 배치할 때는 **최소 30분** 간격을 두세요 (예: 17:00-19:00 작업 후 다음 작업은 19:30 이후). **쉬는 시간을 반드시 포함**하세요.
12) **주말 정책**: ${weekendInstruction}  주말이 허용이면 **주말의 빈 시간도 적극 활용**하여 여러 블록을 배치하세요. 특히 priority='상' AND difficulty='상' 작업은 **주말에도 매일, 필요 시 하루 여러 블록**을 배치하세요.

**입력 (tasks만 배치하세요):**
\`\`\`json
{
  "free_windows": ${JSON.stringify(freeWindowsList, null, 2)},
  "tasks": ${JSON.stringify(tasksForAIJSON, null, 2)}
}
\`\`\`

**출력 (반드시 이 형식만 사용, 다른 형식 금지):**
\`\`\`json
{
  "placements": [
    { "task_id": "t1", "day": 8, "start": "17:00", "end": "19:00" },
    { "task_id": "t2", "day": 7, "start": "13:00", "end": "15:00" }
  ],
  "notes": [
    "인턴 프로젝트 발표 준비를 마감일까지 매일 배치했습니다.",
    "오픽 시험 준비는 중요도와 난이도가 모두 상이므로 매일 동일한 시간에 배치했습니다.",
    "모든 빈 시간을 최대한 활용하여 작업을 배치했습니다."
  ]
}
\`\`\`

**중요:**
- 오직 "placements"와 "notes" 키만 포함하세요.
- "notes"는 스케줄 생성 이유와 배치 전략을 설명하는 문자열 배열입니다.
- 각 placement는 반드시 제공된 tasks의 task_id만 사용하세요.
- "schedule", "activities", "lifestyle", "appointment" 키워드는 절대 사용하지 마세요.`
            };

            // 시스템 프롬프트를 맨 앞에 추가
            const enhancedMessages = [systemPrompt, ...userMessages]
                .filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
            
            console.log('API 키 존재:', !!this.openaiApiKey);
            console.log('API 키 길이:', this.openaiApiKey ? this.openaiApiKey.length : 0);
            console.log('요청 메시지 수:', enhancedMessages.length);

            // 타이밍 로그 시작
            const T0 = Date.now();
            
            const payload = {
                model: 'gpt-4o-mini',
                messages: enhancedMessages,
                temperature: 0.2,
                max_tokens: 2400, // 토큰 상한
                response_format: { type: 'json_object' }
            };
            
            const T1 = Date.now();
            console.log('[타이밍] 프롬프트 구성 시간:', T1 - T0, 'ms');

            const response = await this.callWithRetry(() => {
                const T2 = Date.now();
                console.log('[타이밍] 대기열 시간:', T2 - T1, 'ms');
                const T3 = Date.now();
                
                return axios.post(
                    'https://api.openai.com/v1/chat/completions',
                    payload,
                    {
                        ...this.axiosOpts,
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.openaiApiKey}`
                        }
                    }
                ).then(res => {
                    const T4 = Date.now();
                    console.log('[타이밍] OpenAI 응답 시간:', T4 - T3, 'ms');
                    console.log('[타이밍] 총 소요 시간:', T4 - T0, 'ms');
                    return res;
                });
            });

            const content = response.data.choices?.[0]?.message?.content;
            
            if (!content) {
                throw new Error('AI 응답이 비어있습니다.');
            }
            
            // ✅ AI 스케줄 전체를 콘솔에 출력
            console.log('[🧠 AI 응답 원본 스케줄 JSON]');
            console.log(content || '(응답 없음)');
            
            // AI 원본 응답을 파일로 저장 (디버깅용)
            try {
                const fs = require('fs');
                const path = require('path');
                const debugPath = path.join(__dirname, '../debug-last-ai.json');
                fs.writeFileSync(debugPath, content || '{}', 'utf-8');
                console.log('[디버그] AI 원본 응답이 저장되었습니다:', debugPath);
            } catch (fsError) {
                console.warn('[디버그] 파일 저장 실패 (무시 가능):', fsError.message);
            }
            
            // JSON 파싱 - 더 강화된 처리
            try {
                console.log('AI 원본 응답 길이:', content.length);
                
                // 1) 코드블록과 전체 본문에서 모든 JSON 후보 수집
                const candidates = [];
                const tryParse = (candidate) => {
                    if (!candidate) return null;
                    const trimmed = candidate.trim();
                    try {
                        const parsed = JSON.parse(trimmed);
                        return { json: trimmed, parsed, length: trimmed.length };
                    } catch (_) {
                        return null;
                    }
                };

                // 코드블록에서 수집
                const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
                let match;
                while ((match = codeBlockRegex.exec(content)) !== null) {
                    const result = tryParse(match[1]);
                    if (result) candidates.push(result);
                }

                // 전체 본문 파싱 시도 (파싱 실패해도 schedule 포함이면 후보로 추가)
                const fullResult = tryParse(content);
                if (fullResult) candidates.push(fullResult);
                
                // 본문에서 모든 JSON 객체 탐색
                let start = 0;
                while (start < content.length) {
                    const jsonStart = content.indexOf('{', start);
                    if (jsonStart === -1) break;
                    
                    let braceCount = 0;
                    let jsonEnd = -1;
                    let inString = false;
                    let escapeNext = false;
                    
                    for (let i = jsonStart; i < content.length; i++) {
                        const char = content[i];
                        if (escapeNext) { escapeNext = false; continue; }
                        if (char === '\\') { escapeNext = true; continue; }
                        if (char === '"' && !escapeNext) { inString = !inString; }
                        if (!inString) {
                            if (char === '{') braceCount++;
                            else if (char === '}') {
                                braceCount--;
                                if (braceCount === 0) { jsonEnd = i; break; }
                            }
                        }
                    }
                    if (jsonEnd !== -1) {
                        const jsonString = content.substring(jsonStart, jsonEnd + 1);
                        const result = tryParse(jsonString);
                        if (result) candidates.push(result);
                    }
                    start = jsonStart + 1;
                }

                // 디버깅: candidates 상태 로깅
                console.log(`[JSON 파싱] 후보 수집 완료: ${candidates.length}개`);
                candidates.forEach((c, i) => {
                    const hasSchedule = c.parsed?.schedule || c.json.includes('"schedule"');
                    console.log(`[JSON 파싱] 후보 ${i+1}: ${c.length}자, schedule 포함: ${hasSchedule}, 파싱 성공: ${!!c.parsed}`);
                });
                
                // 2) schedule 키워드가 포함된 후보를 우선 선택 (파싱 실패해도 문자열 검색으로 체크)
                const scheduleCandidates = candidates.filter(c => {
                    if (c.parsed && c.parsed.schedule) return true;
                    if (c.json.includes('"schedule"')) return true;
                    return false;
                });
                
                let bestCandidate = null;
                if (scheduleCandidates.length > 0) {
                    // schedule이 포함된 것 중 가장 긴 것 선택 (본문 전체가 최우선)
                    scheduleCandidates.sort((a, b) => {
                        // 본문 전체(또는 길이가 content.length와 비슷)를 최우선
                        if (a.length === content.length) return -1;
                        if (b.length === content.length) return 1;
                        return b.length - a.length;
                    });
                    bestCandidate = scheduleCandidates[0];
                    console.log(`[JSON 파싱] ✅ schedule 포함 JSON 선택: ${bestCandidate.length}자 (총 ${scheduleCandidates.length}개 후보 중)`);
                } else if (candidates.length > 0) {
                    // schedule이 없으면 가장 긴 것 선택
                    bestCandidate = candidates.sort((a, b) => b.length - a.length)[0];
                    console.log(`[JSON 파싱] ⚠️ 가장 긴 JSON 선택: ${bestCandidate.length}자 (schedule 없음)`);
                    // 경고: schedule이 없는 것이 선택됨
                    console.warn(`[JSON 파싱] ⚠️ AI 응답 전체(${content.length}자)에 schedule이 있는지 확인 필요`);
                    if (content.includes('"schedule"')) {
                        console.warn(`[JSON 파싱] ⚠️ AI 응답 본문에 "schedule" 키워드 발견! 파싱 실패로 인한 누락 가능성`);
                        // 본문 전체를 강제로 사용 시도
                        bestCandidate = { json: content, parsed: null, length: content.length };
                        console.warn(`[JSON 파싱] ⚠️ 본문 전체를 강제로 사용 시도: ${content.length}자`);
                    }
                }
                
                if (!bestCandidate) {
                    throw new Error('유효한 JSON 객체를 찾을 수 없습니다.');
                }
                
                const bestJson = bestCandidate.json;
                let parsed = bestCandidate.parsed;
                
                console.log('추출된 JSON 길이:', bestJson.length);
                
                // 이미 파싱된 것을 사용하지만, 안전을 위해 재파싱 시도 (parsed가 없을 때만)
                try {
                    if (!parsed) {
                        parsed = JSON.parse(bestJson);
                    }
                } catch (jsonError) {
                    // parsed가 이미 있으면 에러 무시 (이미 유효한 파싱 결과)
                    if (bestCandidate.parsed) {
                        parsed = bestCandidate.parsed;
                        console.log('[JSON 파싱] 재파싱 실패했지만 기존 파싱 결과 사용');
                    } else {
                        console.error('JSON.parse 실패:', jsonError.message);
                        console.error('문제가 있는 JSON 부분:', bestJson.substring(Math.max(0, bestJson.length - 200)));
                        
                        // JSON이 불완전한 경우, 마지막 완전한 객체를 찾아서 파싱 시도
                        const lines = bestJson.split('\n');
                        let validJson = '';
                        let braceCount = 0;
                        let inString = false;
                        let escapeNext = false;
                        
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            for (let j = 0; j < line.length; j++) {
                                const char = line[j];
                                
                                if (escapeNext) {
                                    escapeNext = false;
                                    continue;
                                }
                                
                                if (char === '\\') {
                                    escapeNext = true;
                                    continue;
                                }
                                
                                if (char === '"' && !escapeNext) {
                                    inString = !inString;
                                }
                                
                                if (!inString) {
                                    if (char === '{') braceCount++;
                                    if (char === '}') braceCount--;
                                }
                                
                                validJson += char;
                                
                                // 완전한 JSON 객체를 찾았으면 중단
                                if (braceCount === 0 && validJson.trim().length > 0) {
                                    break;
                                }
                            }
                            
                            if (braceCount === 0 && validJson.trim().length > 0) {
                                break;
                            }
                            
                            if (i < lines.length - 1) {
                                validJson += '\n';
                            }
                        }
                        
                        console.log('수정된 JSON 길이:', validJson.length);
                        try {
                            parsed = JSON.parse(validJson);
                        } catch (e) {
                            throw new Error('JSON 파싱에 완전히 실패했습니다: ' + e.message);
                        }
                    }
                }
                
                // === 새 아키텍처: placements 구조 파싱 ===
                // 정책: AI가 완성된 schedule을 제공하면 이를 최우선으로 신뢰합니다.
                // (schedule → placements 변환을 먼저 시도하고, 없으면 placements 필드 사용)
                
                // placements 키 정규화 (snake_case → camelCase)
                const normalizePlacement = (p) => ({
                    taskId: p.taskId || p.task_id || p.id,
                    day: typeof p.day === 'string' ? parseInt(p.day, 10) : p.day,
                    start: normalizeHHMM(p.start),
                    end: normalizeHHMM(p.end),
                    reason: p.reason || p.explanation || ''
                });
                
                // placements, breaks, unplaced, notes 구조 파싱
                let placements = [];
                let breaks = [];
                let unplaced = [];
                let explanation = '';
                let notes = [];
                
                // 1) schedule이 있으면 최우선 사용 (schedule → placements 변환)
                let usedScheduleFirst = false;
                let dayArrays = Array.isArray(parsed?.schedule) ? parsed.schedule
                               : Array.isArray(parsed?.scheduleData) ? parsed.scheduleData
                               : null;
                if (!dayArrays && parsed && typeof parsed === 'object' && Array.isArray(parsed.activities) && Number.isFinite(parsed.day)) {
                    dayArrays = [parsed];
                }
                if (dayArrays) {
                    console.log('[파싱 정책] schedule 우선 사용: schedule → placements 변환');
                    usedScheduleFirst = true;
                    // busy와 중복 체크를 위한 헬퍼 함수
                    const isOverlappingWithBusy = (day, start, end, title) => {
                        const normalizeTitle = (t) => (t || '').trim().toLowerCase().replace(/\s+/g, '');
                        return busy.some(b => {
                            if (b.day !== day) return false;
                            const bTitle = normalizeTitle(b.title);
                            const actTitle = normalizeTitle(title);
                            if (bTitle && actTitle && bTitle === actTitle) {
                                return true;
                            }
                            return false;
                        });
                    };
                    for (const dayObj of dayArrays) {
                        if (!dayObj || !Array.isArray(dayObj.activities)) continue;
                        for (const act of dayObj.activities) {
                            if (act.type !== 'task') continue;
                            let taskId = act.taskId || act.id;
                            if (!taskId && act.title) {
                                for (const [tid, task] of Object.entries(tasksById)) {
                                    if (task.title === act.title) { taskId = tid; break; }
                                }
                                if (!taskId) {
                                    console.log(`[schedule 우선] tasksForAI에 없는 task 제거: ${act.title} (day ${dayObj.day}, ${act.start}-${act.end})`);
                                    continue;
                                }
                            }
                            if (!taskId || !tasksById[taskId]) {
                                console.log(`[schedule 우선] 유효하지 않은 taskId 제거: ${taskId || '없음'} (${act.title})`);
                                continue;
                            }
                            if (isOverlappingWithBusy(dayObj.day, act.start, act.end, act.title)) {
                                console.log(`[schedule 우선] busy와 중복되는 placement 제거: ${act.title} (day ${dayObj.day}, ${act.start}-${act.end})`);
                                continue;
                            }
                            placements.push(normalizePlacement({
                                taskId,
                                day: dayObj.day,
                                start: act.start,
                                end: act.end,
                                reason: act.reason || ''
                            }));
                        }
                    }
                    explanation = parsed.explanation || parsed.reason || '';
                    notes = Array.isArray(parsed.notes) ? parsed.notes : (parsed.notes ? [parsed.notes] : []);
                }
                
                // 2) schedule이 없거나 변환 결과가 비어있으면 placements 필드 사용
                if (!usedScheduleFirst || placements.length === 0) {
                    if (Array.isArray(parsed?.placements)) {
                        if (placements.length === 0) {
                            placements = (parsed.placements || []).map(normalizePlacement);
                        }
                        breaks = parsed.breaks || breaks;
                        unplaced = parsed.unplaced || unplaced;
                        explanation = explanation || parsed.explanation || parsed.reason || '';
                        notes = notes.length ? notes : (Array.isArray(parsed.notes) ? parsed.notes : (parsed.notes ? [parsed.notes] : []));
                    } else if (Array.isArray(parsed)) {
                        if (placements.length === 0) {
                            placements = (parsed || []).map(normalizePlacement);
                        }
                    }
                }
                
                // placements 배열 로깅
                console.log(`[새 아키텍처] placements 변환 완료: ${placements.length}개`);
                if (placements.length > 0) {
                    console.log('[새 아키텍처] placements 상세:', placements.map(p => ({
                        taskId: p.taskId,
                        day: p.day,
                        start: p.start,
                        end: p.end
                    })));
                }
                
                // placements가 비어있으면 경고
                if (placements.length === 0 && tasksForAI.length > 0) {
                    console.warn('[새 아키텍처] placements가 비어있습니다. AI 응답 구조를 확인하세요.');
                    console.warn('parsed 키들:', Object.keys(parsed));
                    console.warn('tasksForAI 개수:', tasksForAI.length);
                }

                // 주말 정책 전달 (generateSchedule에서 이미 계산됨)
                // TODO: 나중에 userPreferences나 opts에서 받아올 수 있음
                
                // === 새 아키텍처: mergeAIPlacements로 병합 ===
                // mergeAIPlacements 호출
                
                // 디버깅: placements에 "회의"가 포함되어 있는지 확인
                const meetingPlacements = placements.filter(p => {
                    const taskId = p.task_id || p.taskId;
                    const task = tasksById[taskId];
                    return task && task.title && task.title.includes('회의');
                });
                if (meetingPlacements.length > 0) {
                    console.warn(`[새 아키텍처] placements에 "회의" 포함: ${meetingPlacements.length}개`, meetingPlacements);
                }
                
                // 오늘 배치 완화: merge 전에 오늘 시작 시간을 now+5로 스냅
                try {
                    const padMinutes = 5;
                    const toMin = (s) => {
                        const [h, m] = String(s || '00:00').split(':').map(x => parseInt(x || '0', 10));
                        return (h || 0) * 60 + (m || 0);
                    };
                    const toTime = (m) => minutesToTime(m);
                    if (Array.isArray(placements)) {
                        const nowMin = now.getHours() * 60 + now.getMinutes() + padMinutes;
                        for (const p of placements) {
                            if (!p || (p.day !== baseRelDay)) continue;
                            const dur = toMin(p.end) - toMin(p.start);
                            const pStart = toMin(p.start);
                            if (pStart < nowMin) {
                                const newStart = nowMin;
                                const newEnd = newStart + Math.max(dur, 0);
                                p.start = toTime(newStart);
                                p.end = toTime(newEnd);
                            }
                        }
                    }
                } catch (snapErr) {
                    console.warn('[새 아키텍처] 오늘 배치 스냅(사전) 중 경고:', snapErr?.message);
                }

                let finalSchedule = this.mergeAIPlacements({
                    baseDate: now,
                    busy,
                    placements,
                    breaks,
                    tasksById,
                    // 검증은 raw free windows로 수행 (분할 전, 연속 구간 허용)
                    freeWindows: freeWindowsRaw,
                    weekendPolicy: weekendPolicy // 주말 정책 전달
                });
                
                // 디버깅: finalSchedule의 day 2에 "회의"가 포함되어 있는지 확인
                const day2Schedule = finalSchedule.find(d => d.day === 2);
                if (day2Schedule) {
                    const meetingActs = day2Schedule.activities.filter(a => a.title && a.title.includes('회의'));
                    if (meetingActs.length > 0) {
                        console.warn(`[새 아키텍처] day 2 최종 스케줄에 "회의" 포함:`, meetingActs.map(a => ({
                            title: a.title,
                            start: a.start,
                            end: a.end,
                            type: a.type,
                            source: a.source
                        })));
                    }
                }
                
                console.log('[새 아키텍처] 병합 완료, schedule 길이:', finalSchedule.length);
                
                // day 8 상세 로깅 (디버깅용)
                const day8Schedule = finalSchedule.find(d => d.day === 8);
                if (day8Schedule) {
                    console.log('[새 아키텍처] day 8 최종 스케줄:', JSON.stringify(day8Schedule.activities, null, 2));
                }
                
                // 설명 자동 생성 (더 상세하게)
                const buildFallbackExplanationNew = (schedule, tasks, unplacedCount) => {
                    const taskCount = schedule.reduce((sum, day) => 
                        sum + (day.activities?.filter(a => a.type === 'task').length || 0), 0);
                    const highPriorityTasks = tasks.filter(t => t.importance === '상' || t.difficulty === '상').length;
                    const urgentTasks = tasks.filter(t => {
                        const deadlineDay = t.deadline_day || 999;
                        return deadlineDay <= 5; // D-5 이내
                    }).length;
                    const days = schedule.length;
                    
                    // 배치된 작업별 통계
                    const taskStats = {};
                    for (const day of schedule) {
                        for (const act of day.activities || []) {
                            if (act.type === 'task' && act.title) {
                                taskStats[act.title] = (taskStats[act.title] || 0) + 1;
                            }
                        }
                    }
                    const taskList = Object.entries(taskStats)
                        .map(([title, count]) => `- ${title}: ${count}회 배치`)
                        .join('\n');
                    
                    let msg = `📅 스케줄 생성 완료!\n\n`;
                    msg += `**기간**: ${days}일간 (오늘부터 ${days}일 후까지)\n`;
                    msg += `**총 배치 작업**: ${taskCount}개\n`;
                    if (highPriorityTasks > 0) {
                        msg += `**고우선순위 작업**: ${highPriorityTasks}개 (중요도/난이도 상)\n`;
                    }
                    if (urgentTasks > 0) {
                        msg += `**긴급 작업**: ${urgentTasks}개 (마감일 D-5 이내)\n`;
                    }
                    if (taskList) {
                        msg += `\n**배치 내역**:\n${taskList}\n`;
                    }
                    if (unplacedCount > 0) {
                        msg += `\n⚠️ **미배치 작업**: ${unplacedCount}개 (마감일 내 시간 부족)`;
                    }
                    msg += `\n\n빈 시간을 최대한 활용하여 일정을 배치했습니다. 각 작업 사이에는 휴식 시간(30분)이 포함되어 있습니다.`;
                    
                    return msg;
                };
                
                // notes를 explanation에 통합 (notes가 있으면 우선 사용)
                let finalExplanation = '';
                if (notes.length > 0) {
                    finalExplanation = notes.join('\n');
                } else if (explanation?.trim()) {
                    finalExplanation = explanation.trim();
                } else {
                    finalExplanation = buildFallbackExplanationNew(finalSchedule, tasksOnly, unplaced.length);
                }
                
                // === 새 아키텍처: 최종 반환 ===
                return {
                    schedule: finalSchedule,
                    explanation: finalExplanation,
                    notes: notes,
                    unplaced: unplaced
                };
            } catch (parseError) {
                console.error('AI 응답 JSON 파싱 실패:', parseError);
                console.error('원본 응답:', content);
                throw new Error('AI 응답을 파싱할 수 없습니다.');
            }
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
