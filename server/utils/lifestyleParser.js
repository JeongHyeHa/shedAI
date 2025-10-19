// 라이프스타일 패턴 파싱 유틸리티
const utils = {
    // day 번호를 한국어 요일로 변환
    getKoreanDayName(day) {
        const dayNames = ['', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
        return dayNames[day] || '알 수 없음';
    },

    // 시간 관련 단어 매핑 테이블
    timeKeywords: {
        // 시간대 키워드
        period: {
            '새벽': { offset: 0, range: [0, 6] },
            '아침': { offset: 0, range: [6, 12] },
            '오전': { offset: 0, range: [0, 12] },
            '오후': { offset: 12, range: [12, 18] },
            '저녁': { offset: 12, range: [18, 24] },
            '밤': { offset: 12, range: [20, 24] },
            '자정': { offset: 0, range: [0, 0] },
            '정오': { offset: 12, range: [12, 12] }
        },
        // 시간 단위
        hour: {
            '시': 1,
            '시간': 1
        },
        // 분 단위
        minute: {
            '분': 1
        }
    },

    // 날짜 관련 단어 매핑 테이블
    dateKeywords: {
        relative: {
            '오늘': 0,
            '내일': 1,
            '모레': 2,
            '어제': -1,
            '그저께': -2
        },
        week: {
            '다음주': 7,
            '이번주': 0,
            '저번주': -7
        }
    },

    // 시간 표현 파싱
    parseTimeExpression(timeStr) {
        if (!timeStr) return null;
        
        const cleanTime = timeStr.trim();
        
        // 자정, 정오 처리
        if (cleanTime === '자정') return 0;
        if (cleanTime === '정오') return 12;
        
        // 숫자만 있는 경우 (예: "8시", "15시")
        const simpleMatch = cleanTime.match(/^(\d{1,2})시?$/);
        if (simpleMatch) {
            const hour = parseInt(simpleMatch[1]);
            return hour >= 0 && hour <= 23 ? hour : null;
        }
        
        // 시간대 + 숫자 패턴 (예: "새벽 3시", "오후 5시")
        for (const [period, config] of Object.entries(this.timeKeywords.period)) {
            const pattern = new RegExp(`${period}\\s*(\\d{1,2})시?`);
            const match = cleanTime.match(pattern);
            if (match) {
                const hour = parseInt(match[1]);
                let adjustedHour = hour + config.offset;
                
                // 오후 12시는 12시 그대로 (정오)
                if (period === '오후' && hour === 12) {
                    adjustedHour = 12;
                }
                // 오전 12시는 0시 (자정)
                else if (period === '오전' && hour === 12) {
                    adjustedHour = 0;
                }
                
                return adjustedHour >= 0 && adjustedHour <= 23 ? adjustedHour : null;
            }
        }
        
        return null;
    },

    // 시간 범위 파싱
    parseTimeRange(pattern) {
        // 시간 범위 패턴 매칭 (예: "8시~10시", "저녁 8시~10시", "새벽 3시~오전 10시")
        const timeRangePattern = /([가-힣\s]*\d{1,2}시?)\s*[~-]\s*([가-힣\s]*\d{1,2}시?)/;
        const match = pattern.match(timeRangePattern);
        
        if (!match) return null;
        
        const startTime = this.parseTimeExpression(match[1].trim());
        const endTime = this.parseTimeExpression(match[2].trim());
        
        if (startTime === null || endTime === null) return null;
        
        // 밤새 패턴 확인 (예: 23:00~07:00)
        const isOvernight = startTime > endTime;
        
        return {
            start: startTime,
            end: endTime,
            isOvernight
        };
    },

    // 라이프스타일 패턴 파싱
    parseLifestylePattern(pattern) {
        if (!pattern) return null;
        
        const cleanPattern = pattern.trim();
        
        // "매일" 패턴 확인
        const isDaily = cleanPattern.includes('매일');
        
        // 요일 추출 (매일이 아닌 경우)
        let days = [];
        if (!isDaily) {
            // 주말/평일 패턴 먼저 확인
            if (cleanPattern.includes('주말')) {
                days = [6, 7]; // 토요일, 일요일
            } else if (cleanPattern.includes('평일')) {
                days = [1, 2, 3, 4, 5]; // 월요일~금요일
            } else {
                // 구체적인 요일 패턴 확인
                const dayPattern = /(월|화|수|목|금|토|일)요일/g;
                const dayMatches = cleanPattern.match(dayPattern);
                if (dayMatches) {
                    const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 7 };
                    days = dayMatches.map(day => dayMap[day.charAt(0)]);
                }
            }
        } else {
            days = [1, 2, 3, 4, 5, 6, 7]; // 매일인 경우 모든 요일
        }
        
        // 시간 범위 파싱
        const timeRange = this.parseTimeRange(cleanPattern);
        if (!timeRange) return null;
        
        // 활동 제목 추출 (시간 표현 제거 후)
        let title = cleanPattern
            .replace(/매일\s*/, '')
            .replace(/주말\s*/, '')
            .replace(/평일\s*/, '')
            .replace(/[월화수목금토일]요일\s*/g, '')
            .replace(/[가-힣\s]*\d{1,2}시?\s*[~-]\s*[가-힣\s]*\d{1,2}시?\s*/, '')
            .trim();
        
        return {
            title,
            days,
            start: timeRange.start,
            end: timeRange.end,
            isOvernight: timeRange.isOvernight,
            isDaily
        };
    },

    // 날짜 표현 파싱
    parseDateExpression(dateStr) {
        if (!dateStr) return null;
        
        const cleanDate = dateStr.trim();
        
        // 상대적 날짜 처리
        if (this.dateKeywords.relative[cleanDate] !== undefined) {
            return this.dateKeywords.relative[cleanDate];
        }
        
        // 주 단위 처리
        for (const [weekKey, offset] of Object.entries(this.dateKeywords.week)) {
            if (cleanDate.includes(weekKey)) {
                return offset;
            }
        }
        
        // 특정 날짜 처리 (예: "10월 27일", "12/25")
        const monthDayPattern = /(\d{1,2})월\s*(\d{1,2})일/;
        const monthDayMatch = cleanDate.match(monthDayPattern);
        if (monthDayMatch) {
            const month = parseInt(monthDayMatch[1]);
            const day = parseInt(monthDayMatch[2]);
            const now = new Date();
            const targetDate = new Date(now.getFullYear(), month - 1, day);
            const diffTime = targetDate.getTime() - now.getTime();
            return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
        
        return null;
    },

    // 사용자 작업 추출
    extractUserTasks(prompt) {
        if (!prompt) return [];
        
        const tasks = [];
        const lines = prompt.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // 작업 패턴 매칭 (날짜/요일 + 작업 내용)
            const taskPatterns = [
                /(오늘|내일|모레|다음주|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\d{1,2}월\s*\d{1,2}일)\s*(.+)/,
                /(.+)\s*(오늘|내일|모레|다음주|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\d{1,2}월\s*\d{1,2}일)/
            ];
            
            for (const pattern of taskPatterns) {
                const match = trimmedLine.match(pattern);
                if (match) {
                    let taskTitle, dateStr;
                    
                    if (pattern === taskPatterns[0]) {
                        dateStr = match[1];
                        taskTitle = match[2];
                    } else {
                        taskTitle = match[1];
                        dateStr = match[2];
                    }
                    
                    if (taskTitle && dateStr) {
                        const dayOffset = this.parseDateExpression(dateStr) || 0;
                        const targetDate = new Date();
                        targetDate.setDate(targetDate.getDate() + dayOffset);
                        
                        tasks.push({
                            title: taskTitle.trim(),
                            date: targetDate.toISOString().split('T')[0],
                            dayOffset
                        });
                    }
                    break;
                }
            }
        }
        
        return tasks;
    }
};

module.exports = utils;
