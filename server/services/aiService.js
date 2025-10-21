const axios = require('axios');

class AIService {
    constructor() {
        this.openaiApiKey = process.env.OPENAI_API_KEY;
    }

    // 허용 day 집합 추출 (사용자 메시지만 대상, 예시/가이드 텍스트 무시)
    extractAllowedDays(messages) {
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

    // day를 요일로 변환
    mapDayToWeekday(day, baseDate) {
        const koreanDays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
        const baseDay = baseDate.getDay();
        const dayOffset = day - (baseDay === 0 ? 7 : baseDay);
        const targetDate = new Date(baseDate);
        targetDate.setDate(targetDate.getDate() + dayOffset);
        return koreanDays[targetDate.getDay()];
    }

    // 상대 day(예: baseRelDay=7이면 오늘=7, 내일=8...) → 1..7(월=1~일=7)
    relDayToWeekdayNumber(relDay, baseDate) {
        const baseRel = (baseDate.getDay() === 0 ? 7 : baseDate.getDay()); // 오늘의 1..7
        const diff = relDay - baseRel;
        const d = new Date(baseDate);
        d.setDate(d.getDate() + diff);
        const js = d.getDay(); // 0..6 (일=0)
        return js === 0 ? 7 : js; // 1..7 (월=1)
    }

    // HH:MM 문자열로 변환
    hhmm(h, m = 0) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    // 시간값을 'HH:MM' 형태로 정규화 (문자열/숫자 모두 처리)
    normalizeHHMM(v) {
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
            return this.hhmm(hh, mm);
        }
        return '00:00';
    }

