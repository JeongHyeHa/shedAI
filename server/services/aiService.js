const axios = require('axios');

class AIService {
    constructor() {
        this.openaiApiKey = process.env.OPENAI_API_KEY;
    }

    // 허용 day 집합 추출 (사용자 메시지만 대상)
    extractAllowedDays(messages) {
        const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
        const days = [...lastUser.matchAll(/\(day:(\d+)\)/g)].map(m => parseInt(m[1], 10));
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
            
            // 시간 범위 파싱
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
            // API 키 검증 - 개발 모드에서는 더미 데이터 반환
            if (!this.openaiApiKey) {
                console.log('[개발 모드] OpenAI API 키가 없어서 더미 스케줄을 생성합니다.');
                return this.generateDummySchedule(lifestylePatterns, existingTasks, opts);
            }
            
            console.log('[AISVC_V2] activities-only mode ENABLED');
            console.log('=== AI 서비스 generateSchedule 시작 ===');
            console.log('메시지:', JSON.stringify(messages, null, 2));
            console.log('라이프스타일 패턴:', JSON.stringify(lifestylePatterns, null, 2));
            console.log('기존 할 일:', JSON.stringify(existingTasks, null, 2));
            console.log('옵션:', JSON.stringify(opts, null, 2));
            
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
            
            // 작업용 day와 생활패턴용 day 분리
            let taskDays = [];
            let lifestyleDays = [];
            
            if (forcedToday) {
                // "오늘까지" 작업: 작업은 오늘만, 생활패턴은 7일치
                taskDays = [baseRelDay];                  // 오늘만
                lifestyleDays = Array.from({ length: 7 }, (_, i) => baseRelDay + i);  // 7일 연속
            } else if (forcedTomorrow) {
                // "내일까지" 작업: 작업은 내일만, 생활패턴은 7일치
                taskDays = [baseRelDay + 1];              // 내일만
                lifestyleDays = Array.from({ length: 7 }, (_, i) => baseRelDay + i);
            } else if (hasSpecificDate) {
                // 특정 날짜 작업: 해당 날짜에만 작업, 생활패턴은 7일치
                const extractedDays = this.extractAllowedDays(messages);
                taskDays = extractedDays;
                lifestyleDays = Array.from({ length: 7 }, (_, i) => baseRelDay + i);
            } else {
                // 일반 작업: 오늘에만 작업, 생활패턴은 7일치
                taskDays = [baseRelDay];                   // 기본은 오늘
                lifestyleDays = Array.from({ length: 7 }, (_, i) => baseRelDay + i);
            }
            
            const allowedDays = [...new Set([...taskDays, ...lifestyleDays])].sort((a,b)=>a-b);
            const anchorDay = opts.anchorDay ?? (allowedDays.length ? allowedDays[0] : (dayOfWeek===0?7:dayOfWeek));
            
            console.log('현재 날짜 정보:', { year, month, date, dayOfWeek, currentDayName });
            console.log('[AISVC_V2] rawUser=', rawUser);
            console.log('[AISVC_V2] forcedToday=', forcedToday, 'forcedTomorrow=', forcedTomorrow, 'hasSpecificDate=', hasSpecificDate);
            console.log('[AISVC_V2] forcedTomorrow test:', /(내일|익일|명일)(까지)?/.test(rawUser));
            console.log('[AISVC_V2] taskDays=', taskDays, 'lifestyleDays=', lifestyleDays.slice(0, 10), '...');
            console.log('[AISVC_V2] allowedDays=', allowedDays, 'anchorDay=', anchorDay);
            
            // 스케줄 생성에 특화된 시스템 프롬프트 추가
            const systemPrompt = {
                role: 'system',
                content: `당신은 사용자의 생활패턴과 할 일을 바탕으로 시간표를 설계하는 전문가입니다.

**현재 날짜: ${year}년 ${month}월 ${date}일 (${currentDayName})**

[CONSTRAINTS]
BASE_DAY: ${anchorDay}
ALLOWED_DAYS: ${allowedDays.join(',') || '없음'}
RETURN_FORMAT: activities만 생성하세요. day 숫자는 만들지 마세요.
[/CONSTRAINTS]

**핵심 규칙:**
1. 생활 패턴은 고정 시간대로 먼저 배치하고, 남는 시간에만 할 일을 배치하세요
2. 평일(day:1~5)과 주말(day:6~7)을 정확히 구분하세요
3. 시간이 겹치지 않도록 주의하세요
4. 반복/확장 일정은 금지. 입력에 없는 날짜로 일정 만들지 마세요
5. 활동 타입 구분:
   - "lifestyle": 수면, 식사, 출근, 독서 등 반복되는 생활 패턴
   - "task": 특정 작업, 회의, 발표, 제출 등 일회성 할 일
6. **절대 금지**: 
   - 임의로 "출근 준비", "근무", "수면", "식사", "휴식", "준비", "마무리" 등을 추가하지 마세요
   - 사용자가 제공한 생활패턴과 할 일만 정확히 생성하세요
   - 중복된 활동을 생성하지 마세요
   - 생활패턴에 없는 활동은 절대 만들지 마세요
7. **주말/평일 구분**: 
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

[할 일 목록]
${existingTasks.length > 0 ? existingTasks.map(task => `- ${task.title} (마감일: ${task.deadline}, 중요도: ${task.importance}, 난이도: ${task.difficulty})`).join('\n') : '- 기존 할 일 없음'}

**🚨🚨🚨 절대적인 규칙:**
- 반드시 "activities" 배열만 반환하세요
- "schedule" 배열은 절대 만들지 마세요
- "day" 필드는 절대 포함하지 마세요
- "weekday" 필드는 절대 포함하지 마세요

**출력 형식 (activities만):**
{
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
  ],
  "explanation": "스케줄 설계 이유를 구체적으로 설명하세요. 왜 이 시간대에 배치했는지, 어떤 우선순위를 고려했는지, 생활패턴과 어떻게 조화를 이루었는지 등을 포함하세요."
}

**중요**: 
- 위 형식과 정확히 일치해야 합니다. 다른 형식은 절대 사용하지 마세요.
- "explanation" 필드는 반드시 포함하고, 구체적이고 유용한 설명을 제공하세요.
- 빈 문자열이나 "스케줄 설계 이유" 같은 플레이스홀더는 사용하지 마세요.
JSON만 반환하세요.`
            };

            // 시스템 프롬프트를 맨 앞에 추가
            const enhancedMessages = [systemPrompt, ...messages];
            
            console.log('API 키 존재:', !!this.openaiApiKey);
            console.log('API 키 길이:', this.openaiApiKey ? this.openaiApiKey.length : 0);
            console.log('요청 메시지 수:', enhancedMessages.length);

            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4o-mini', // 더 빠른 모델로 변경
                    messages: enhancedMessages,
                    temperature: 0.7,
                    max_tokens: 2000, // 토큰 수 줄임
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
                    // 신(新) schedule 모드 → day는 무시하고 activities만 수집
                    for (const dayObj of parsed.schedule) {
                        if (dayObj && Array.isArray(dayObj.activities)) {
                            activitiesOnly.push(...dayObj.activities);
                        }
                    }
                    meta.explanation = parsed.explanation ?? '';
                    meta.activityAnalysis = parsed.activityAnalysis ?? null;
                    meta.notes = Array.isArray(parsed.notes) ? parsed.notes : [];
                } else {
                    throw new Error('AI 응답에 activities 또는 schedule이 없습니다.');
                }

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
                    // 생활패턴에 등록된 타이틀은 허용 (정규화된 키 스킴 사용)
                    const lifestyleAllowSet = new Set(
                        (lifestylePatterns || []).map(p => {
                            if (typeof p === 'string') return p.trim();       // 문자열 패턴은 전체 문자열로
                            const t = (p.title || '').trim();
                            const s = this.normalizeHHMM(p.start);
                            const e = this.normalizeHHMM(p.end);
                            return `${t}|${s}|${e}`;                          // 동일한 키 스킴
                        })
                    );
                    
