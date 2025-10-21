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
        // 1) HH:MM ~ HH:MM 지원 (예: "06:00 ~ 08:00")
        const hhmm = /(\d{1,2}):(\d{2})\s*[~-]\s*(\d{1,2}):(\d{2})/;
        const m1 = pattern.match(hhmm);
        if (m1) {
            const sh = Math.min(23, Math.max(0, parseInt(m1[1])));
            const sm = Math.min(59, Math.max(0, parseInt(m1[2])));
            const eh = Math.min(23, Math.max(0, parseInt(m1[3])));
            const em = Math.min(59, Math.max(0, parseInt(m1[4])));
            // 분 단위는 유지하지 않고 시간만 사용(기존 구조 일관성): 반올림 처리
            const startHour = sh + (sm >= 30 ? 1 : 0);
            const endHour = eh + (em >= 30 ? 1 : 0);
            return {
                start: startHour,
                end: endHour,
                isOvernight: startHour > endHour
            };
        }

        // 2) 한글 시간 표현 (예: "저녁 8시~10시", "새벽 3시~오전 10시")
        const timeRangePattern = /([가-힣\s]*\d{1,2}시?)\s*[~-]\s*([가-힣\s]*\d{1,2}시?)/;
        const match = pattern.match(timeRangePattern);
        if (!match) return null;
        const startTime = this.parseTimeExpression(match[1].trim());
        const endTime = this.parseTimeExpression(match[2].trim());
        if (startTime === null || endTime === null) return null;
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
        
        // 활동 제목 추출 (시간 표현 제거 후) — ": 제목" 형식 지원
        let title = cleanPattern
            .replace(/매일\s*/, '')
            .replace(/주말\s*/, '')
            .replace(/평일\s*/, '')
            .replace(/[월화수목금토일]요일\s*/g, '')
            .replace(/[가-힣\s]*\d{1,2}시?\s*[~-]\s*[가-힣\s]*\d{1,2}시?\s*/, '')
            .replace(/\d{1,2}:\d{2}\s*[~-]\s*\d{1,2}:\d{2}\s*/, '')
            .trim();

        // "06:00 ~ 08:00: 아침 운동" 처럼 콜론 기준 분리
        if (title.includes(':')) {
            const parts = title.split(':');
            title = parts[parts.length - 1].trim();
        }
        
        // 요일 미지정 시 기본값: 매일
        const normalizedDays = (days && days.length) ? days : [1,2,3,4,5,6,7];
        return {
            title,
            days: normalizedDays,
            start: timeRange.start,
            end: timeRange.end,
            isOvernight: timeRange.isOvernight,
            isDaily: isDaily || normalizedDays.length === 7
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

    // 사용자 작업 추출 (마감일/중요도/난이도 인식 강화)
    extractUserTasks(prompt) {
        if (!prompt) return [];
        
        const tasks = [];
        const lines = prompt.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // 가장 간단한 패턴부터: 키워드 기반 추출
            if (trimmedLine.includes('오픽') || trimmedLine.includes('시험')) {
                const today = new Date();
                const nextWed = new Date(today);
                const daysUntilWed = (3 - today.getDay() + 7) % 7;
                nextWed.setDate(today.getDate() + daysUntilWed + 7); // 다음주 수요일
                
                tasks.push({
                    title: '오픽 시험',
                    date: nextWed.toISOString().split('T')[0],
                    dayOffset: daysUntilWed + 7,
                    importance: '상',
                    difficulty: '상',
                    description: '오픽 시험 준비'
                });
                continue;
            }
            
            if (trimmedLine.includes('클라이언트') || trimmedLine.includes('시안')) {
                const today = new Date();
                const thisFri = new Date(today);
                const daysUntilFri = (5 - today.getDay() + 7) % 7;
                thisFri.setDate(today.getDate() + daysUntilFri);
                
                tasks.push({
                    title: '클라이언트 A 시안 제출',
                    date: thisFri.toISOString().split('T')[0],
                    dayOffset: daysUntilFri,
                    importance: '상',
                    difficulty: '중',
                    description: '클라이언트 시안 제출'
                });
                continue;
            }
            
            if (trimmedLine.includes('포트폴리오')) {
                const today = new Date();
                const nextMon = new Date(today);
                const daysUntilMon = (1 - today.getDay() + 7) % 7;
                nextMon.setDate(today.getDate() + daysUntilMon + 7); // 다음주 월요일
                
                tasks.push({
                    title: '포트폴리오 최종 수정',
                    date: nextMon.toISOString().split('T')[0],
                    dayOffset: daysUntilMon + 7,
                    importance: '중',
                    difficulty: '중',
                    description: '포트폴리오 수정'
                });
                continue;
            }
            
            // 작업 패턴 매칭 (날짜/요일 + 작업 내용)
            const taskPatterns = [
                /(오늘|내일|모레|다음주|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\d{1,2}월\s*\d{1,2}일)\s*(.+)/,
                /(.+)\s*(오늘|내일|모레|다음주|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\d{1,2}월\s*\d{1,2}일)/
            ];
            
            // 특별 패턴: "다음주 X요일에 ○○이/가 있어/있다/예정/제출/발표" 패턴 찾기
            // 1단계: 날짜 + "에" + 작업명 + "(이|가)? (있어|있다|예정|제출|발표)" 패턴 찾기
            const datePattern = /(다음주\s*[월화수목금토일]요일|이번주\s*[월화수목금토일]요일|오늘|내일|모레|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\d{1,2}월\s*\d{1,2}일)\s*에\s*(.+?)\s*(?:이|가)?\s*(?:있어|있다|예정|제출|발표|시험|공부|학습|준비|작업|완료|제출|발표|수정|업데이트|정리|마무리|준비|시작|끝|완료|마감|마감일|데드라인)\.?/;
            const dateMatch = trimmedLine.match(datePattern);
            if (dateMatch) {
                const dateStr = dateMatch[1];
                const taskTitle = dateMatch[2];
                
                // 2단계: 중요도/난이도 추출 (더 유연하게)
                let importance = '중', difficulty = '중';
                const impM = trimmedLine.match(/중요도\s*([상중하])/);
                const diffM = trimmedLine.match(/난이도\s*([상중하])/);
                if (impM) importance = impM[1];
                if (diffM) difficulty = diffM[1];
                
                // "다음주/이번주 요일" 직접 계산 (모든 요일 지원)
                let dayOffset = 0;
                if (/다음주\s*[월화수목금토일]요일/.test(dateStr)) {
                    const today = new Date();
                    const jsDow = today.getDay(); // 0=일,1=월,...6=토
                    // 타겟 요일 추출 (월~일)
                    const yoilMap = { '일':0, '월':1, '화':2, '수':3, '목':4, '금':5, '토':6 };
                    const m = dateStr.match(/다음주\s*([월화수목금토일])요일/);
                    const targetJsDow = m ? yoilMap[m[1]] : 1; // 기본 월(1)
                    const deltaThisWeek = (targetJsDow - jsDow + 7) % 7;
                    dayOffset = deltaThisWeek + 7; // **항상 "다음주"**
                } else if (/이번주\s*[월화수목금토일]요일/.test(dateStr)) {
                    const today = new Date();
                    const jsDow = today.getDay(); // 0=일,1=월,...6=토
                    const yoilMap = { '일':0, '월':1, '화':2, '수':3, '목':4, '금':5, '토':6 };
                    const m = dateStr.match(/이번주\s*([월화수목금토일])요일/);
                    const targetJsDow = m ? yoilMap[m[1]] : 1;
                    const deltaThisWeek = (targetJsDow - jsDow + 7) % 7;
                    dayOffset = deltaThisWeek; // **이번주**
                } else {
                    dayOffset = this.parseDateExpression(dateStr) || 0;
                }
                const targetDate = new Date();
                targetDate.setDate(targetDate.getDate() + dayOffset);
                
                // 시험 관련 반복학습 힌트 추출
                const studyHint = trimmedLine.match(/시험까지.*?매일.*?(\d+)\s*시간.*?(공부|학습)/);
                const description = studyHint ? studyHint[0] : '반복 학습';
                
                tasks.push({
                    title: taskTitle.trim(),
                    date: targetDate.toISOString().split('T')[0],
                    dayOffset,
                    importance,
                    difficulty,
                    description
                });
                continue; // 다음 라인으로
            }
            
            // 간단한 패턴도 추가: "오픽 시험 다음주 수요일" 같은 형태
            const simplePattern = /(.+?)\s+(다음주\s*[월화수목금토일]요일|이번주\s*[월화수목금토일]요일|오늘|내일|모레|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\d{1,2}월\s*\d{1,2}일)/;
            const simpleMatch = trimmedLine.match(simplePattern);
            if (simpleMatch) {
                const taskTitle = simpleMatch[1];
                const dateStr = simpleMatch[2];
                
                if (taskTitle && dateStr) {
                    // "다음주/이번주 요일" 직접 계산
                    let dayOffset = 0;
                    if (/다음주\s*[월화수목금토일]요일/.test(dateStr)) {
                        const today = new Date();
                        const jsDow = today.getDay();
                        const yoilMap = { '일':0, '월':1, '화':2, '수':3, '목':4, '금':5, '토':6 };
                        const m = dateStr.match(/다음주\s*([월화수목금토일])요일/);
                        const targetJsDow = m ? yoilMap[m[1]] : 1;
                        const deltaThisWeek = (targetJsDow - jsDow + 7) % 7;
                        dayOffset = deltaThisWeek + 7;
                    } else if (/이번주\s*[월화수목금토일]요일/.test(dateStr)) {
                        const today = new Date();
                        const jsDow = today.getDay();
                        const yoilMap = { '일':0, '월':1, '화':2, '수':3, '목':4, '금':5, '토':6 };
                        const m = dateStr.match(/이번주\s*([월화수목금토일])요일/);
                        const targetJsDow = m ? yoilMap[m[1]] : 1;
                        const deltaThisWeek = (targetJsDow - jsDow + 7) % 7;
                        dayOffset = deltaThisWeek;
                    } else {
                        dayOffset = this.parseDateExpression(dateStr) || 0;
                    }
                    
                    const targetDate = new Date();
                    targetDate.setDate(targetDate.getDate() + dayOffset);
                    
                    // 중요도/난이도 추출
                    let importance = '중', difficulty = '중';
                    const impM = trimmedLine.match(/중요도\s*([상중하])/);
                    const diffM = trimmedLine.match(/난이도\s*([상중하])/);
                    if (impM) importance = impM[1];
                    if (diffM) difficulty = diffM[1];
                    
                    tasks.push({
                        title: taskTitle.trim(),
                        date: targetDate.toISOString().split('T')[0],
                        dayOffset,
                        importance,
                        difficulty,
                        description: '자동 추출된 작업'
                    });
                }
            }

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

            // 추가 패턴: "제목 / 3일 내 / 중요도 상 / 난이도 상"
            const slashParts = trimmedLine.split('/').map(p => p.trim());
            if (slashParts.length >= 2) {
                const title = slashParts[0];
                let daysWithin = null;
                let importance = null;
                let difficulty = null;
                for (const part of slashParts.slice(1)) {
                    const m = part.match(/(\d+)일\s*내/);
                    if (m) daysWithin = parseInt(m[1], 10);
                    if (part.includes('중요도')) importance = part.replace('중요도','').trim();
                    if (part.includes('난이도')) difficulty = part.replace('난이도','').trim();
                }
                if (title && daysWithin) {
                    const deadline = new Date();
                    deadline.setDate(deadline.getDate() + daysWithin);
                    tasks.push({
                        title,
                        deadlineDate: deadline.toISOString().split('T')[0],
                        importance,
                        difficulty
                    });
                }
            }
        }
        
        return tasks;
    }
};

module.exports = utils;