    // 문자열 생활패턴을 파싱해서 객체로 변환 (test_dates.js 로직 적용)
    parseLifestyleString(patternStr) {
        try {
            // test_dates.js의 시간 파싱 로직 적용
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

    // 스케줄 생성
    async generateSchedule(messages, lifestylePatterns = [], existingTasks = [], opts = {}) {
        try {
            // API 키 상태 로깅
            console.log('[aiService.generateSchedule] OpenAI API 키 상태:', {
                hasKey: !!this.openaiApiKey,
                keyLength: this.openaiApiKey ? this.openaiApiKey.length : 0,
                keyPrefix: this.openaiApiKey ? this.openaiApiKey.substring(0, 10) + '...' : 'none'
            });
            
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
                const extractedDays = this.extractAllowedDays(messages);
                taskDays = extractedDays;
                lifestyleDays = Array.from({ length: 14 }, (_, i) => baseRelDay + i);
            } else if (hasDeadline) {
                // 마감일이 있는 작업: 오늘부터 마감일까지 연속된 스케줄 생성
                const extractedDays = this.extractAllowedDays(messages);
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
            
            // 스케줄 생성에 특화된 시스템 프롬프트 추가
            const systemPrompt = {
                role: 'system',
                content: `당신은 사용자의 생활패턴과 할 일을 바탕으로 시간표를 설계하는 전문가입니다.

**현재 날짜: ${year}년 ${month}월 ${date}일 (${currentDayName})**

[CONSTRAINTS]
BASE_DAY: ${anchorDay}
ALLOWED_DAYS: ${allowedDays.join(',') || '없음'}
RETURN_FORMAT: day별로 스케줄을 생성하세요. 각 day는 {day, weekday, activities} 형태로 구성하세요. 최소 day:${anchorDay}부터 day:${anchorDay+13}까지 14일을 모두 포함하세요. 누락 없이 day 오름차순으로 출력하세요.
[/CONSTRAINTS]

**핵심 규칙:**
1. **🚨 CRITICAL: 할 일이 있으면 반드시 type: "task"로 배치하세요!** 
   - 할 일 목록의 각 항목을 최소 1회 이상 반드시 'type': 'task'로 배치
   - '자기 개발/공부' 같은 lifestyle로 대체/흡수 절대 금지
   - task 제목에 반드시 키워드 포함: 예) "OPIc 준비: 스피킹 모의고사"
2. 생활 패턴은 14일 동안 매일/평일/주말 규칙에 맞게 먼저 배치하고, 남는 시간에 할 일을 배치하세요
3. 평일(day:1~5)과 주말(day:6~7)을 정확히 구분하세요
4. 시간이 겹치지 않도록 주의하세요
5. 반복/확장 일정은 금지. 입력에 없는 날짜로 일정 만들지 마세요
6. 활동 타입 구분:
   - "lifestyle": 수면, 식사, 출근, 독서 등 반복되는 생활 패턴
   - "task": 특정 작업, 회의, 발표, 제출 등 일회성 할 일
7. **절대 금지**: 
   - 임의로 "출근 준비", "근무", "수면", "식사", "휴식", "준비", "마무리" 등을 추가하지 마세요
   - 사용자가 제공한 생활패턴과 할 일만 정확히 생성하세요
   - 중복된 활동을 생성하지 마세요
   - 생활패턴에 없는 활동은 절대 만들지 마세요
8. **주말/평일 구분**: 
   - "주말" 패턴은 토요일(day:6), 일요일(day:7)에만 적용
   - "평일" 패턴은 월요일(day:1)~금요일(day:5)에만 적용
   - "매일" 패턴은 모든 요일에 적용

[생활 패턴]
${lifestylePatterns.length > 0
  ? lifestylePatterns.map(p => {
      if (typeof p === 'string') {
        // 문자열인 경우 그대로 사용 (이미 파싱된 형태)
        return `- ${p}`;
      }
      
      // 객체인 경우 AI가 이해하기 쉬운 형식으로 변환
      const days = Array.isArray(p.days) ? p.days.join(',') : '';
      const title = p.title || '활동';
      
      // patternText에서 실제 시간 추출
      let timeRange = '';
      if (p.patternText) {
        // "평일 오전 8시~오후 5시 회사" → "08:00-17:00"
        const timeMatch = p.patternText.match(/(오전|오후)?\s*(\d{1,2})시~?(오전|오후)?\s*(\d{1,2})시/);
        if (timeMatch) {
          const [, ampm1, hour1, ampm2, hour2] = timeMatch;
          const h1 = parseInt(hour1);
          const h2 = parseInt(hour2);
          
          const startHour = (ampm1 === '오후' && h1 < 12) ? h1 + 12 : (ampm1 === '오전' && h1 === 12) ? 0 : h1;
          const endHour = (ampm2 === '오후' && h2 < 12) ? h2 + 12 : (ampm2 === '오전' && h2 === 12) ? 0 : h2;
          
          timeRange = `${String(startHour).padStart(2, '0')}:00-${String(endHour).padStart(2, '0')}:00`;
        } else {
          // 시간을 찾지 못한 경우 기본값 사용
          timeRange = '09:00-10:00';
        }
      } else {
        // patternText가 없는 경우 start/end 사용
        const s = this.normalizeHHMM(p.start);
        const e = this.normalizeHHMM(p.end);
        timeRange = `${s}-${e}`;
      }
      
      return `- ${days} ${timeRange} ${title}`;
    }).join('\n')
  : '- 생활 패턴 없음'}

[🚨 할 일 목록 - 반드시 type: "task"로 배치하세요!]
${existingTasks.length > 0 ? existingTasks.map(task => `- ${task.title} (마감일: ${task.deadline}, 중요도: ${task.importance}, 난이도: ${task.difficulty})`).join('\n') : '- 기존 할 일 없음'}

**현재 할 일 개수: ${existingTasks.length}개**
**⚠️ 위 할 일들을 lifestyle로 대체하지 말고 반드시 type: "task"로 배치하세요!**

**🚨🚨🚨 절대적인 규칙:**
- 반드시 day별로 스케줄을 생성하세요
- 각 day는 {day, weekday, activities} 형태로 구성하세요
- 마감일이 있는 작업은 오늘부터 마감일까지 연속된 스케줄을 생성하세요
- 주말(day:6, day:7)에도 적절한 활동을 배치하세요

**출력 형식 (day별 스케줄):**
{
  "schedule": [
    {
      "day": 3,
      "weekday": "수요일",
      "activities": [
        {
          "title": "수면",
          "start": "02:00",
          "end": "10:00",
          "type": "lifestyle"
        },
        {
          "title": "졸업작품 제출",
          "start": "09:00",
          "end": "10:00",
          "type": "task"
        }
      ]
    },
    {
      "day": 4,
      "weekday": "목요일",
      "activities": [
        {
          "title": "수면",
          "start": "02:00",
          "end": "10:00",
          "type": "lifestyle"
        }
      ]
    }
  ],
  "explanation": "스케줄 설계 이유를 구체적으로 설명하세요. 다음 사항들을 포함해야 합니다:\n1. 각 할 일을 왜 그 시간대에 배치했는지\n2. 중요도×긴급도(Eisenhower) + 마감일 잔여시간 + 난이도 + 예상 소요시간을 어떻게 반영했는지\n3. 생활패턴과의 조화는 어떻게 이루었는지\n4. 주말과 평일의 차이점은 어떻게 반영했는지\n5. 마감일까지의 시간 분배는 어떻게 계획했는지 (연속적인 일자 배치 포함)\n6. 사용자의 요구사항은 어떻게 반영했는지"
}

"배치 기준(엄격)":
- 중요도 상이면서 난이도 상인 작업은 하루 최소 90분 이상, 연속 45~60분 단위 블록으로 배치하세요.
- 마감까지 남은 시간이 짧을수록 하루 투입 시간을 늘리되, 생활패턴과 겹치지 않도록 조정하세요.
- 같은 작업은 가능한 동일 시간대에 반복 배치하여 루틴을 형성하되, 겹치면 이웃 시간대로 이동하세요.
}

**중요**: 
- 위 형식과 정확히 일치해야 합니다. 다른 형식은 절대 사용하지 마세요.
- "explanation" 필드는 반드시 포함하고, 구체적이고 유용한 설명을 제공하세요.
- 빈 문자열이나 "스케줄 설계 이유" 같은 플레이스홀더는 사용하지 마세요.
JSON만 반환하세요.`
            };

            // 시스템 프롬프트를 맨 앞에 추가
            const enhancedMessages = [systemPrompt, ...messages]
                .filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
            
            console.log('API 키 존재:', !!this.openaiApiKey);
            console.log('API 키 길이:', this.openaiApiKey ? this.openaiApiKey.length : 0);
            console.log('요청 메시지 수:', enhancedMessages.length);

            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4o-mini', // 더 빠른 모델로 변경
                    messages: enhancedMessages,
                    temperature: 0.7,
                    max_tokens: 3000, // 토큰 수 증가
                    response_format: { type: 'json_object' }
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.openaiApiKey}`
                    },
                    timeout: 60000 // 60초 타임아웃으로 증가
                }
            );

            const content = response.data.choices?.[0]?.message?.content;
            
            if (!content) {
                throw new Error('AI 응답이 비어있습니다.');
            }
            
            // JSON 파싱 - 더 강화된 처리
            try {
                console.log('AI 원본 응답 길이:', content.length);
                
                // 여러 JSON 객체가 있을 수 있으므로 가장 큰 것 찾기
                let bestJson = null;
                let maxLength = 0;
                
                // { 로 시작하는 모든 JSON 객체 찾기
                let start = 0;
                while (start < content.length) {
                    const jsonStart = content.indexOf('{', start);
                    if (jsonStart === -1) break;
                    
                    // 이 위치에서 시작하는 JSON 객체의 끝 찾기
                    let braceCount = 0;
                    let jsonEnd = -1;
                    
                    for (let i = jsonStart; i < content.length; i++) {
                        if (content[i] === '{') braceCount++;
                        else if (content[i] === '}') {
                            braceCount--;
                            if (braceCount === 0) {
                                jsonEnd = i;
                                break;
                            }
                        }
                    }
                    
                    if (jsonEnd !== -1) {
                        const jsonString = content.substring(jsonStart, jsonEnd + 1);
                        if (jsonString.length > maxLength) {
                            bestJson = jsonString;
                            maxLength = jsonString.length;
                        }
                    }
                    
                    start = jsonStart + 1;
                }
                
                if (!bestJson) {
                    throw new Error('유효한 JSON 객체를 찾을 수 없습니다.');
                }
                
                console.log('추출된 JSON 길이:', bestJson.length);
                
                // JSON 파싱
                let parsed;
                try {
                    parsed = JSON.parse(bestJson);
                } catch (jsonError) {
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
                    parsed = JSON.parse(validJson);
                }
                
                // === 응답 구조 통합 파서 ===
                // 1) 모델이 어떤 스키마로 보냈든 activitiesOnly로 통일
                let activitiesOnly = [];
                let meta = {};

                if (Array.isArray(parsed.activities)) {
                    // 구(舊) activities-only 모드
                    activitiesOnly = parsed.activities;
                    meta.explanation = parsed.explanation ?? '';
                } else if (Array.isArray(parsed.schedule)) {
                    // 신(新) schedule 모드 → day-structured를 우선 보존
                    meta.parsedSchedule = parsed.schedule;
                    meta.explanation = parsed.explanation ?? '';
                    meta.activityAnalysis = parsed.activityAnalysis ?? null;
                    meta.notes = Array.isArray(parsed.notes) ? parsed.notes : [];
                    // also collect activities for validation below
                    for (const dayObj of parsed.schedule) {
                        if (dayObj && Array.isArray(dayObj.activities)) {
                            activitiesOnly.push(...dayObj.activities);
                        }
                    }
                } else {
                    throw new Error('AI 응답에 activities 또는 schedule이 없습니다.');
                }

                // 🔁 (순서 중요) lifestyleAllowSet을 먼저 만든 뒤에 유효성 검증에서 사용
                const lifestyleAllowSet = new Set(
                    (lifestylePatterns || []).map(p => {
                        if (typeof p === 'string') return p.trim();
                        const t = (p.title || '').trim();
                        const s = this.normalizeHHMM(p.start);
                        const e = this.normalizeHHMM(p.end);
                        return `${t}|${s}|${e}`;
                    })
                );

                // 2) 최소 필수 필드 검증 (start/end/title/type)
                const isValidAct = (a) =>
                    a && typeof a.start === 'string' && typeof a.end === 'string' &&
                    typeof a.title === 'string' && (a.type === 'lifestyle' || a.type === 'task');

                activitiesOnly = activitiesOnly.filter(isValidAct);
                
                // 3) 중복 제거 및 유효성 검증
                const seen = new Set();
                const validActivities = [];
                
                for (const activity of activitiesOnly) {
                    const key = `${activity.title}-${activity.start}-${activity.end}-${activity.type}`;
                    
                    // 중복 체크
                    if (seen.has(key)) {
                        console.log(`중복 활동 제거: ${activity.title}`);
                        continue;
                    }
                    
                    // 유효성 검증
                    if (!activity.title || !activity.start || !activity.end || !activity.type) {
                        console.log(`유효하지 않은 활동 제거:`, activity);
                        continue;
                    }
                    
                    // 임의 활동 제거 (사용자가 제공하지 않은 활동들)
                    const forbiddenActivities = ['출근 준비', '근무', '준비', '마무리', '휴식'];
                    
                    // 1) 정확 키 일치 우선
                    const activityKey = `${(activity.title || '').trim()}|${this.normalizeHHMM(activity.start)}|${this.normalizeHHMM(activity.end)}`;
                    const allowByKey = lifestyleAllowSet.has(activityKey);
                    // 2) 타이틀만 허용(레거시 호환)
                    const allowByTitleOnly = [...lifestyleAllowSet].some(x => !x.includes('|') && x.includes((activity.title || '').trim()));
                    
                    // 금지어 정규화 비교
                    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '').trim();
                    const banned = forbiddenActivities.map(norm);
                    const activityTitleNorm = norm(activity.title);
                    
                    if (banned.some(b => activityTitleNorm.includes(b)) && !(allowByKey || allowByTitleOnly)) {
                        console.log(`임의 활동 제거: ${activity.title}`);
                        continue;
                    }
                    
                    seen.add(key);
                    validActivities.push(activity);
                }
                
                activitiesOnly = validActivities;
                if (activitiesOnly.length === 0) {
                    // 필요 시 기본 한 개 생성 (원치 않으면 이 블럭 제거)
                    // activitiesOnly = [{ title:'작업', start:'09:00', end:'10:00', type:'task' }];
                }

                // === 생활패턴 인덱스 생성 ===
                const patternIndex = new Map();
                for (const p of (lifestylePatterns || [])) {
                    if (typeof p === 'string') {
                        // 문자열 패턴을 파싱해서 patternIndex에 추가
                        const parsed = this.parseLifestyleString(p);
                        if (parsed) {
                            const s = this.normalizeHHMM(parsed.start);
                            const e = this.normalizeHHMM(parsed.end);
                            const title = parsed.title.trim();
                            const key = `${title}|${s}|${e}`;
                            if (Array.isArray(parsed.days) && parsed.days.length) {
                                patternIndex.set(key, parsed.days.slice());
                                console.log(`패턴 인덱스 추가 (문자열): ${key} → ${parsed.days}`);
                            }
                        }
                        continue;
                    }
                    
                    // 객체 패턴 처리
                    const s = this.normalizeHHMM(p.start);
                    const e = this.normalizeHHMM(p.end);
                    const title = (p.title || '').trim();
                    const key = `${title}|${s}|${e}`;
                    if (Array.isArray(p.days) && p.days.length) {
                        patternIndex.set(key, p.days.slice()); // 1..7
                        console.log(`패턴 인덱스 추가 (객체): ${key} → ${p.days}`);
                    }
                }

                // === AI 활동을 요일별로 분류 ===
                const tasks = activitiesOnly.filter(a => a.type === 'task');
                const lifestylesRaw = activitiesOnly.filter(a => a.type === 'lifestyle');

                // lifestyle 활동에 적용 요일을 매핑 (제목+시간으로 패턴 찾기)
                const lifestyles = lifestylesRaw.map(a => {
                    const s = this.normalizeHHMM(a.start);
                    const e = this.normalizeHHMM(a.end);
                    const title = (a.title || '').trim();
                    const key = `${title}|${s}|${e}`;
                    const days = patternIndex.get(key);
                    console.log(`활동 매칭 시도: ${key} → ${days || '매칭 없음'}`);
                    return days ? { ...a, start: s, end: e, __days: days } : { ...a, start: s, end: e, __days: [] };
                });

                // === 서버가 day를 결정하고 스케줄 조립 ===
                let finalSchedule = [];
                // 0) AI가 day-structured 스케줄을 준 경우 그대로 사용하되,
                //    lifestyle의 요일 일관성만 적용하여 필터링
                if (Array.isArray(meta.parsedSchedule) && meta.parsedSchedule.length > 0) {
                    const normalized = [];
                    for (const dayObj of meta.parsedSchedule) {
                        if (!dayObj || !Array.isArray(dayObj.activities)) continue;
                        const dayVal = typeof dayObj.day === 'number' ? dayObj.day : anchorDay;
                        const weekdayNum = this.relDayToWeekdayNumber(dayVal, now);
                        const normActs = dayObj.activities.map(a => ({
                            ...a,
                            start: this.normalizeHHMM(a.start),
                            end: this.normalizeHHMM(a.end)
                        }));
                        // lifestyle는 해당 요일만, task는 그대로 유지
                        const filtered = normActs.filter(a => {
                            if (a.type === 'lifestyle') {
                                const s = this.normalizeHHMM(a.start);
                                const e = this.normalizeHHMM(a.end);
                                const key = `${(a.title || '').trim()}|${s}|${e}`;
                                const days = patternIndex.get(key);
                                return Array.isArray(days) && days.includes(weekdayNum);
                            }
                            return true;
                        });
                        normalized.push({
                            day: dayVal,
                            weekday: this.mapDayToWeekday(dayVal, now),
                            activities: filtered
                        });
                    }
                    // 14일 라이프스타일 베이스로 확장: 누락된 day는 lifestyle-only로 채우기
                    const haveDays = new Set(normalized.map(d => d.day));
                    for (const day of lifestyleDays) {
                        if (!haveDays.has(day)) {
                            const weekdayNum = this.relDayToWeekdayNumber(day, now);
                            const dayLifestyles = lifestyles.filter(l => Array.isArray(l.__days) && l.__days.includes(weekdayNum));
                            if (dayLifestyles.length) {
                                normalized.push({
                                    day,
                                    weekday: this.mapDayToWeekday(day, now),
                                    activities: dayLifestyles
                                });
                            }
                        }
                    }
                    normalized.sort((a,b)=>a.day-b.day);
                    if (normalized.length > 0) {
                        finalSchedule = normalized;
                    }
                }

                // 1) 위 보존 경로가 비어있는 경우에만 서버 조립 경로 사용
                if (finalSchedule.length === 0) {
                if (allowedDays.length === 1) {
                    const targetDay = allowedDays[0];
                    const weekdayNum = this.relDayToWeekdayNumber(targetDay, now);
                    
                    // 해당 요일에 맞는 생활패턴만 필터링
                    const dayLifestyles = lifestyles.filter(l =>
                        Array.isArray(l.__days) && l.__days.includes(weekdayNum)
                    );
                    
                    const dayTasks = taskDays.includes(targetDay) ? tasks.slice() : [];
                    const dayActivities = [...dayLifestyles, ...dayTasks];
                    
                    finalSchedule = [{
                        day: targetDay,
                        weekday: this.mapDayToWeekday(targetDay, now),
                        activities: dayActivities
                    }];
                    } else if (allowedDays.length > 1) {
                    // 다중 day 분배: 요일별로 정확한 생활패턴 적용
                    for (const day of allowedDays) {
                        const weekdayNum = this.relDayToWeekdayNumber(day, now); // 1..7
                        
                        // ① lifestyle: 해당 활동의 __days에 오늘 요일이 들어간 것만
                        const dayLifestyles = lifestyles.filter(l =>
                            Array.isArray(l.__days) && l.__days.includes(weekdayNum)
                        );
                        
                        // ② task: 원래 로직대로 오늘이 taskDays에 속할 때만
                        const dayTasks = taskDays.includes(day) ? tasks.slice() : [];
                        
                        const dayActivities = [...dayLifestyles, ...dayTasks];
                        
                        if (dayActivities.length > 0) {
                            finalSchedule.push({
                                day,
                                weekday: this.mapDayToWeekday(day, now),
                                activities: dayActivities
                            });
                        }
                        }
                    }
                } else {
                    // 허용 day가 없으면 anchorDay에 배치
                    const weekdayNum = this.relDayToWeekdayNumber(anchorDay, now);
                    const dayLifestyles = lifestyles.filter(l =>
                        Array.isArray(l.__days) && l.__days.includes(weekdayNum)
                    );
                    const dayTasks = tasks.slice();
                    const dayActivities = [...dayLifestyles, ...dayTasks];
                    
                    finalSchedule = [{
                        day: anchorDay,
                        weekday: this.mapDayToWeekday(anchorDay, now),
                        activities: dayActivities
                    }];
                }
                // end of server assembly fallback
                
                // 빈 스케줄 방지 안전망
                if (!finalSchedule.length) {
                    console.log('[AISVC_V2] 빈 스케줄 감지 - 최소 스케줄 생성');
                    const weekdayNum = this.relDayToWeekdayNumber(anchorDay, now);
                    const dayLifestyles = lifestyles.filter(l => Array.isArray(l.__days) && l.__days.includes(weekdayNum));
                    finalSchedule = [{
                        day: anchorDay,
                        weekday: this.mapDayToWeekday(anchorDay, now),
                        activities: dayLifestyles
                    }];
                }
                
                console.log('JSON 파싱 성공, activities 개수:', activitiesOnly.length);
                
                // === (신규) 분산 재배치 유틸 ===
                const toMin = hhmm => {
                    const [h,m] = hhmm.split(':').map(n=>parseInt(n,10));
                    return h*60+m;
                };
                const overlap = (a,b) => !(toMin(a.end)<=toMin(b.start) || toMin(b.end)<=toMin(a.start));

                function redistributeTasks(finalSchedule, { taskDays=[] } = {}) {
                    // 1) 시간대 슬롯(120분) 정의 (UI 라운딩 고려)
                    const SLOT_POOL = [
                        ['09:00','11:00'], ['11:00','13:00'],
                        ['14:00','16:00'], ['16:00','18:00'], ['19:00','21:00']
                    ];

                    // 2) day별로 lifestyle(고정) 점유표 만들고, task들은 임시 제거
                    const dayMap = new Map();
                    for (const dayObj of finalSchedule) {
                        const fixed = [];
                        const tasks = [];
                        for (const a of (dayObj.activities||[])) {
                            if (a.type === 'lifestyle') fixed.push({ start:a.start, end:a.end, title:a.title, type:a.type });
                            else tasks.push(a);
                        }
                        dayMap.set(dayObj.day, { fixed, tasks });
                        // 일단 task 비움
                        dayObj.activities = fixed.slice();
                    }

                    // 3) 우선순위 점수 (없어도 안전한 기본값)
                    const importanceMap = { '상':3, '중':2, '하':1 };
                    const difficultyMap = { '상':1, '중':0, '하':-0.5 };

                    // 4) 모든 day의 task를 하나의 배열로 모은 뒤, 마감/중요도 기반으로 정렬
                    const bundled = [];
                    for (const [day, { tasks }] of dayMap.entries()) {
                        for (const t of tasks) {
                            bundled.push({ day, t });
                        }
                    }
                    bundled.sort((x,y)=>{
                        const tx = x.t, ty = y.t;
                        const s1 = (importanceMap[tx.importance] ?? 1) + (difficultyMap[tx.difficulty] ?? 0);
                        const s2 = (importanceMap[ty.importance] ?? 1) + (difficultyMap[ty.difficulty] ?? 0);
                        // 긴급도: 남은 일수 적을수록 가산 (finalSchedule의 최소 day 기준)
                        const minDay = Math.min(...finalSchedule.map(d=>d.day));
                        const dueX = Number.isFinite(tx.relativeDay) ? Math.max(1, tx.relativeDay - minDay + 1) : 999;
                        const dueY = Number.isFinite(ty.relativeDay) ? Math.max(1, ty.relativeDay - minDay + 1) : 999;
                        const u1 = 1 / dueX, u2 = 1 / dueY;
                        return (s2 + u2) - (s1 + u1);
                    });

                    // 5) 해시로 시작 슬롯 다양화(같은 제목이 매일 같은 슬롯 고정되게)
                    const hash = str => [...String(str)].reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0);

                    // 6) day별로 빈 슬롯 탐색해 task 배치
                    const allDays = finalSchedule.map(d=>d.day).sort((a,b)=>a-b);
                    const dayList = taskDays.length ? allDays.filter(d=>taskDays.includes(d)) : allDays;
                    const byDay = (d)=>finalSchedule.find(x=>x.day===d);

                    for (const item of bundled) {
                        const task = item.t;
                        // 상대 마감일이 있으면 그 날까지만, 없으면 전체 기간 고려
                        const dueRel = Number.isFinite(task.relativeDay) ? task.relativeDay : Math.max(...dayList);
                        for (const day of dayList) {
                            if (day > dueRel) continue;
                            const node = byDay(day);
                            const taken = node.activities.map(a=>({start:a.start,end:a.end}));
                            // 시작 슬롯을 제목 해시로 시프팅
                            const offset = Math.abs(hash(task.title||'할 일')) % SLOT_POOL.length;
                            let placed = false;
                            for (let i=0;i<SLOT_POOL.length;i++){
                                const [s,e] = SLOT_POOL[(i+offset)%SLOT_POOL.length];
                                const probe = { start:s, end:e };
                                const clash = taken.some(x=>overlap(x, probe));
                                if (!clash) {
                                    node.activities.push({ title: task.title || '할 일', start:s, end:e, type:'task' });
                                    placed = true;
                                    break;
                                }
                            }
                            if (placed) break; // 하루 1블록만 먼저 채우고 다음 날로
                        }
                    }

                    // 7) 시간순 정렬
                    for (const d of finalSchedule) {
                        d.activities.sort((a,b)=>toMin(a.start)-toMin(b.start));
                    }
                }

                // === (여기에 추가) 만약 task가 한 시간대로 몰리면 재배치 ===
                (function fixClustering(){
                    const starts = [];
                    for (const d of finalSchedule) {
                        for (const a of (d.activities||[])) {
                            if (a.type==='task') starts.push(a.start);
                        }
                    }
                    if (starts.length >= 3) {
                        // 30분 버킷으로 클러스터링 감지 (14:00, 14:30 → 14:00 버킷)
                        const bucket = s => {
                            const [h,m]=s.split(':').map(Number);
                            const half = m<30? '00':'30';
                            return `${String(h).padStart(2,'0')}:${half}`;
                        };
                        const freq = starts.map(bucket).reduce((m,s)=>(m[s]=(m[s]||0)+1,m),{});
                        const [topStart, topCnt] = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0] || [];
                        if (topCnt / starts.length >= 0.6) { // 60% 이상이 한 시간대면 클러스터로 판단
                            console.log(`[REDISTRIBUTE] 클러스터링 감지: ${topStart}에 ${topCnt}/${starts.length} 집중`);
                            redistributeTasks(finalSchedule, { taskDays });
                        }
                    }
                })();
                
                // 보정: anchorDay부터 14일 연속 채우기 (누락 day는 lifestyle-only로)
                const wantDays = Array.from({length:14}, (_,i)=>anchorDay+i);
                const have = new Set(finalSchedule.map(d=>d.day));
                for (const d of wantDays) {
                    if (!have.has(d)) {
                        const weekdayNum = this.relDayToWeekdayNumber(d, now);
                        const dayLifestyles = lifestyles.filter(l => Array.isArray(l.__days) && l.__days.includes(weekdayNum));
                        finalSchedule.push({
                            day: d,
                            weekday: this.mapDayToWeekday(d, now),
                            activities: dayLifestyles
                        });
                    }
                }
                finalSchedule.sort((a,b)=>a.day-b.day);

                console.log('[AISVC_V2] FINAL schedule days =', finalSchedule.map(d=>d.day));
                const pretty = JSON.stringify(finalSchedule).slice(0, 4000);
                console.log('최종 스케줄(미리보기 4KB):', pretty, '...');
                
                // 안전망: 최소 분산 배치 (라운드로빈 + 여러 슬롯)
                const hasAnyTask = finalSchedule.some(d => Array.isArray(d.activities) && d.activities.some(a => a.type === 'task'));
                if (!hasAnyTask && Array.isArray(existingTasks) && existingTasks.length) {
                    // 우선순위 점수(대략): 중요 상=3/중=2/하=1, 난이도 상=+1/중=+0/하=-0.5, 긴급(남은일수 적을수록 가산)
                    const importanceMap = { '상': 3, '중': 2, '하': 1 };
                    const difficultyMap = { '상': 1, '중': 0, '하': -0.5 };
                    const slots = [
                        ['09:00','10:30'], ['10:30','12:00'], ['14:00','15:30'], ['15:30','17:00']
                    ];
                    const days = finalSchedule.map(d => d.day);
                    let slotIndex = 0, dayIndex = 0;

                    const scored = existingTasks.map(t => {
                        const imp = importanceMap[t.importance] ?? 1;
                        const diff = difficultyMap[t.difficulty] ?? 0;
                        const dueRel = Number.isFinite(t.relativeDay) ? t.relativeDay : (anchorDay + 6);
                        const daysLeft = Math.max(1, dueRel - anchorDay + 1);
                        const urgency = 1 / daysLeft;
                        return { task: t, score: imp + diff + urgency };
                    }).sort((a,b)=>b.score-a.score);

                    // 라운드로빈으로 여러 날/여러 슬롯에 흩뿌리기
                    for (const { task } of scored) {
                        const day = days[dayIndex % days.length];
                        const [start, end] = slots[slotIndex % slots.length];
                        const idx = finalSchedule.findIndex(d => d.day === day);
                        if (idx >= 0) {
                            finalSchedule[idx].activities.push({ title: task.title || '할 일', start, end, type: 'task' });
                        }
                        slotIndex++; dayIndex++;
                    }
                }

                // 설명 자동 생성 (AI가 빈 설명을 주면)
                const buildFallbackExplanation = (schedule, tasks) => {
                    const taskCount = schedule.reduce((sum, day) => 
                        sum + (day.activities?.filter(a => a.type === 'task').length || 0), 0);
                    const highPriorityTasks = tasks.filter(t => t.importance === '상').length;
                    const days = schedule.length;
                    
                    return `총 ${days}일간의 스케줄을 생성했습니다. ${taskCount}개의 작업을 배치했으며, ${highPriorityTasks}개의 고우선순위 작업을 포함합니다. 생활 패턴을 고려하여 충돌 없는 시간대에 작업을 분산 배치했습니다.`;
                };

                // 추가 안전망: 여전히 tasks가 없다면 하루 1개라도 꽂기
                const stillNoTask = !finalSchedule.some(d => d.activities?.some(a => a.type==='task'));
                if (stillNoTask && existingTasks.length) {
                    const first = finalSchedule[0];
                    if (first) {
                        first.activities = first.activities || [];
                        first.activities.push({ title: existingTasks[0].title, start:'19:00', end:'21:00', type:'task' });
                    }
                }

                return {
                    schedule: finalSchedule,
                    explanation: meta.explanation?.trim() || buildFallbackExplanation(finalSchedule, existingTasks),
                    activityAnalysis: meta.activityAnalysis ?? null,
                    notes: meta.notes ?? [],
                    __debug: {
                        allowedDays,
                        anchorDay,
                        mode: Array.isArray(parsed.schedule) ? 'schedule-mixed' : 'activities-only'
                    }
                };
            } catch (parseError) {
                console.error('AI 응답 JSON 파싱 실패:', parseError);
                console.error('원본 응답:', content);
                throw new Error('AI 응답을 파싱할 수 없습니다.');
            }
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            console.error('=== GPT 호출 실패 상세 정보 ===');
            console.error('에러 타입:', error.constructor.name);
            console.error('에러 메시지:', error.message);
            console.error('HTTP 상태:', status);
            console.error('응답 데이터:', data);
            console.error('에러 스택:', error.stack);
            console.error('===============================');
            throw new Error('시간표 생성 실패: ' + (error.response?.data?.error?.message || error.message));
        }
    }

    // 피드백 분석
    async analyzeFeedback(feedbackText, userData) {
        try {
            const messages = [
                {
                    role: 'system',
                    content: FEEDBACK_PROMPT.system
                },
                {
                    role: 'user',
                    content: FEEDBACK_PROMPT.user(feedbackText, userData)
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
  async generateDailyAdvice(userData, activityAnalysis) {
    try {
      const systemPrompt = {
        role: 'system',
        content: `당신은 사용자의 일일 활동 패턴을 분석하여 개인화된 조언을 제공하는 AI 어시스턴트입니다.

사용자의 활동 데이터를 바탕으로 다음과 같은 조언을 제공해주세요:
1. 활동 비중 분석 (어떤 활동이 많은지, 부족한지)
2. 균형 잡힌 라이프스타일을 위한 구체적인 제안
3. 개선이 필요한 영역과 해결방안
4. 격려와 동기부여 메시지

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

      const userPrompt = {
        role: 'user',
        content: `사용자 활동 분석 데이터:
- 활동 비중 (시간 단위): ${JSON.stringify(activityAnalysis)}
- 생활 패턴: ${userData.lifestylePatterns?.join(', ') || '없음'}
- 최근 스케줄: ${userData.lastSchedule ? '있음' : '없음'}

**분석 요청사항**:
1. 각 활동 카테고리별 시간 비중을 분석해주세요
2. 가장 많은 시간을 소요한 활동과 가장 적은 시간을 소요한 활동을 파악해주세요
3. 균형 잡힌 라이프스타일을 위해 개선이 필요한 영역을 제안해주세요
4. 구체적이고 실행 가능한 조언을 제공해주세요

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
            const weekdayNum = this.relDayToWeekdayNumber(dayRel, now);
            const weekday = this.mapDayToWeekday(dayRel, now);
            
            const activities = [];
            
            // 생활패턴에서 해당 요일에 맞는 활동 추가
            if (lifestylePatterns && Array.isArray(lifestylePatterns)) {
                lifestylePatterns.forEach(pattern => {
                    if (typeof pattern === 'string') {
                        // 문자열 패턴 파싱
                        const parsed = this.parseLifestyleString(pattern);
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
                                    startTime = this.normalizeHHMM(pattern.start);
                                    endTime = this.normalizeHHMM(pattern.end);
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
            notes: ['개발 모드 - 더미 데이터'],
            __debug: {
                mode: 'dummy',
                lifestylePatterns: lifestylePatterns?.length || 0,
                existingTasks: existingTasks?.length || 0
            }
        };
    }
}

module.exports = new AIService();
