// 스케줄 검증 및 재배치 유틸리티

const { timeToMinutes, minutesToTime } = require('../utils/scheduleUtils');

/**
 * AI placements 검증 및 재배치 (하드 가드레일)
 */
function validateAndRepair(placements, freeWindows, tasksById, now, baseRelDay, busy, weekendPolicy = 'allow') {
    const minutes = (hm) => {
        const [h, m] = String(hm || '00:00').split(':').map(x => parseInt(x || '0', 10));
        return (h || 0) * 60 + (m || 0);
    };
    const fmt = (m) => minutesToTime(m);
    
    const inWindow = (p, w) => {
        // freeWindows는 이미 day별로 그룹화되어 있으므로, day 체크 불필요
        // w.day는 없을 수 있고, p.day는 이미 freeWindows[p.day] 배열에서 체크됨
        return minutes(p.start) >= minutes(w.start) && 
               minutes(p.end) <= minutes(w.end);
    };
    
    const isWeekend = (day) => day === 6 || day === 7;
    
    const allowWeekend = (task, policy) => {
        // 주말 정책이 'rest'면 항상 금지
        if (policy === 'rest') return false;
        
        // 기본적으로 주말 허용
        return true;
    };
    
    const ok = [];
    const fix = [];
    
    // 1) 검증: 올바른 placements 분리
    for (const p of placements) {
        const taskId = p.task_id || p.taskId;
        const task = tasksById[taskId];
        if (!task) {
            console.log(`[validateAndRepair] taskId ${taskId} 없음, 제거`);
            continue;
        }
        
        const original = task._original || task;
        const deadlineDay = task.deadline_day || original.deadline_day || 999;
        const minBlockMinutes = task.min_block_minutes || original.min_block_minutes || 60;
        const dur = minutes(p.end) - minutes(p.start);
        
        // 디버깅: 마감일 정보 로깅
        if (p.day > deadlineDay) {
            console.log(`[validateAndRepair] 마감일 체크: ${task.title}, day ${p.day}, deadline_day ${deadlineDay}, task.deadline_day: ${task.deadline_day}, original.deadline_day: ${original.deadline_day}`);
        }
        
        // 검증 조건
        const within = freeWindows[p.day]?.some(w => inWindow(p, w)) || false;
        const beforeDeadline = p.day <= deadlineDay;
        const longEnough = dur >= minBlockMinutes;
        const noWeekendConflict = !isWeekend(p.day) || allowWeekend(task, weekendPolicy);
        
        // busy 충돌 체크 (시간 겹침 + 제목 중복)
        const dayBusy = (busy || []).filter(b => b.day === p.day);
        const normalizeTitle = (t) => (t || '').trim().toLowerCase().replace(/\s+/g, '');
        const taskTitle = normalizeTitle(task.title);
        const noBusyConflict = !dayBusy.some(b => {
            // 1) 시간 겹침 체크
            const bStart = minutes(b.start);
            const bEnd = minutes(b.end);
            const pStart = minutes(p.start);
            const pEnd = minutes(p.end);
            const timeOverlaps = !(pEnd <= bStart || bEnd <= pStart);
            
            // 2) 제목 중복 체크 (시간이 겹치지 않아도 같은 제목이면 중복)
            const bTitle = normalizeTitle(b.title);
            const titleMatches = taskTitle === bTitle;
            
            // 시간 겹침 또는 제목 중복이면 충돌
            return timeOverlaps || titleMatches;
        });
        
        if (within && beforeDeadline && longEnough && noWeekendConflict && noBusyConflict) {
            ok.push(p);
        } else {
            // 마감일 위반만 재배치 (다른 것은 제거)
            if (!beforeDeadline) {
                // 마감일 위반: 재배치 필요
                console.log(`[validateAndRepair] 마감일 위반, 재배치 필요: ${task.title} (day ${p.day} > deadline ${deadlineDay})`);
                fix.push({ placement: p, task, taskId });
            } else {
                // 마감일 외 다른 문제: 제거만 함
                console.log(`[validateAndRepair] 유효하지 않은 placement 제거: ${task.title}`, {
                    within, beforeDeadline, longEnough, noWeekendConflict, noBusyConflict,
                    day: p.day, start: p.start, end: p.end
                });
            }
        }
    }
    
    // 2) 재배치: 실패한 placements를 그리디로 재배치
    const usedWindows = JSON.parse(JSON.stringify(freeWindows)); // 깊은 복사
    
    for (const { placement: p, task, taskId } of fix) {
        const original = task._original || task;
        const deadlineDay = task.deadline_day || 999;
        const minBlockMinutes = task.min_block_minutes || 60;
        const preferAround = minutes(task.prefer_around || '19:00');
        
        // 가능한 windows 찾기
        const candidates = [];
        for (const day in usedWindows) {
            const dayNum = parseInt(day, 10);
            if (dayNum > deadlineDay) continue;
            
            // 주말 정책 체크
            if (isWeekend(dayNum) && !allowWeekend(task, weekendPolicy)) continue;
            
            for (const w of usedWindows[day]) {
                const winStart = minutes(w.start);
                const winEnd = minutes(w.end);
                const available = winEnd - winStart;
                
                if (available >= minBlockMinutes) {
                    // 선호 시간대 근처에 배치
                    let bestStart = Math.max(winStart, Math.min(winEnd - minBlockMinutes, preferAround - minBlockMinutes / 2));
                    bestStart = Math.max(winStart, Math.min(winEnd - minBlockMinutes, bestStart));
                    
                    candidates.push({
                        day: dayNum,
                        window: w,
                        start: bestStart,
                        end: bestStart + minBlockMinutes,
                        distance: Math.abs(preferAround - (bestStart + minBlockMinutes / 2))
                    });
                }
            }
        }
        
        // 선호 시간대 순으로 정렬
        candidates.sort((a, b) => a.distance - b.distance);
        
        if (candidates.length > 0) {
            const best = candidates[0];
            const repaired = {
                task_id: taskId,
                day: best.day,
                start: fmt(best.start),
                end: fmt(best.end)
            };
            
            // busy 충돌 체크
            const dayBusy = (busy || []).filter(b => b.day === best.day);
            const conflicts = dayBusy.some(b => {
                const bStart = minutes(b.start);
                const bEnd = minutes(b.end);
                return !(best.end <= bStart || bEnd <= best.start);
            });
            
            if (!conflicts) {
                ok.push(repaired);
                console.log(`[validateAndRepair] 재배치 성공: ${task.title} → day ${best.day}, ${repaired.start}-${repaired.end}`);
                
                // 사용한 구간 차감 (간단화: 해당 window를 사용한 만큼 축소)
                const winIdx = usedWindows[best.day].indexOf(best.window);
                if (winIdx >= 0) {
                    const window = usedWindows[best.day][winIdx];
                    if (best.start === minutes(window.start)) {
                        // 앞부분 사용 → 시작점 이동
                        window.start = fmt(best.end);
                    } else if (best.end === minutes(window.end)) {
                        // 뒷부분 사용 → 끝점 이동
                        window.end = fmt(best.start);
                    } else {
                        // 중간 사용 → split (간단화: 뒷부분만 남김)
                        window.start = fmt(best.end);
                    }
                }
            } else {
                console.log(`[validateAndRepair] 재배치 실패 (busy 충돌): ${task.title}`);
            }
        } else {
            console.log(`[validateAndRepair] 재배치 불가 (적합한 window 없음): ${task.title}`);
        }
    }
    
    return ok;
}

