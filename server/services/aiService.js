const axios = require('axios');
const https = require('https');
const { normalizeHHMM, mapDayToWeekday, relDayToWeekdayNumber, extractAllowedDays, minutesToTime } = require('../utils/scheduleUtils');
const { parseLifestyleString } = require('../utils/lifestyleUtils');
const DAY_TOTAL_MINUTES = 24 * 60;
const LUNCH_START_MIN = 12 * 60;
const LUNCH_END_MIN = 14 * 60;
const WORK_KEYWORDS = /(근무|퇴근|회사|업무|work|job|office|출근|재택)/i;

function toMinutesSafe(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const parts = timeStr.split(':').map(Number);
    if (parts.length < 2 || parts.some(n => Number.isNaN(n))) return null;
    const [h, m] = parts;
    return h * 60 + m;
}

function toTimeString(minutes) {
    if (!Number.isFinite(minutes)) return null;
    const wrapped = ((minutes % DAY_TOTAL_MINUTES) + DAY_TOTAL_MINUTES) % DAY_TOTAL_MINUTES;
    const h = Math.floor(wrapped / 60);
    const m = wrapped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeTitleForMatch(title = '') {
    return String(title || '').trim().toLowerCase().replace(/\s+/g, '');
}

function getOccupiedIntervals(dayObj, excludeActivity = null) {
    return (dayObj.activities || [])
        .filter(act => act && act !== excludeActivity)
        .map(act => {
            const start = toMinutesSafe(act.start);
            const end = toMinutesSafe(act.end);
            if (start === null || end === null || end <= start) return null;
            return { start, end };
        })
        .filter(Boolean)
        .sort((a, b) => a.start - b.start);
}

function findAvailableSlotInWindow(dayObj, duration, windowStart, windowEnd, excludeActivity = null) {
    const intervals = getOccupiedIntervals(dayObj, excludeActivity);
    let cursor = windowStart;
    for (const interval of intervals) {
        if (interval.end <= cursor) {
            continue;
        }
        if (interval.start >= windowEnd) {
            break;
        }
        if (interval.start > cursor && interval.start - cursor >= duration) {
            return cursor;
        }
        cursor = Math.max(cursor, interval.end);
        if (cursor >= windowEnd) break;
    }
    if (windowEnd - cursor >= duration) {
        return cursor;
    }
    return null;
}

function moveActivity(activity, newStartMin, duration) {
    activity.start = toTimeString(newStartMin);
    activity.end = toTimeString(newStartMin + duration);
}

function relocateActivityWithinWindow(dayObj, activity, duration, windowStart, windowEnd) {
    const slot = findAvailableSlotInWindow(dayObj, duration, windowStart, windowEnd, activity);
    if (slot === null) return false;
    moveActivity(activity, slot, duration);
    return true;
}

function getLatestWorkEndMinute(dayObj) {
    const workActs = (dayObj.activities || []).filter(
        act => act && act.type === 'lifestyle' && WORK_KEYWORDS.test(String(act.title || ''))
    );
    const ends = workActs
        .map(act => toMinutesSafe(act.end))
        .filter(end => end !== null);
    if (!ends.length) return null;
    return Math.max(...ends);
}

function findMatchingActivity(dayObj, taskTitleNorm) {
    return (dayObj.activities || []).find(act => {
        if (!act || (act.type !== 'task' && act.type !== 'appointment')) return false;
        const actTitle = normalizeTitleForMatch(act.title);
        return actTitle === taskTitleNorm ||
            actTitle.includes(taskTitleNorm) ||
            taskTitleNorm.includes(actTitle);
    });
}

function ensureDayEntry(finalSchedule, relDay, now) {
    let dayObj = finalSchedule.find(d => d.day === relDay);
    if (!dayObj) {
        dayObj = {
            day: relDay,
            weekday: mapDayToWeekday(relDay, now),
            activities: []
        };
        finalSchedule.push(dayObj);
    }
    if (!Array.isArray(dayObj.activities)) {
        dayObj.activities = [];
    }
    return dayObj;
}

function maybeAddLifestyleBlock(dayObj, title, startMin, endMin) {
    if (!dayObj || endMin <= startMin) return 0;
    const start = minutesToTime(startMin);
    const end = minutesToTime(endMin);
    const norm = normalizeTitleForMatch(title);
    const exists = (dayObj.activities || []).some(
        act =>
            act.type === 'lifestyle' &&
            normalizeTitleForMatch(act.title) === norm &&
            act.start === start &&
            act.end === end
    );
    if (exists) return 0;
    dayObj.activities.push({
        start,
        end,
        title,
        type: 'lifestyle'
    });
    return 1;
}

function ensureLifestyleCoverage(finalSchedule, lifestyleTexts, finalStartDay, finalEndDay, now) {
    if (!Array.isArray(lifestyleTexts) || lifestyleTexts.length === 0) {
        return { inserted: 0 };
    }
    const parsed = lifestyleTexts
        .map(text => parseLifestyleString(text))
        .filter(p => p && p.start && p.end && Array.isArray(p.days) && p.days.length > 0)
        .map(p => ({
            ...p,
            startMin: toMinutesSafe(p.start),
            endMin: toMinutesSafe(p.end),
            normTitle: normalizeTitleForMatch(p.title)
        }))
        .filter(p => p.startMin !== null && p.endMin !== null);
    if (parsed.length === 0) {
        return { inserted: 0 };
    }
    let inserted = 0;
    const dayCache = new Map();
    const getDay = (relDay) => {
        if (!dayCache.has(relDay)) {
            dayCache.set(relDay, ensureDayEntry(finalSchedule, relDay, now));
        }
        return dayCache.get(relDay);
    };
    for (let relDay = finalStartDay; relDay <= finalEndDay; relDay++) {
        const dayObj = getDay(relDay);
        const weekdayNum = relDayToWeekdayNumber(relDay, now);
        parsed.forEach(pattern => {
            if (!pattern.days.includes(weekdayNum)) return;
            if (pattern.startMin < pattern.endMin) {
                inserted += maybeAddLifestyleBlock(dayObj, pattern.title, pattern.startMin, pattern.endMin);
            } else {
                inserted += maybeAddLifestyleBlock(dayObj, pattern.title, pattern.startMin, DAY_TOTAL_MINUTES);
                if (relDay < finalEndDay) {
                    const nextDay = getDay(relDay + 1);
                    inserted += maybeAddLifestyleBlock(nextDay, pattern.title, 0, pattern.endMin);
                }
            }
        });
    }
    finalSchedule.sort((a, b) => a.day - b.day);
    finalSchedule.forEach(day => {
        day.activities = (day.activities || []).sort((a, b) => {
            const as = toMinutesSafe(a.start);
            const bs = toMinutesSafe(b.start);
            if (as === null && bs === null) return 0;
            if (as === null) return 1;
            if (bs === null) return -1;
            return as - bs;
        });
    });
    return { inserted };
}

function getPreferredWindows(timePreference) {
    const baseWindows = [
        [6 * 60, 12 * 60],   // 06:00~12:00
        [12 * 60, 15 * 60],  // 12:00~15:00
        [15 * 60, 18 * 60],  // 15:00~18:00
        [18 * 60, 23 * 60],  // 18:00~23:00
    ];
    if (timePreference === 'morning') {
        return [
            [6 * 60, 11 * 60],
            [11 * 60, 14 * 60],
            [14 * 60, 18 * 60],
            [18 * 60, 23 * 60]
        ];
    }
    if (timePreference === 'evening') {
        return [
            [18 * 60, 23 * 60],
            [14 * 60, 18 * 60],
            [11 * 60, 14 * 60],
            [6 * 60, 11 * 60]
        ];
    }
    return baseWindows;
}

function selectDistributionDays(startDay, endDay, desiredCount = 3) {
    const total = endDay - startDay + 1;
    if (total <= 0) return [];
    const count = Math.min(desiredCount, total);
    if (count <= 0) return [];
    if (count === 1) return [startDay];
    const step = total / count;
    const days = [];
    for (let i = 0; i < count; i++) {
        const rel = Math.round(startDay + i * step);
        if (rel >= startDay && rel <= endDay) {
            days.push(rel);
        }
    }
    return Array.from(new Set(days)).sort((a, b) => a - b);
}

function placeTaskBlock(dayObj, task, duration) {
    if (!dayObj) return false;
    const pref = (typeof task.timePreference === 'string' && task.timePreference.trim().length > 0)
        ? task.timePreference
        : 'any';
    const windows = getPreferredWindows(pref);
    for (const [start, end] of windows) {
        const slot = findAvailableSlotInWindow(dayObj, duration, start, end);
        if (slot !== null) {
            dayObj.activities.push({
                start: minutesToTime(slot),
                end: minutesToTime(slot + duration),
                title: task.title,
                type: 'task',
                __autoInserted: true
            });
            dayObj.activities.sort((a, b) => {
                const as = toMinutesSafe(a.start);
                const bs = toMinutesSafe(b.start);
                if (as === null && bs === null) return 0;
                if (as === null) return 1;
                if (bs === null) return -1;
                return as - bs;
            });
            return true;
        }
    }
    const fallbackSlot = findAvailableSlotInWindow(dayObj, duration, 0, DAY_TOTAL_MINUTES);
    if (fallbackSlot !== null) {
        dayObj.activities.push({
            start: minutesToTime(fallbackSlot),
            end: minutesToTime(fallbackSlot + duration),
            title: task.title,
            type: 'task',
            __autoInserted: true
        });
        dayObj.activities.sort((a, b) => {
            const as = toMinutesSafe(a.start);
            const bs = toMinutesSafe(b.start);
            if (as === null && bs === null) return 0;
            if (as === null) return 1;
            if (bs === null) return -1;
            return as - bs;
        });
        return true;
    }
    return false;
}

function ensureTaskCoverage(finalSchedule, tasksForAI, finalStartDay, finalEndDay, now, getEffectiveDeadlineDay) {
    if (!Array.isArray(tasksForAI) || tasksForAI.length === 0) {
        return { insertedBlocks: 0, recoveredTasks: 0, missingTasks: 0 };
    }
    let insertedBlocks = 0;
    let recoveredTasks = 0;
    let missingTasks = 0;
    const titleMap = new Map();
    tasksForAI.forEach(task => {
        if (!task || (task.type && task.type !== 'task')) return;
        const norm = normalizeTitleForMatch(task.title);
        if (!norm) return;
        titleMap.set(norm, task);
    });
    for (const [, task] of titleMap) {
        const norm = normalizeTitleForMatch(task.title);
        const effectiveDeadline = Math.min(
            getEffectiveDeadlineDay ? getEffectiveDeadlineDay(task) : finalEndDay,
            finalEndDay
        );
        const hasPlacement = finalSchedule.some(dayObj => {
            if (!dayObj || dayObj.day > effectiveDeadline) return false;
            return !!findMatchingActivity(dayObj, norm);
        });
        if (hasPlacement) continue;
        missingTasks++;
        const distributionDays = selectDistributionDays(finalStartDay, effectiveDeadline, task.require_daily ? 5 : 3);
        let placedThisTask = false;
        const duration = Math.max(30, Number(task.min_block_minutes) || 60);
        distributionDays.forEach(relDay => {
            if (relDay > effectiveDeadline) return;
            const dayObj = ensureDayEntry(finalSchedule, relDay, now);
            if (placeTaskBlock(dayObj, task, duration)) {
                insertedBlocks++;
                placedThisTask = true;
            }
        });
        if (placedThisTask) {
            recoveredTasks++;
        }
    }
    if (insertedBlocks > 0) {
        finalSchedule.sort((a, b) => a.day - b.day);
    }
    return { insertedBlocks, recoveredTasks, missingTasks };
}

function rebalanceTasksWithinDays(finalSchedule, tasksForAI) {
    if (!Array.isArray(finalSchedule) || finalSchedule.length === 0) {
        return 0;
    }
    const taskMetaMap = new Map();
    (tasksForAI || []).forEach(task => {
        if (!task || !task.title) return;
        const norm = normalizeTitleForMatch(task.title);
        if (!norm) return;
        taskMetaMap.set(norm, task);
    });
    let movedCount = 0;
    finalSchedule.forEach(dayObj => {
        const taskActivities = (dayObj.activities || []).filter(act => act && act.type === 'task');
        taskActivities.sort((a, b) => {
            const as = toMinutesSafe(a.start);
            const bs = toMinutesSafe(b.start);
            if (as === null && bs === null) return 0;
            if (as === null) return 1;
            if (bs === null) return -1;
            return as - bs;
        });
        taskActivities.forEach(activity => {
            const startMin = toMinutesSafe(activity.start);
            const endMin = toMinutesSafe(activity.end);
            if (startMin === null || endMin === null) return;
            const duration = endMin - startMin;
            if (duration <= 0) return;
            const meta = taskMetaMap.get(normalizeTitleForMatch(activity.title)) || {};
            const pref = (typeof meta.timePreference === 'string' && meta.timePreference.trim().length > 0)
                ? meta.timePreference
                : 'any';
            const windows = getPreferredWindows(pref);
            let moved = false;
            for (const [windowStart, windowEnd] of windows) {
                if (relocateActivityWithinWindow(dayObj, activity, duration, windowStart, windowEnd)) {
                    movedCount++;
                    moved = true;
                    break;
                }
            }
            if (!moved) {
                if (relocateActivityWithinWindow(dayObj, activity, duration, 6 * 60, 23 * 60)) {
                    movedCount++;
                }
            }
        });
    });
    return movedCount;
}

function findFreeTimeSlots(dayObj, minDuration = 30) {
    const intervals = getOccupiedIntervals(dayObj);
    const freeSlots = [];
    let cursor = 6 * 60; // 06:00부터 시작 (너무 이른 시간 제외)
    const endOfDay = 23 * 60; // 23:00까지
    
    for (const interval of intervals) {
        if (interval.start > cursor && interval.start - cursor >= minDuration) {
            freeSlots.push({
                start: cursor,
                end: interval.start,
                duration: interval.start - cursor
            });
        }
        cursor = Math.max(cursor, interval.end);
        if (cursor >= endOfDay) break;
    }
    
    if (endOfDay - cursor >= minDuration) {
        freeSlots.push({
            start: cursor,
            end: endOfDay,
            duration: endOfDay - cursor
        });
    }
    
    return freeSlots.sort((a, b) => b.duration - a.duration); // 큰 시간대부터
}

function fillFreeTimeWithTasks(finalSchedule, tasksForAI, finalStartDay, finalEndDay, now, getEffectiveDeadlineDay) {
    if (!Array.isArray(finalSchedule) || finalSchedule.length === 0) {
        return { addedBlocks: 0 };
    }
    
    const taskMetaMap = new Map();
    (tasksForAI || []).forEach(task => {
        if (!task || !task.title || (task.type && task.type !== 'task')) return;
        const norm = normalizeTitleForMatch(task.title);
        if (!norm) return;
        if (!taskMetaMap.has(norm)) {
            taskMetaMap.set(norm, []);
        }
        taskMetaMap.get(norm).push(task);
    });
    
    let addedBlocks = 0;
    
    finalSchedule.forEach(dayObj => {
        if (!dayObj || dayObj.day < finalStartDay || dayObj.day > finalEndDay) return;
        
        const existingTasks = (dayObj.activities || [])
            .filter(act => act && act.type === 'task')
            .map(act => normalizeTitleForMatch(act.title));
        
        const freeSlots = findFreeTimeSlots(dayObj, 60); // 최소 1시간 빈 시간대만
        
        for (const slot of freeSlots) {
            if (slot.duration < 60) continue; // 최소 1시간 이상만
            
            // 이미 배치된 task 중에서 빈 시간대에 추가 배치 가능한 것 찾기
            for (const [normTitle, taskList] of taskMetaMap.entries()) {
                if (existingTasks.includes(normTitle)) {
                    // 이미 배치된 task는 추가 배치 가능
                    const task = taskList[0];
                    const effectiveDeadline = Math.min(
                        getEffectiveDeadlineDay ? getEffectiveDeadlineDay(task) : finalEndDay,
                        finalEndDay
                    );
                    
                    if (dayObj.day > effectiveDeadline) continue;
                    
                    const duration = Math.min(
                        Math.max(30, Number(task.min_block_minutes) || 60),
                        slot.duration
                    );
                    
                    if (duration < 30) continue;
                    
                    const slotStart = slot.start;
                    const slotEnd = Math.min(slot.start + duration, slot.end);
                    
                    // 겹침 확인
                    const overlaps = (dayObj.activities || []).some(act => {
                        const as = toMinutesSafe(act.start);
                        const ae = toMinutesSafe(act.end);
                        if (as === null || ae === null) return false;
                        return !(slotEnd <= as || slotStart >= ae);
                    });
                    
                    if (!overlaps) {
                        dayObj.activities.push({
                            start: minutesToTime(slotStart),
                            end: minutesToTime(slotEnd),
                            title: task.title,
                            type: 'task',
                            __autoInserted: true,
                            __fillFreeTime: true
                        });
                        dayObj.activities.sort((a, b) => {
                            const as = toMinutesSafe(a.start);
                            const bs = toMinutesSafe(b.start);
                            if (as === null && bs === null) return 0;
                            if (as === null) return 1;
                            if (bs === null) return -1;
                            return as - bs;
                        });
                        addedBlocks++;
                        break; // 이 slot은 사용했으므로 다음 slot으로
                    }
                }
            }
        }
    });
    
    return { addedBlocks };
}

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
                // extractAllowedDays는 이미 baseRelDay 기준 상대 day 값 반환
                // 따라서 그대로 사용하되, 범위 계산은 일관되게 처리
                if (extractedDays.length > 0) {
                    const minDay = Math.min(...extractedDays);
                    const maxDay = Math.max(...extractedDays);
                    taskDays = Array.from({ length: maxDay - minDay + 1 }, (_, i) => minDay + i);
                    scheduleLength = Math.max(14, maxDay - baseRelDay + 1); // 최소 14일 유지
                } else {
                    taskDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);
                    scheduleLength = 14;
                }
                lifestyleDays = Array.from({ length: scheduleLength }, (_, i) => baseRelDay + i);
            } else if (hasDeadline) {
                const extractedDays = extractAllowedDays(messages);
                if (extractedDays.length > 0) {
                    // extractAllowedDays는 baseRelDay 기준 상대 day 값 반환
                    const maxDay = Math.max(...extractedDays);
                    taskDays = Array.from({ length: maxDay - baseRelDay + 1 }, (_, i) => baseRelDay + i);
                    scheduleLength = Math.max(14, maxDay - baseRelDay + 1);
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
                    scheduleLength = Math.max(14, windowDays);
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
                
                const requiredMinutes = Math.max(
                    30,
                    Number(task.estimatedMinutes || task.durationMin || minBlockMinutes || 60)
                );
                
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
                
                // timePreference 항상 'any'로 설정 (선호 시간대 제거)
                const timePreference = 'any';
                
                const requireDaily = task.require_daily === true || bothHigh || highPriority || highDifficulty || urgent || veryUrgent;
                
                const taskForAI = {
                    id: taskId,
                    title: task.title,
                    deadline_day: deadlineDay,
                    deadlineTime: task.deadlineTime || null, // 특정 시간이 지정된 경우 (예: "오후 2시" → "14:00")
                    priority: highPriority ? '상' : (task.importance === '중' ? '중' : '하'),
                    difficulty: highDifficulty ? '상' : (task.difficulty === '중' ? '중' : '하'),
                    min_block_minutes: minBlockMinutes,
                    type: task.type || 'task', // type 정보 추가 (appointment인 경우 특별 처리)
                    timePreference: 'any', // 항상 'any'로 설정 (선호 시간대 제거)
                    // 긴급도 정보 추가 (AI가 우선순위 판단에 사용)
                    urgency_level: bothHigh ? '매우중요' : (veryUrgent ? '매우긴급' : (urgent ? '긴급' : '보통')),
                    days_until_deadline: daysUntilDeadline,
                    can_focus_finish: canFocusFinish,
                    // 매일 배치 필요 플래그 (중요도+난이도 모두 상이거나, 긴급한 경우)
                    require_daily: requireDaily,
                    // 메타 정보 (검증용 - 서버에서만 사용)
                    _original: {
                        deadline: task.deadline,
                        deadline_day: deadlineDay,
                        importance: task.importance || '중',
                        difficulty: task.difficulty || '중',
                        daysUntil: daysUntilDeadline,
                        estimatedMinutes: requiredMinutes
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
            
            
            // 사용자 메시지는 파싱 용도로만 원본을 보관하고,
            // OpenAI로 전달할 때는 간결한 지시 한 줄만 보낸다.
            const rawUserMessages = (messages || []).filter(m => m && m.role === 'user').slice(-6);
            const lastUserMessage = [...(messages || [])].reverse().find(m => m && m.role === 'user');

            const conciseInstruction = lastUserMessage
                ? '위에 정리된 lifestyle, tasks, 제약 조건을 바탕으로 scheduleData JSON을 생성해줘.'
                : '위의 데이터와 규칙에 맞춰 scheduleData를 JSON으로 생성해줘.';

            const userMessages = [
                {
                    role: 'user',
                    content: conciseInstruction
                }
            ];
            
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
                    time_preference: 'any', // 항상 'any'로 설정 (선호 시간대 제거)
                    require_daily: t.require_daily || false // 마감일까지 매일 배치 필요 여부
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
                const allUserContent = rawUserMessages.map(m => m.content || '').join('\n');
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
            if (opts.userFeedback && opts.userFeedback.trim()) {
                const feedbackText = opts.userFeedback.trim();
                
                // 피드백 내용 분석하여 구조화된 제약 조건 추출
                const feedbackLower = feedbackText.toLowerCase();
                
                // 1. 아침 시간대 선호도 감지
                const morningKeywords = ['아침', '오전', '아침형', '오전에', '오전 시간', '오전에 작업', '아침에 작업', '오전에 집중', '아침에 집중', '아침에 더'];
                const hasMorningPreference = morningKeywords.some(keyword => feedbackLower.includes(keyword));
                if (hasMorningPreference) {
                    feedbackConstraints.preferMorning = true;
                    feedbackSection += `\n- 오전 시간대(06:00~12:00) 우선 배치`;
                }
                
                // 2. 저녁 시간대 선호도 감지
                const eveningKeywords = ['저녁', '저녁형', '저녁에', '밤에', '저녁 시간', '저녁에 작업', '밤에 작업', '저녁에 집중'];
                const hasEveningPreference = eveningKeywords.some(keyword => feedbackLower.includes(keyword));
                if (hasEveningPreference) {
                    feedbackConstraints.preferEvening = true;
                    feedbackSection += `\n- 저녁 시간대(18:00~23:00) 우선 배치`;
                }
                
                // 3. 주말 업무 허용 감지
                const hasWeekendKeyword = feedbackLower.includes('주말');
                const hasWeekendWorkKeyword = feedbackLower.includes('업무') || feedbackLower.includes('일할') || 
                                      feedbackLower.includes('작업') || feedbackLower.includes('생성') ||
                                      feedbackLower.includes('배치') || feedbackLower.includes('공부');
                const weekendDenyPatterns = [
                    /주말[^.]*쉬고/,
                    /주말엔 쉬고/,
                    /주말에는 쉬어/,
                    /주말 쉬고 싶/,
                    /평일에만/,
                    /주말은 비워/,
                    /주말.*일.*안/,
                    /주말.*작업.*안/,
                    /주말.*일하기 싫/
                ];
                const weekendAllowPatterns = [
                    /주말에도/,
                    /주말에만/,
                    /주말 위주/,
                    /주말 시간이 가능/,
                    /주말 시간만/
                ];
                const weekendDeny = weekendDenyPatterns.some(pattern => pattern.test(feedbackLower));
                const weekendAllow = weekendAllowPatterns.some(pattern => pattern.test(feedbackLower));
                if (hasWeekendKeyword && hasWeekendWorkKeyword) {
                    if (weekendDeny) {
                        feedbackConstraints.prohibitWeekendTasks = true;
                        feedbackSection += `\n- 주말(day:6,7)에 task 배치 금지`;
                    } else if (weekendAllow) {
                        feedbackConstraints.allowWeekendTasks = true;
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
                    feedbackSection += `\n- 퇴근 후 1시간 이내 task 배치 금지`;
                }
                
                // 6. 출근 직후 작업 금지 감지
                if (feedbackLower.includes('출근') && (feedbackLower.includes('바로') || feedbackLower.includes('다음')) &&
                    (feedbackLower.includes('일') || feedbackLower.includes('작업') || feedbackLower.includes('배치')) &&
                    (feedbackLower.includes('안') || feedbackLower.includes('금지') || feedbackLower.includes('ㄴㄴ'))) {
                    feedbackConstraints.noWorkAfterArrival = true;
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
            const getEffectiveDeadlineDay = (task) =>
                Number.isFinite(task?.deadline_day) && task.deadline_day !== 999
                    ? task.deadline_day
                    : finalEndDay;
            
            
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
            
            // 시스템 프롬프트 생성 (별도 파일에서 관리)
            // slimMode: 항상 true로 설정하여 프롬프트 길이 최적화
            const slimMode = true;
            const { buildSystemPrompt } = require('../prompts/systemPrompt');
            const systemPrompt = buildSystemPrompt({
                finalStartDay,
                finalEndDay,
                lifestyleMappingText,
                tasksForAIJSON,
                constraintsText,
                slimMode
            });

            // 타이밍 로그 시작
            const T0 = Date.now();
            
            // 프롬프트 길이 체크 (대략적 토큰 추정: 1토큰 ≈ 4자)
            const totalChars = systemPrompt.content.length + userMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
            const approxTokens = Math.ceil(totalChars / 4);
            
            // 시스템 프롬프트를 맨 앞에 추가 (userMessages 줄인 후에 생성)
            const enhancedMessages = [systemPrompt, ...userMessages]
                .filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
            
            // 최종 프롬프트 길이 계산 및 로그 출력
            const finalPromptLength = enhancedMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
            const systemPromptLength = systemPrompt.content.length;
            const userMessagesLength = userMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
            console.log(`[프롬프트 길이] 전체: ${finalPromptLength}자 (시스템: ${systemPromptLength}자, 사용자: ${userMessagesLength}자)`);
        
            const basePayload = {
                model: 'gpt-4o-mini',
                messages: enhancedMessages,
                temperature: 0.3,
                response_format: { type: 'json_object' }
            };

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
            
            // 후보정 비활성화 (AI 원본 그대로 사용)
            // const lifestyleCoverageStats = ensureLifestyleCoverage(
            //     finalSchedule,
            //     lifestyleTexts,
            //     finalStartDay,
            //     finalEndDay,
            //     now
            // );
            // if (lifestyleCoverageStats.inserted > 0) {
            //     console.warn(`[보정] 누락된 lifestyle ${lifestyleCoverageStats.inserted}개 자동 보완됨`);
            // }
            
            // const taskCoverageStats = ensureTaskCoverage(
            //     finalSchedule,
            //     tasksForAI,
            //     finalStartDay,
            //     finalEndDay,
            //     now,
            //     getEffectiveDeadlineDay
            // );
            // if (taskCoverageStats.recoveredTasks > 0) {
            //     console.warn(`[보정] 누락된 task ${taskCoverageStats.recoveredTasks}건에 대해 ${taskCoverageStats.insertedBlocks}개 블록 자동 추가`);
            // } else if (taskCoverageStats.missingTasks > 0) {
            //     console.warn(`[경고] ${taskCoverageStats.missingTasks}개 task를 자동 배치하지 못했습니다.`);
            // }
            
            // const rebalancedTaskCount = rebalanceTasksWithinDays(finalSchedule, tasksForAI);
            // if (rebalancedTaskCount > 0) {
            //     console.warn(`[보정] task 시간대 재배치 ${rebalancedTaskCount}회 수행`);
            // }
            
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
                    const targetTitle = normalizeTitleForMatch(apt.title);
                    const activity = dayObj.activities.find(a => {
                        if (a.type !== 'task' && a.type !== 'appointment') return false;
                        const actTitle = normalizeTitleForMatch(a.title);
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
            
            // 2. time_preference 검증 및 수정 비활성화 (선호 시간대 제거)
            // if (feedbackConstraints.preferMorning) {
            //     const morningTasks = tasksForAI.filter(t => t.timePreference === 'morning');
            //     morningTasks.forEach(task => {
            //         const targetTitle = normalizeTitleForMatch(task.title);
            //         finalSchedule
            //             .filter(dayObj => {
            //                 const effectiveDeadline = getEffectiveDeadlineDay(task);
            //                 return dayObj.day >= baseRelDay && dayObj.day <= effectiveDeadline;
            //             })
            //             .forEach(dayObj => {
            //                 const activity = findMatchingActivity(dayObj, targetTitle);
            //                 const startMin = activity ? toMinutesSafe(activity.start) : null;
            //                 const endMin = activity ? toMinutesSafe(activity.end) : null;
            //                 if (!activity || startMin === null || endMin === null) return;
            //                 if (startMin >= 12 * 60) {
            //                     const duration = endMin - startMin;
            //                     relocateActivityWithinWindow(dayObj, activity, duration, 6 * 60, 12 * 60);
            //                 }
            //             });
            //     });
            // }

            // if (feedbackConstraints.preferEvening) {
            //     const eveningTasks = tasksForAI.filter(t => t.timePreference === 'evening');
            //     eveningTasks.forEach(task => {
            //         const targetTitle = normalizeTitleForMatch(task.title);
            //         finalSchedule
            //             .filter(dayObj => {
            //                 const effectiveDeadline = getEffectiveDeadlineDay(task);
            //                 return dayObj.day >= baseRelDay && dayObj.day <= effectiveDeadline;
            //             })
            //             .forEach(dayObj => {
            //                 const activity = findMatchingActivity(dayObj, targetTitle);
            //                 const startMin = activity ? toMinutesSafe(activity.start) : null;
            //                 const endMin = activity ? toMinutesSafe(activity.end) : null;
            //                 if (!activity || startMin === null || endMin === null) return;
            //                 if (startMin < 18 * 60) {
            //                     const duration = endMin - startMin;
            //                     relocateActivityWithinWindow(dayObj, activity, duration, 18 * 60, 23 * 60);
            //                 }
            //             });
            //     });
            // }

            if (feedbackConstraints.noWorkDuringLunch) {
                let lunchRelocated = 0;
                let lunchRemoved = 0;
                finalSchedule.forEach(dayObj => {
                    dayObj.activities = (dayObj.activities || []).filter(act => {
                        if (!act || act.type !== 'task') return true;
                        const startMin = toMinutesSafe(act.start);
                        const endMin = toMinutesSafe(act.end);
                        if (startMin === null || endMin === null) return true;
                        const overlap = !(endMin <= LUNCH_START_MIN || startMin >= LUNCH_END_MIN);
                        if (!overlap) return true;
                        const duration = endMin - startMin;
                        const moved =
                            relocateActivityWithinWindow(dayObj, act, duration, LUNCH_END_MIN, DAY_TOTAL_MINUTES) ||
                            relocateActivityWithinWindow(dayObj, act, duration, 0, LUNCH_START_MIN);
                        if (moved) {
                            lunchRelocated++;
                            return true;
                        }
                        lunchRemoved++;
                        return false;
                    });
                });
                if (lunchRelocated || lunchRemoved) {
                    console.warn(`[검증] 점심 시간 제약 적용 - 재배치:${lunchRelocated}, 제거:${lunchRemoved}`);
                }
            }

            if (feedbackConstraints.noWorkWithin1hAfterWork) {
                let afterWorkRelocated = 0;
                let afterWorkRemoved = 0;
                finalSchedule.forEach(dayObj => {
                    const workEnd = getLatestWorkEndMinute(dayObj);
                    if (workEnd === null) return;
                    const restrictedStart = workEnd;
                    const restrictedEnd = Math.min(DAY_TOTAL_MINUTES, workEnd + 60);
                    dayObj.activities = (dayObj.activities || []).filter(act => {
                        if (!act || act.type !== 'task') return true;
                        const startMin = toMinutesSafe(act.start);
                        const endMin = toMinutesSafe(act.end);
                        if (startMin === null || endMin === null) return true;
                        if (startMin >= restrictedStart && startMin < restrictedEnd) {
                            const duration = endMin - startMin;
                            const movedForward = relocateActivityWithinWindow(dayObj, act, duration, restrictedEnd, DAY_TOTAL_MINUTES);
                            const beforeWindowEnd = Math.max(0, restrictedStart - 5);
                            const movedBackward = !movedForward && beforeWindowEnd > 0
                                ? relocateActivityWithinWindow(dayObj, act, duration, 0, beforeWindowEnd)
                                : false;
                            const moved = movedForward || movedBackward;
                            if (moved) {
                                afterWorkRelocated++;
                                return true;
                            }
                            afterWorkRemoved++;
                            return false;
                        }
                        return true;
                    });
                });
                if (afterWorkRelocated || afterWorkRemoved) {
                    console.warn(`[검증] 퇴근 후 1시간 제약 적용 - 재배치:${afterWorkRelocated}, 제거:${afterWorkRemoved}`);
                }
            }
            
            // 3. 생활패턴 필터링: 사용자가 입력하지 않은 lifestyle 제거
            if (lifestyleTexts.length > 0) {
                const parsedLifestyle = lifestyleTexts
                    .map(text => parseLifestyleString(text))
                    .filter(p => p && Array.isArray(p.days) && p.days.length > 0)
                    .map(p => ({ ...p, normTitle: normalizeTitleForMatch(p.title) }));
                
                const isAllowedLifestyle = (title, relDay) => {
                    const weekdayNum = relDayToWeekdayNumber(relDay, now); // 1~7
                    const normTitle = normalizeTitleForMatch(title);
                    return parsedLifestyle.some(p => 
                        p.days.includes(weekdayNum) &&
                        (
                            normTitle === p.normTitle ||
                            (!normTitle && !p.normTitle) ||
                            (normTitle && p.normTitle && (normTitle.includes(p.normTitle) || p.normTitle.includes(normTitle)))
                        )
                    );
                };
                
                // 생활패턴 아닌 건 전부 삭제
                let removedLifestyleCount = 0;
                finalSchedule.forEach(dayObj => {
                    const beforeCount = dayObj.activities.filter(a => a.type === 'lifestyle').length;
                    dayObj.activities = dayObj.activities.filter(act => {
                        if (act.type !== 'lifestyle') return true;
                        const isAllowed = isAllowedLifestyle(act.title, dayObj.day);
                        if (!isAllowed) removedLifestyleCount++;
                        return isAllowed;
                    });
                });
                if (removedLifestyleCount > 0) {
                    console.warn(`[검증] 사용자가 입력하지 않은 생활패턴 ${removedLifestyleCount}개 제거됨`);
                }
            }
            
            // 4. 마감일 이후 배치 금지 검증
            let removedAfterDeadlineCount = 0;
            finalSchedule.forEach(dayObj => {
                dayObj.activities = dayObj.activities.filter(act => {
                    if (act.type !== 'task' && act.type !== 'appointment') return true;
                    
                    const actTitle = normalizeTitleForMatch(act.title);
                    const matchedTask = tasksForAI.find(t => {
                        const tTitle = normalizeTitleForMatch(t.title);
                        return actTitle === tTitle || 
                               actTitle.includes(tTitle) || 
                               tTitle.includes(actTitle);
                    });
                    if (!matchedTask) return true;
                    
                    // deadline_day 이후면 삭제
                    if (matchedTask.deadline_day !== 999 && dayObj.day > matchedTask.deadline_day) {
                        removedAfterDeadlineCount++;
                        return false;
                    }
                    return true;
                });
            });
            if (removedAfterDeadlineCount > 0) {
                console.warn(`[검증] 마감일 이후 배치된 작업 ${removedAfterDeadlineCount}개 제거됨`);
            }
            
            // 5. 피드백 기반 제약 조건 강제 적용 (주말 업무 금지)
            if (feedbackConstraints.prohibitWeekendTasks) {
                let removedWeekendTaskCount = 0;
                finalSchedule.forEach(dayObj => {
                    const weekdayNum = relDayToWeekdayNumber(dayObj.day, now); // 1~7
                    if (weekdayNum === 6 || weekdayNum === 7) { // 토, 일
                        const beforeCount = dayObj.activities.filter(a => a.type === 'task').length;
                        dayObj.activities = dayObj.activities.filter(a => a.type !== 'task');
                        removedWeekendTaskCount += beforeCount;
                    }
                });
                if (removedWeekendTaskCount > 0) {
                    console.warn(`[검증] 주말 업무 금지: 주말 task ${removedWeekendTaskCount}개 제거됨`);
                }
            }

            // notes를 explanation에 통합 (notes가 있으면 우선 사용)
            let finalExplanation = '';
            if (notes.length > 0) {
                finalExplanation = notes.join('\n');
            } else if (explanation?.trim()) {
                finalExplanation = explanation.trim();
            }
            
            const T_END = Date.now();
            
            // AI 응답과 스케줄 생성 시간 로그 출력 (프로덕션에서는 요약만)
            if (process.env.NODE_ENV !== 'production') {
                console.log(`[AI 응답]`, JSON.stringify(parsed, null, 2));
            } else {
                console.log(`[AI 응답 요약]`, {
                    days: finalSchedule.length,
                    activities: finalSchedule.reduce((sum, d) => sum + d.activities.length, 0),
                    notes: notes.length
                });
            }
            
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