                    // 1) 정확 키 일치 우선
                    const activityKey = `${(activity.title || '').trim()}|${this.normalizeHHMM(activity.start)}|${this.normalizeHHMM(activity.end)}`;
                    const allowByKey = lifestyleAllowSet.has(activityKey);
                    // 2) 타이틀만 허용(레거시 호환)
                    const allowByTitleOnly = [...lifestyleAllowSet].some(x => !x.includes('|') && x.includes((activity.title || '').trim()));
                    
                    if (forbiddenActivities.some(f => activity.title.includes(f)) && !(allowByKey || allowByTitleOnly)) {
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
                console.log('[AISVC_V2] FINAL schedule days =', finalSchedule.map(d=>d.day));
                console.log('최종 스케줄:', JSON.stringify(finalSchedule, null, 2));
                
                return {
                    schedule: finalSchedule,
                    explanation: meta.explanation || "스케줄 설계 이유",
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

    // 개발용 더미 스케줄 생성
    generateDummySchedule(lifestylePatterns, existingTasks, opts) {
        console.log('[더미 스케줄] 생성 시작');
        
        const now = opts.nowOverride ? new Date(opts.nowOverride) : new Date();
        const baseRelDay = now.getDay() === 0 ? 7 : now.getDay();
        
        // 생활패턴을 기반으로 더미 스케줄 생성
        const schedule = [];
        
        // 7일간의 스케줄 생성
        for (let i = 1; i <= 7; i++) {
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
            
            // 기존 할 일 추가 (첫째 날에만)
            if (i === 1 && existingTasks && Array.isArray(existingTasks)) {
                existingTasks.forEach(task => {
                    activities.push({
                        title: task.title || '할 일',
                        start: '09:00',
                        end: '10:00',
                        type: 'task'
                    });
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