/**
 * AI placements를 기존 busy와 병합 (가드 적용)
 */
function mergeAIPlacements({ baseDate, busy, placements, breaks, tasksById, freeWindows = null, weekendPolicy = 'allow' }) {
    const { mapDayToWeekday, timeToMinutes, minutesToTime } = require('../utils/scheduleUtils');
    
    // baseDate는 Date 객체이거나 ISO 문자열일 수 있음
    const now = baseDate instanceof Date ? baseDate : (typeof baseDate === 'string' ? new Date(baseDate) : new Date());
    
    // baseRelDay 계산 (now 기준)
    const dayOfWeek = now.getDay();
    const baseRelDay = dayOfWeek === 0 ? 7 : dayOfWeek;
    
    // 1) 검증 및 재배치
    const validPlacements = validateAndRepair(
        placements, 
        freeWindows || {}, 
        tasksById, 
        now, 
        baseRelDay, 
        busy,
        weekendPolicy
    );
    
    // 2) 중복 제거
    const seen = new Set();
    const deduplicated = validPlacements.filter(p => {
        const taskId = p.task_id || p.taskId;
        const key = `${taskId}|${p.day}|${p.start}|${p.end}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
    
    // scheduledTasks로 변환
    const scheduledTasks = deduplicated.map(p => {
        const taskId = p.task_id || p.taskId;
        const task = tasksById[taskId];
        if (!task) {
            return null;
        }
        return {
            day: p.day,
            start: p.start,
            end: p.end,
            title: task.title,
            type: 'task',
            taskId: taskId
        };
    }).filter(Boolean); // null 제거
    
    // breaks를 break activities로 변환
    const breakActs = (breaks || []).map(b => ({
        day: b.day,
        start: b.start,
        end: b.end,
        title: '휴식',
        type: 'break'
    }));
    
    // busy를 lifestyle/event 타입으로 변환 (source 정보 유지)
    const busyActivities = (busy || []).map(b => ({
        ...b,
        type: b.source === 'event' ? 'appointment' : 'lifestyle'
    }));
    
    // busy + scheduledTasks + breaks 병합
    // 중복 체크: 같은 day + 같은 제목은 busy 우선
    const normalizeTitle = (t) => (t || '').trim().toLowerCase().replace(/\s+/g, '');
    const busyTitleMap = new Map(); // day -> Set(제목들)
    for (const b of busyActivities) {
        if (!busyTitleMap.has(b.day)) {
            busyTitleMap.set(b.day, new Set());
        }
        const normalized = normalizeTitle(b.title);
        busyTitleMap.get(b.day).add(normalized);
        console.log(`[mergeAIPlacements] busy 등록: ${b.title} → day ${b.day} (정규화: "${normalized}")`);
    }
    
    // scheduledTasks 중 busy와 중복되는 것 필터링
    console.log(`[mergeAIPlacements] scheduledTasks 검사 시작: ${scheduledTasks.length}개`);
    for (const st of scheduledTasks) {
        const busyTitles = busyTitleMap.get(st.day);
        const stTitle = normalizeTitle(st.title);
        console.log(`[mergeAIPlacements] 검사: ${st.title} (day ${st.day}, 정규화: "${stTitle}")`);
        if (busyTitles) {
            console.log(`[mergeAIPlacements] day ${st.day}의 busy 제목들:`, Array.from(busyTitles));
            if (busyTitles.has(stTitle)) {
                console.log(`[mergeAIPlacements] busy와 중복 매칭됨: "${stTitle}"`);
            }
        }
    }
    
    const filteredScheduledTasks = scheduledTasks.filter(st => {
        const busyTitles = busyTitleMap.get(st.day);
        if (!busyTitles || busyTitles.size === 0) {
            return true; // busy가 없으면 통과
        }
        const stTitle = normalizeTitle(st.title);
        if (busyTitles.has(stTitle)) {
            console.log(`[mergeAIPlacements] busy와 중복 제거: ${st.title} (day ${st.day}, ${st.start}-${st.end}, 정규화: "${stTitle}")`);
            return false;
        }
        return true;
    });
    
    console.log(`[mergeAIPlacements] scheduledTasks: ${scheduledTasks.length}개 → 필터링 후: ${filteredScheduledTasks.length}개`);
    
    // day 8 상세 로깅 (디버깅용)
    const day8Busy = busyActivities.filter(b => b.day === 8);
    const day8Scheduled = filteredScheduledTasks.filter(s => s.day === 8);
    if (day8Busy.length > 0 || day8Scheduled.length > 0) {
        console.log('[mergeAIPlacements] day 8 병합 전 상태:', {
            busy: day8Busy.map(b => ({ title: b.title, start: b.start, end: b.end, type: b.type })),
            scheduled: day8Scheduled.map(s => ({ title: s.title, start: s.start, end: s.end, type: s.type }))
        });
    }
    
    // 디버깅: filteredScheduledTasks에 "회의"가 포함되어 있는지 확인
    const meetingScheduled = filteredScheduledTasks.filter(s => s.title && s.title.includes('회의'));
    if (meetingScheduled.length > 0) {
        console.warn(`[mergeAIPlacements] filteredScheduledTasks에 "회의" 포함: ${meetingScheduled.length}개`, meetingScheduled.map(s => ({
            title: s.title,
            day: s.day,
            start: s.start,
            end: s.end,
            type: s.type
        })));
    }
    
    const allActivities = [
        ...busyActivities,
        ...filteredScheduledTasks,
        ...breakActs
    ];
    
    // 디버깅: allActivities의 day 2에 "회의"가 포함되어 있는지 확인
    const day2Activities = allActivities.filter(a => a.day === 2 && a.title && a.title.includes('회의'));
    if (day2Activities.length > 0) {
        console.warn(`[mergeAIPlacements] allActivities day 2에 "회의" 포함:`, day2Activities.map(a => ({
            title: a.title,
            start: a.start,
            end: a.end,
            type: a.type,
            source: a.source
        })));
    }
    
    // day별로 그룹화하여 정규화
    const byDay = {};
    for (const act of allActivities) {
        if (!byDay[act.day]) {
            byDay[act.day] = {
                day: act.day,
                weekday: mapDayToWeekday(act.day, now),
                activities: []
            };
        }
        byDay[act.day].activities.push(act);
    }
    
    // 디버깅: byDay의 day 2에 "회의"가 포함되어 있는지 확인
    if (byDay[2]) {
        const day2Acts = byDay[2].activities.filter(a => a.title && a.title.includes('회의'));
        if (day2Acts.length > 0) {
            console.warn(`[mergeAIPlacements] byDay day 2에 "회의" 포함:`, day2Acts.map(a => ({
                title: a.title,
                start: a.start,
                end: a.end,
                type: a.type,
                source: a.source
            })));
        }
    }
    
    // activities 시간순 정렬
    const toMin = (s) => {
        const [h, m] = String(s || '00:00').split(':').map(x => parseInt(x || '0', 10));
        return (h || 0) * 60 + (m || 0);
    };
    
        let schedule = Object.values(byDay)
            .map(dayObj => {
                // activities 시간순 정렬
                const sorted = dayObj.activities.sort((a, b) => toMin(a.start) - toMin(b.start));
                
                // 연속 작업 사이 간격 추가 (최소 10분)
                for (let i = 0; i < sorted.length - 1; i++) {
                    const current = sorted[i];
                    const next = sorted[i + 1];
                    
                    // 같은 타입의 연속 작업이면 간격 체크
                    if (current.type === 'task' && next.type === 'task' && current.day === next.day) {
                        const currentEnd = toMin(current.end);
                        const nextStart = toMin(next.start);
                        const gap = nextStart - currentEnd;
                        
                        // 간격이 10분 미만이면 다음 작업 시작 시간을 10분 늦춤
                        if (gap >= 0 && gap < 10) {
                            const adjustedStart = minutesToTime(currentEnd + 10);
                            console.log(`[mergeAIPlacements] 간격 추가: ${next.title} 시작 시간 조정 ${next.start} → ${adjustedStart} (day ${current.day})`);
                            sorted[i + 1].start = adjustedStart;
                        }
                    }
                }
                
                return {
                    ...dayObj,
                    activities: sorted
                };
            })
            .sort((a, b) => a.day - b.day);
        
        // 안전망 비활성화: AI 응답 신뢰 (greedyFillUrgentGaps 제거)
        // AI가 이미 최적 배치를 했으므로, 추가 배치는 중복을 만들 수 있음
        // schedule = greedyFillUrgentGaps(schedule, freeWindows, tasksById, now, baseRelDay, weekendPolicy);
        
        return schedule;
    }

/**
 * 안전망: 긴급·중요 작업 2시간 자동 패킹
 */
function greedyFillUrgentGaps(schedule, freeWindows, tasksById, now, baseRelDay, weekendPolicy) {
    const { timeToMinutes, minutesToTime, mapDayToWeekday } = require('../utils/scheduleUtils');
    
    const minutes = (hm) => {
        const [h, m] = String(hm || '00:00').split(':').map(x => parseInt(x || '0', 10));
        return (h || 0) * 60 + (m || 0);
    };
    
    const isWeekend = (day) => day === 6 || day === 7;
    const allowWeekend = (task, policy) => policy !== 'rest';
    
    // 점수 계산: urgency(마감 D) + priority + difficulty
    const score = (task) => {
        const original = task._original || task;
        const daysUntil = original.daysUntil || 999;
        const urgency = daysUntil <= 1 ? 3 : daysUntil <= 3 ? 2 : daysUntil <= 5 ? 1 : 0;
        const priority = original.importance === '상' ? 2 : original.importance === '중' ? 1 : 0;
        const difficulty = original.difficulty === '상' ? 1 : 0;
        return urgency * 3 + priority * 2 + difficulty;
    };
    
    // 이미 배치된 taskId 수집
    const placedTaskIds = new Set();
    for (const dayObj of schedule) {
        for (const act of (dayObj.activities || [])) {
            if (act.type === 'task' && act.taskId) {
                placedTaskIds.add(act.taskId);
            }
        }
    }
    
    // 긴급/중요 작업 중 미배치된 것 찾기
    const urgent = Object.values(tasksById)
        .filter(task => {
            if (placedTaskIds.has(task.id || task.title)) return false;
            const original = task._original || task;
            const highPriority = original.importance === '상';
            const highDifficulty = original.difficulty === '상';
            const daysUntil = original.daysUntil || 999;
            return (highPriority && highDifficulty) || daysUntil <= 3;
        })
        .sort((a, b) => score(b) - score(a));
    
    if (urgent.length === 0) return schedule;
    
    console.log(`[greedyFillUrgentGaps] 긴급/중요 미배치 작업 ${urgent.length}개 감지, 자동 배치 시작`);
    
    // day별로 free windows와 기존 activities 매핑
    const scheduleByDay = {};
    for (const dayObj of schedule) {
        scheduleByDay[dayObj.day] = dayObj;
    }
    
    for (const task of urgent) {
        const original = task._original || task;
        const minBlockMinutes = original.min_block_minutes || 120;  // 기본 2시간
        const deadlineDay = task.deadline_day || 999;
        let remain = minBlockMinutes;
        
        // deadline까지의 day 순회
        for (let day = baseRelDay; day <= Math.min(deadlineDay, baseRelDay + 13); day++) {
            if (remain <= 0) break;
            
            // 주말 정책 체크
            if (isWeekend(day) && !allowWeekend(task, weekendPolicy)) continue;
            
            const dayObj = scheduleByDay[day] || {
                day,
                weekday: mapDayToWeekday(day, now),
                activities: []
            };
            if (!scheduleByDay[day]) {
                scheduleByDay[day] = dayObj;
                schedule.push(dayObj);
            }
            
            // 기존 activities의 시간대 수집
            const taken = (dayObj.activities || []).map(a => ({
                start: minutes(a.start),
                end: minutes(a.end)
            })).sort((a, b) => a.start - b.start);
            
            // free windows 가져오기
            const windows = (freeWindows?.[day] || []).map(w => ({
                start: minutes(w.start),
                end: minutes(w.end)
            })).sort((a, b) => a.start - b.start);
            
            // 빈 구간 찾기 (taken과 windows의 교집합)
            for (const win of windows) {
                if (remain <= 0) break;
                
                // win 안에서 taken과 겹치지 않는 구간 찾기
                let currentStart = win.start;
                
                for (const block of taken) {
                    if (block.end <= currentStart) continue;  // 이미 지나감
                    if (block.start >= win.end) break;  // win 밖
                    
                    // currentStart ~ block.start 사이 공간 확인
                    if (block.start > currentStart) {
                        const available = block.start - currentStart;
                        if (available >= 60) {  // 최소 1시간
                            const fit = Math.min(remain, available);
                            const endMin = currentStart + fit;
                            
                            dayObj.activities.push({
                                day,
                                start: minutesToTime(currentStart),
                                end: minutesToTime(endMin),
                                title: task.title || original.title || '할 일',
                                type: 'task',
                                taskId: task.id
                            });
                            
                            console.log(`[greedyFillUrgentGaps] ${task.title} → day ${day}, ${minutesToTime(currentStart)}-${minutesToTime(endMin)}`);
                            remain -= fit;
                            if (remain <= 0) break;
                        }
                    }
                    
                    currentStart = Math.max(currentStart, block.end);
                }
                
                // 마지막 block 이후 ~ win.end 사이
                if (currentStart < win.end && remain > 0) {
                    const available = win.end - currentStart;
                    if (available >= 60) {
                        const fit = Math.min(remain, available);
                        const endMin = currentStart + fit;
                        
                        dayObj.activities.push({
                            day,
                            start: minutesToTime(currentStart),
                            end: minutesToTime(endMin),
                            title: task.title || original.title || '할 일',
                            type: 'task',
                            taskId: task.id
                        });
                        
                        console.log(`[greedyFillUrgentGaps] ${task.title} → day ${day}, ${minutesToTime(currentStart)}-${minutesToTime(endMin)}`);
                        remain -= fit;
                    }
                }
            }
        }
        
        if (remain > 0) {
            console.log(`[greedyFillUrgentGaps] ${task.title} 일부만 배치 (${minBlockMinutes - remain}/${minBlockMinutes}분)`);
        }
    }
    
    // 시간순 정렬
    for (const dayObj of schedule) {
        dayObj.activities = (dayObj.activities || []).sort((a, b) => minutes(a.start) - minutes(b.start));
    }
    
    return schedule.sort((a, b) => a.day - b.day);
}

module.exports = {
    validateAndRepair,
    mergeAIPlacements
};

