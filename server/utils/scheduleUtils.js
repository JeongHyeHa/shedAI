// 스케줄 관련 유틸리티 함수들

/**
 * HH:MM 문자열로 변환
 */
function hhmm(h, m = 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 시간값을 'HH:MM' 형태로 정규화 (문자열/숫자 모두 처리)
 */
function normalizeHHMM(v) {
    if (typeof v === 'string') {
        // '8', '8:3', '08:03' 모두 허용
        const m = v.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
        if (m) {
            const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
            const mm = Math.min(59, Math.max(0, parseInt(m[2] ?? '0', 10)));
            return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
        }
        // 이미 'HH:MM' 형태면 그대로 반환
        return v;
    }
    if (typeof v === 'number' && isFinite(v)) {
        const hh = Math.floor(v);
        const mm = Math.round((v - hh) * 60);
        return hhmm(hh, mm);
    }
    return '00:00';
}

/**
 * HH:MM을 분(minutes)으로 변환
 */
function timeToMinutes(timeStr) {
    const [h, m] = String(timeStr || '00:00').split(':').map(x => parseInt(x || '0', 10));
    return (h || 0) * 60 + (m || 0);
}

/**
 * 분(minutes)을 HH:MM으로 변환
 */
function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return hhmm(h, m);
}

/**
 * day를 요일로 변환
 */
function mapDayToWeekday(day, baseDate) {
    const koreanDays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const baseDay = baseDate.getDay();
    const dayOffset = day - (baseDay === 0 ? 7 : baseDay);
    const targetDate = new Date(baseDate);
    targetDate.setDate(targetDate.getDate() + dayOffset);
    return koreanDays[targetDate.getDay()];
}

/**
 * 상대 day(예: baseRelDay=7이면 오늘=7, 내일=8...) → 1..7(월=1~일=7)
 */
function relDayToWeekdayNumber(relDay, baseDate) {
    const baseRel = (baseDate.getDay() === 0 ? 7 : baseDate.getDay()); // 오늘의 1..7
    const diff = relDay - baseRel;
    const d = new Date(baseDate);
    d.setDate(d.getDate() + diff);
    const js = d.getDay(); // 0..6 (일=0)
    return js === 0 ? 7 : js; // 1..7 (월=1)
}

/**
 * 허용 day 집합 추출 (사용자 메시지만 대상, 예시/가이드 텍스트 무시)
 */
function extractAllowedDays(messages) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    
    // 코드블록/인라인코드/따옴표 예시 제거
    const scrub = (txt) =>
        txt
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/`[^`]*`/g, ' ')
            .replace(/"[^"]*"/g, ' ')
            .replace(/'[^']*'/g, ' ');
    const clean = scrub(lastUser);
    
    const re = /\(day:(\d+)\)/g;
    const days = [];
    for (const m of clean.matchAll(re)) {
        days.push(parseInt(m[1],10));
    }
    return Array.from(new Set(days)).sort((a,b)=>a-b);
}

module.exports = {
    hhmm,
    normalizeHHMM,
    timeToMinutes,
    minutesToTime,
    mapDayToWeekday,
    relDayToWeekdayNumber,
    extractAllowedDays
};

