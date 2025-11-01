// Lifestyle 패턴 처리 유틸리티

const { normalizeHHMM, relDayToWeekdayNumber } = require('./scheduleUtils');

/**
 * 문자열 생활패턴을 파싱해서 객체로 변환
 */
function parseLifestyleString(patternStr) {
    try {
        // 시간 파싱 로직
        const parseTime = (timeStr) => {
            if (!timeStr) return null;
            
            // 자정, 정오 처리
            if (timeStr === '자정') return 0;
            if (timeStr === '정오') return 12;
            
            // 오전/오후 12시 처리
            if (timeStr === '오전 12시') return 0;
            if (timeStr === '오후 12시') return 12;
            
            // 일반 시간 패턴
            const timeMatch = timeStr.match(/(오전|오후)?\s*(\d{1,2})시/);
            if (!timeMatch) return null;
            
            const [, ampm, hour] = timeMatch;
            let h = parseInt(hour);
            
            if (ampm === '오전') {
                return h === 12 ? 0 : h;
            } else if (ampm === '오후') {
                return h === 12 ? 12 : h + 12;
            } else {
                // 시간대 키워드가 없는 경우
                if (timeStr.includes('새벽')) {
                    return h; // 새벽은 그대로
                } else if (timeStr.includes('저녁')) {
                    return h + 12; // 저녁은 12시간 추가
                } else {
                    return h; // 기본값
                }
            }
        };
        
        // 시간 범위 파싱 (HH:MM ~ HH:MM 지원 포함)
        const hhmmRange = patternStr.match(/(\d{1,2}:\d{2})\s*[~\-]\s*(\d{1,2}:\d{2})/);
        if (hhmmRange) {
            const start = hhmmRange[1];
            const end = hhmmRange[2];
            // 요일 파싱
            let days = [];
            if (patternStr.includes('평일')) {
                days = [1,2,3,4,5];
            } else if (patternStr.includes('주말')) {
                days = [6,7];
            } else if (patternStr.includes('매일')) {
                days = [1,2,3,4,5,6,7];
            } else {
                // 명시가 없으면 매일로 가정
                days = [1,2,3,4,5,6,7];
            }
            // 제목 추출 (시간 부분 제거)
            const title = patternStr
                .replace(hhmmRange[0], '')
                .replace(/(평일|주말|매일)\s*/g, '')
                .replace(/[\s:]+$/, '')
                .trim()
                .replace(/^[:\-~]+/, '')
                .trim();
            return {
                title: title || '활동',
                start,
                end,
                days
            };
        }

        // 시간 범위 파싱 (오전/오후 시각 표현)
        const timeRangeMatch = patternStr.match(/([가-힣\s]*\d{1,2}시?)\s*[~-]\s*([가-힣\s]*\d{1,2}시?)/);
        if (!timeRangeMatch) return null;
        
        const startTime = parseTime(timeRangeMatch[1].trim());
        const endTime = parseTime(timeRangeMatch[2].trim());
        
        if (startTime === null || endTime === null) return null;
        
        const start = `${String(startTime).padStart(2, '0')}:00`;
        const end = `${String(endTime).padStart(2, '0')}:00`;
        
        // 요일 파싱
        let days = [];
        if (patternStr.includes('평일')) {
            days = [1, 2, 3, 4, 5]; // 월~금
        } else if (patternStr.includes('주말')) {
            days = [6, 7]; // 토, 일
        } else if (patternStr.includes('매일')) {
            days = [1, 2, 3, 4, 5, 6, 7]; // 모든 요일
        } else {
            // 명시가 없으면 매일로 가정
            days = [1, 2, 3, 4, 5, 6, 7];
        }
        
        // 제목 추출 (시간 부분과 요일 부분 제거)
        let title = patternStr
            .replace(/([가-힣\s]*\d{1,2}시?)\s*[~-]\s*([가-힣\s]*\d{1,2}시?)/, '') // 시간 부분 제거
            .replace(/(평일|주말|매일)\s*/g, '') // 요일 키워드 제거
            .replace(/\s+/g, ' ') // 연속 공백 제거
            .trim();
        
        return {
            title: title || '활동',
            start: start,
            end: end,
            days: days
        };
    } catch (error) {
        console.error('문자열 패턴 파싱 실패:', error, patternStr);
        return null;
    }
}

/**
 * lifestyle patterns를 busy 배열로 변환
 */
function convertLifestyleToBusy(lifestylePatterns, baseDate, allowedDays) {
    const busy = [];
    const now = baseDate instanceof Date ? baseDate : new Date(baseDate);
    
    for (const pattern of (lifestylePatterns || [])) {
        let parsed = null;
        
        if (typeof pattern === 'string') {
            parsed = parseLifestyleString(pattern);
        } else if (pattern && typeof pattern === 'object') {
            parsed = {
                title: pattern.title || '활동',
                start: pattern.start || '09:00',
                end: pattern.end || '10:00',
                days: Array.isArray(pattern.days) ? pattern.days : []
            };
        }
        
        if (!parsed || !Array.isArray(parsed.days) || parsed.days.length === 0) continue;
        
        const start = normalizeHHMM(parsed.start);
        const end = normalizeHHMM(parsed.end);
        const title = (parsed.title || '활동').trim();
        
        // 각 day에 대해 busy 블록 생성
        for (const day of allowedDays) {
            const weekdayNum = relDayToWeekdayNumber(day, now);
            
            // 해당 요일에 맞는 패턴만 추가
            if (parsed.days.includes(weekdayNum)) {
                busy.push({
                    day,
                    start,
                    end,
                    title,
                    source: 'lifestyle'
                });
            }
        }
    }
    
    return busy;
}

module.exports = {
    parseLifestyleString,
    convertLifestyleToBusy
};

