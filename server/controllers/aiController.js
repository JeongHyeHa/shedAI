const aiService = require('../services/aiService');

// 유틸리티 함수들
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
            '정오': { offset: 0, range: [12, 12] }
        },
        // 특별한 시간 표현
        special: {
            '00시': 0,
            '12시': 12,
            '오후 12시': 12,
            '자정': 0,
            '정오': 12
        }
    },

    // 날짜 관련 키워드 매핑
    dateKeywords: {
        relative: {
            '금일': 0,
            '오늘': 0,
            '익일': 1,
            '내일': 1,
            '명일': 1,
            '내일모레': 2,
            '모레': 2
        },
        week: {
            '다음주': 7,
            '이번주': 0,
            '저번주': -7
        }
    },

    // 통합된 시간 파싱 함수
    parseTimeExpression(timeStr) {
        if (!timeStr) return null;
        
        // 특별한 시간 표현 먼저 확인
        if (utils.timeKeywords.special[timeStr]) {
            return utils.timeKeywords.special[timeStr];
        }
        
        // 시간대 키워드 + 숫자 패턴 파싱
        const periodMatch = timeStr.match(/(새벽|아침|오전|오후|저녁|밤|자정|정오)\s*(\d+)?시?/);
        if (periodMatch) {
            const period = periodMatch[1];
            const hour = periodMatch[2] ? parseInt(periodMatch[2]) : null;
            
            if (utils.timeKeywords.period[period]) {
                const periodInfo = utils.timeKeywords.period[period];
                if (hour !== null) {
                    // 특정 시간이 주어진 경우
                    let finalHour = hour;
                    if (periodInfo.offset > 0 && hour < 12) {
                        finalHour += periodInfo.offset;
                    }
                    return finalHour;
                } else {
                    // 특정 시간이 없는 경우 (자정, 정오 등)
                    return periodInfo.range[0];
                }
            }
        }
        
        // 단순 숫자 시 패턴
        const hourMatch = timeStr.match(/(\d+)시/);
        if (hourMatch) {
            return parseInt(hourMatch[1]);
        }
        
        return null;
    },

    // 통합된 시간 범위 파싱
    parseTimeRange(pattern) {
        // 시간 범위 패턴 매칭 (더 포괄적인 정규식)
        const timeRangeRegex = /((?:새벽|아침|오전|오후|저녁|밤|자정|정오)\s*(?:\d+)?시?|\d+시)\s*[~-]\s*((?:새벽|아침|오전|오후|저녁|밤|자정|정오)\s*(?:\d+)?시?|\d+시)/;
        const match = pattern.match(timeRangeRegex);
        
        if (!match) return null;
        
        const startTime = utils.parseTimeExpression(match[1]);
        const endTime = utils.parseTimeExpression(match[2]);
        
        if (startTime === null || endTime === null) return null;
        
        return { startTime, endTime };
    },

    // 생활패턴 파싱 (리팩토링된 버전)
    parseLifestylePattern(pattern) {
        if (!pattern || typeof pattern !== 'string') return null;
        
        console.log(`[ParsePattern] 입력: "${pattern}"`);
        
        // 시간 범위 파싱
        const timeRange = utils.parseTimeRange(pattern);
        if (!timeRange) {
            console.log(`[ParsePattern] 시간 파싱 실패: "${pattern}"`);
            return null;
        }
        
        let startHour = timeRange.startTime;
        let endHour = timeRange.endTime;
        
        console.log(`[ParsePattern] 파싱된 시간: ${startHour}시~${endHour}시`);
        
        // 자정을 넘나드는 시간 처리
        const isOvernight = startHour > endHour;
        if (isOvernight) {
            console.log(`[ParsePattern] 자정을 넘나드는 시간: ${startHour}시~${endHour}시`);
        }
        
        // 요일 정보 추출
        const isWeekday = pattern.includes('평일');
        const isWeekend = pattern.includes('주말');
        const isDaily = pattern.includes('매일');
        
        // 제목 추출
        let title = pattern;
        // 시간 패턴 제거
        title = title.replace(/((?:새벽|아침|오전|오후|저녁|밤|자정|정오)\s*(?:\d+)?시?|\d+시)\s*[~-]\s*((?:새벽|아침|오전|오후|저녁|밤|자정|정오)\s*(?:\d+)?시?|\d+시)/g, '');
        // 시간 관련 단어 제거
        title = title.replace(/새벽|아침|오전|오후|저녁|밤|자정|정오/g, '');
        // 요일 제거
        title = title.replace(/평일|주말|매일/g, '');
        // 공백 정리
        title = title.trim();
        
        // 제목이 비어있으면 기본값
        if (!title) title = '활동';
        
        console.log(`[ParsePattern] 최종 결과: ${startHour}시~${endHour}시, 제목: "${title}"`);
        
        return {
            startHour,
            endHour,
            isWeekday,
            isWeekend,
            isDaily,
            title,
            isOvernight,
            days: isDaily ? [1,2,3,4,5,6,7] : isWeekday ? [1,2,3,4,5] : isWeekend ? [6,7] : [1,2,3,4,5,6,7]
        };
    },

    // 날짜 파싱 함수
    parseDateExpression(dateStr) {
        if (!dateStr) return null;
        
        // 상대적 날짜 표현
        if (utils.dateKeywords.relative[dateStr]) {
            return utils.dateKeywords.relative[dateStr];
        }
        
        // 주 단위 표현
        if (utils.dateKeywords.week[dateStr]) {
            return utils.dateKeywords.week[dateStr];
        }
        
        // 구체적인 날짜 패턴 (MM월DD일, MM/DD, MM-DD)
        const dateMatch = dateStr.match(/(\d{1,2})월\s*(\d{1,2})일|(\d{1,2})\/(\d{1,2})|(\d{1,2})-(\d{1,2})/);
        if (dateMatch) {
            const month = parseInt(dateMatch[1] || dateMatch[3] || dateMatch[5]);
            const day = parseInt(dateMatch[2] || dateMatch[4] || dateMatch[6]);
            
            const currentDate = new Date();
            const currentYear = currentDate.getFullYear();
            const targetDate = new Date(currentYear, month - 1, day);
            const today = new Date();
            const diffTime = targetDate - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            return diffDays >= 0 ? diffDays : null;
        }
        
        return null;
    },

    // 사용자 할 일 추출 및 자연어 분석
    extractUserTasks(prompt) {
        if (!prompt || typeof prompt !== 'string') return [];
        
        // 시스템 프롬프트 필터링
        if (prompt.includes('당신은 사용자의 생활 패턴과 할 일') || 
            prompt.includes('고급 일정 관리 전문가')) {
            return [];
        }
        
        const tasks = [];
        const userTask = prompt.replace(/당신은.*?\[할 일 목록\]\s*/s, '').trim();
        if (!userTask) return [];
        
        // 통합된 자연어 패턴 매칭으로 할 일 추출
        const taskPatterns = [
            // 상대적 날짜 + 할일 패턴
            /(금일|오늘|익일|내일|명일|내일모레|모레|다음주|이번주|저번주)\s+(.+?)(?:\s+일정\s+추가|$)/g,
            // 요일 + 할일 패턴
            /(다음주|이번주|저번주)\s+(\w+요일)\s+(.+?)(?:\s+일정\s+추가|$)/g,
            // 구체적 날짜 + 할일 패턴
            /(\d{1,2}월\s*\d{1,2}일|\d{1,2}\/\d{1,2}|\d{1,2}-\d{1,2})\s+(.+?)(?:\s+일정\s+추가|$)/g
        ];
        
        taskPatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(userTask)) !== null) {
                let taskTitle, dayOffset = 1;
                
                if (match.length === 3) {
                    // 요일 + 할일 패턴
                    const dateKeyword = match[1];
                    const dayName = match[2];
                    taskTitle = match[3];
                    
                    // 요일 매핑
                    const dayMap = {
                        '월요일': 1, '화요일': 2, '수요일': 3, '목요일': 4, 
                        '금요일': 5, '토요일': 6, '일요일': 7
                    };
                    const targetDay = dayMap[dayName] || 1;
                    
                    // 주 단위 오프셋 계산
                    const weekOffset = utils.parseDateExpression(dateKeyword) || 0;
                    dayOffset = weekOffset + targetDay;
                } else if (match.length === 2) {
                    // 날짜 + 할일 패턴
                    const dateStr = match[1];
                    taskTitle = match[2];
                    
                    // 날짜 파싱
                    const parsedDate = utils.parseDateExpression(dateStr);
                    if (parsedDate !== null) {
                        dayOffset = parsedDate + 1; // 1일부터 시작
                    }
                }
                
                // 시간 정보 추출
                const timeMatch = taskTitle ? taskTitle.match(/(\d{1,2}):?(\d{0,2})\s*[-~]\s*(\d{1,2}):?(\d{0,2})/) : null;
                let startTime = '09:00';
                let endTime = '18:00';
                
                if (timeMatch) {
                    startTime = `${timeMatch[1].padStart(2, '0')}:${(timeMatch[2] || '00').padStart(2, '0')}`;
                    endTime = `${timeMatch[3].padStart(2, '0')}:${(timeMatch[4] || '00').padStart(2, '0')}`;
                }
                
                // 제목에서 시간 정보 제거
                const cleanTitle = taskTitle ? taskTitle.replace(/\d{1,2}:?\d{0,2}\s*[-~]\s*\d{1,2}:?\d{0,2}/, '').trim() : '할 일';
                
                tasks.push({
                    day: dayOffset,
                    start: startTime,
                    end: endTime,
                    title: cleanTitle,
                    type: 'task'
                });
            }
        });
        
        // 패턴 매칭이 실패한 경우 기본 처리 (기존 할 일과 병합)
        if (tasks.length === 0) {
            const taskTitle = userTask.length > 20 ? userTask.substring(0, 20) + "..." : userTask;
            const targetDay = userTask.includes('다다음주') ? 15 : 1;
            
            tasks.push({
                title: taskTitle,
                day: targetDay,
                start: "09:00",
                end: "12:00",
                type: "task"
            });
        }
        
        return tasks;
    },

    // AI 메시지 빌드
    buildMessages(prompt, conversationContext) {
        // 현재 날짜 정보 생성
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const date = now.getDate();
        const dayOfWeek = now.getDay(); // 0=일요일, 1=월요일, ..., 6=토요일
        const koreanDays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
        const currentDayName = koreanDays[dayOfWeek];
        
        const messages = [
            {
                role: "system",
                content: `당신은 사용자의 생활 패턴과 할 일을 바탕으로 최적화된 스케줄을 생성하는 고급 일정 관리 전문가입니다.

**중요한 날짜 정보:**
- 현재 날짜: ${year}년 ${month}월 ${date}일 (${currentDayName})
- 오늘은 ${currentDayName}입니다.
- 스케줄은 오늘(${currentDayName})부터 시작하여 생성해주세요.

사용자의 요청에 따라 효율적이고 실현 가능한 일정을 만들어주세요. 평일/주말 구분을 정확히 하고, 현재 날짜를 기준으로 스케줄을 생성해주세요.`
            }
        ];

        // 대화 컨텍스트 추가
        if (conversationContext && Array.isArray(conversationContext)) {
            conversationContext.forEach(msg => {
                if (msg.role && msg.content) {
                    messages.push({
                        role: msg.role,
                        content: msg.content
                    });
                }
            });
        }

        // 현재 요청 추가
        messages.push({
            role: "user",
            content: prompt
        });

        return messages;
    },

    // 로컬 스케줄 생성
    generateLocalSchedule(prompt, lifestylePatterns) {
        console.log('[LocalSchedule] 시작 - lifestylePatterns:', lifestylePatterns);
        const schedule = [];
        const maxDays = 7; // 최대 7일간의 스케줄 생성
        
        // 사용자 할 일 추출
        const userTasks = this.extractUserTasks(prompt);
        console.log('[LocalSchedule] 사용자 할 일:', userTasks);
        
        for (let day = 1; day <= maxDays; day++) {
            const weekday = this.getKoreanDayName(day);
            const activities = [];
            
            // 생활패턴 기반 활동 추가
            if (lifestylePatterns && Array.isArray(lifestylePatterns)) {
                lifestylePatterns.forEach((pattern, index) => {
                    console.log(`[LocalSchedule] 패턴 ${index}: "${pattern}"`);
                    const parsed = this.parseLifestylePattern(pattern);
                    console.log(`[LocalSchedule] 파싱 결과:`, parsed);
                    
                    if (parsed && (parsed.days.includes(day) || parsed.days.includes(0))) {
                        const activity = {
                            title: parsed.title,
                            start: `${parsed.startHour.toString().padStart(2, '0')}:00`,
                            end: `${parsed.endHour.toString().padStart(2, '0')}:00`,
                            type: "lifestyle"
                        };
                        console.log(`[LocalSchedule] day ${day}에 추가:`, activity);
                        activities.push(activity);
                    }
                });
            }
            
            // 사용자 할 일 추가
            userTasks.forEach(task => {
                if (task.day === day) {
                    activities.push(task);
                }
            });
            
            if (activities.length > 0) {
                schedule.push({
                    day: day,
                    weekday: weekday,
                    activities: activities
                });
            }
        }
        
        console.log('[LocalSchedule] 최종 스케줄:', schedule);
        return schedule;
    },

    // AI 응답을 클라이언트 형식으로 변환
    convertAIResponseToClientFormat(aiSchedule) {
        if (!Array.isArray(aiSchedule)) {
            return [];
        }

        return aiSchedule.map(item => {
            if (item.day && item.weekday && item.activities) {
                return item; // 이미 올바른 형식
            }
            
            // 다른 형식의 경우 기본 형식으로 변환
            return {
                day: item.day || 1,
                weekday: item.weekday || utils.getKoreanDayName(item.day || 1),
                activities: item.activities || []
            };
        });
    },

    // 피드백 텍스트 분석
    analyzeFeedbackText(feedbackText) {
        if (!feedbackText || typeof feedbackText !== 'string') {
            return "피드백을 분석할 수 없습니다.";
        }

        const text = feedbackText.toLowerCase();
        
        if (text.includes('좋') || text.includes('만족') || text.includes('괜찮')) {
            return "긍정적인 피드백을 주셨습니다. 현재 스케줄이 잘 작동하고 있는 것 같습니다.";
        } else if (text.includes('어려') || text.includes('힘들') || text.includes('부담')) {
            return "스케줄이 부담스러우신 것 같습니다. 더 여유로운 일정으로 조정해드리겠습니다.";
        } else if (text.includes('시간') || text.includes('일정')) {
            return "시간 관련 피드백을 주셨습니다. 스케줄 시간을 조정해보겠습니다.";
        } else if (text.includes('추가') || text.includes('더')) {
            return "추가적인 활동을 원하시는군요. 스케줄에 새로운 항목을 추가해보겠습니다.";
        } else {
            return "피드백을 검토하여 스케줄을 개선하겠습니다.";
        }
    },

    // 메시지 구성
    buildMessages(prompt, conversationContext) {
        const messages = [];
    
        if (Array.isArray(conversationContext)) {
            conversationContext.forEach(ctx => {
                if (!ctx) return;
                if (ctx.type === 'user') {
                    messages.push({ role: 'user', content: String(ctx.text || '') });
                } else if (ctx.type === 'ai') {
                    messages.push({ role: 'assistant', content: String(ctx.text || '') });
                }
            });
        }
        
        // 현재 프롬프트 추가
        messages.push({ role: 'user', content: prompt });
        
        return messages;
    },

    // 간단한 피드백 분석 (중복 제거)
    analyzeFeedbackText(feedbackText) {
        const text = feedbackText.toLowerCase();
        
        if (text.includes('빡빡') || text.includes('많아') || text.includes('과부하')) {
            return "스케줄이 너무 빡빡하다는 피드백을 받았습니다. 일정을 조정하겠습니다.";
        } else if (text.includes('여유') || text.includes('적어') || text.includes('비어')) {
            return "스케줄에 여유가 있다는 피드백을 받았습니다. 더 많은 활동을 추가하겠습니다.";
        } else if (text.includes('시간') || text.includes('조정')) {
            return "시간 조정에 대한 피드백을 받았습니다. 시간대를 재배치하겠습니다.";
        } else {
            return "피드백을 검토하여 스케줄을 개선하겠습니다.";
        }
    }
};

class AIController {
    // 스케줄 생성
    async generateSchedule(req, res) {
        try {
            const { prompt, conversationContext = [], sessionId, lifestylePatterns = [] } = req.body || {};
            
            if (!prompt || typeof prompt !== 'string') {
                return res.status(400).json({ error: 'prompt가 필요합니다.' });
            }

            // AI만 사용하여 스케줄 생성
            const messages = utils.buildMessages(prompt, conversationContext);
            
            // 생활 패턴 정보를 AI에게 전달
            if (lifestylePatterns && lifestylePatterns.length > 0) {
                const lifestyleInfo = lifestylePatterns.map(pattern => {
                    const parsed = utils.parseLifestylePattern(pattern);
                    return parsed ? {
                        pattern: pattern,
                        startHour: parsed.startHour,
                        endHour: parsed.endHour,
                        title: parsed.title,
                        isDaily: parsed.isDaily,
                        isWeekday: parsed.isWeekday,
                        isWeekend: parsed.isWeekend,
                        days: parsed.days
                    } : null;
                }).filter(Boolean);
                
                messages.push({
                    role: 'user',
                    content: `현재 설정된 생활 패턴:\n${JSON.stringify(lifestyleInfo, null, 2)}\n\n이 패턴들을 기반으로 스케줄을 생성해주세요.`
                });
            }
            
            const aiResponse = await aiService.generateSchedule(messages);
            
            if (aiResponse && aiResponse.schedule) {
                return res.json({
                    schedule: aiResponse.schedule,
                    notes: aiResponse.notes || "AI가 생성한 스케줄입니다."
                });
            } else {
                throw new Error('AI 응답이 올바르지 않습니다.');
            }

        } catch (error) {
            console.error('AI 스케줄 생성 실패:', error);
            
            // AI가 정말 실패한 경우에만 로컬 폴백 사용
            console.log('[Schedule] AI 완전 실패, 로컬 폴백 사용');
            try {
                const localSchedule = utils.generateLocalSchedule(prompt, lifestylePatterns);
                return res.json({
                    schedule: localSchedule,
                    notes: "AI 실패로 인한 로컬 생성 스케줄입니다."
                });
            } catch (localError) {
                console.error('로컬 폴백도 실패:', localError);
                res.status(500).json({ error: '스케줄 생성에 실패했습니다.' });
            }
        }
    }

    // 메시지 구성
    buildMessages(prompt, conversationContext) {
            const messages = [];
        
            if (Array.isArray(conversationContext)) {
            conversationContext.forEach(ctx => {
                if (!ctx) return;
                if (ctx.type === 'user') {
                    messages.push({ role: 'user', content: String(ctx.text || '') });
                } else if (ctx.type === 'ai') {
                    messages.push({ role: 'assistant', content: String(ctx.text || '') });
                }
            });
            }
        
            messages.push({ role: 'user', content: prompt });
        return messages;
    }

    // 로컬 스케줄 생성
    generateLocalSchedule(prompt, lifestylePatterns) {
        console.log('[LocalSchedule] 시작 - lifestylePatterns:', lifestylePatterns);
        const schedule = [];
        
        // 현재 날짜 정보
        const now = new Date();
        const currentDayOfWeek = now.getDay(); // 0=일요일, 1=월요일, ..., 6=토요일
        const koreanDays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
        const currentDayName = koreanDays[currentDayOfWeek];
        
        console.log(`[LocalSchedule] 현재 날짜: ${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${currentDayName})`);
        
        // 사용자 요청에서 기간 파싱
        let maxDays = 14; // 기본 2주
        if (prompt && typeof prompt === 'string') {
            if (prompt.includes('한 달') || prompt.includes('1달') || prompt.includes('30일')) {
                maxDays = 30;
            } else if (prompt.includes('두 달') || prompt.includes('2달') || prompt.includes('60일')) {
                maxDays = 60;
            } else if (prompt.includes('세 달') || prompt.includes('3달') || prompt.includes('90일')) {
                maxDays = 90;
            } else if (prompt.includes('일주일') || prompt.includes('1주') || prompt.includes('7일')) {
                maxDays = 7;
            }
        }
        
        console.log(`[LocalSchedule] 생성 기간: ${maxDays}일`);
        
        // 현재 날짜부터 시작하여 스케줄 생성
        for (let day = 1; day <= maxDays; day++) {
            const actualDayOfWeek = (currentDayOfWeek + day - 1) % 7; // 현재 요일부터 시작
            const weekday = koreanDays[actualDayOfWeek];
            
            schedule.push({
                day: day,
                weekday: weekday,
                activities: []
            });
        }
            
            // 생활패턴 처리
            if (Array.isArray(lifestylePatterns) && lifestylePatterns.length > 0) {
            lifestylePatterns.forEach((pattern, index) => {
                console.log(`[LocalSchedule] 패턴 ${index}: "${pattern}"`);
                const parsed = utils.parseLifestylePattern(pattern);
                console.log(`[LocalSchedule] 파싱 결과:`, parsed);
                
                if (parsed) {
                    // 현재 날짜부터 시작하여 해당 요일에 패턴 적용
                    for (let weekDay = 1; weekDay <= maxDays; weekDay++) {
                        const actualDayOfWeek = (currentDayOfWeek + weekDay - 1) % 7; // 현재 요일부터 시작
                        const targetDay = actualDayOfWeek === 0 ? 7 : actualDayOfWeek; // 일요일을 7로 변환
                        
                        // 평일/주말/매일 패턴 확인
                        let shouldApply = false;
                        if (parsed.isDaily) { // 매일
                            shouldApply = true;
                        } else if (parsed.days.includes(0)) { // 매일 (기존 방식)
                            shouldApply = true;
                        } else if (parsed.isWeekday && targetDay >= 1 && targetDay <= 5) { // 평일
                            shouldApply = true;
                        } else if (parsed.isWeekend && (targetDay === 6 || targetDay === 7)) { // 주말
                            shouldApply = true;
                        } else if (parsed.days.includes(targetDay)) { // 특정 요일
                            shouldApply = true;
                        }
                        
                        if (shouldApply) {
                            const dayIndex = weekDay - 1; // 배열 인덱스는 0부터 시작
                            if (dayIndex >= 0 && dayIndex < schedule.length) {
                                if (parsed.isOvernight) {
                                    // 자정을 넘나드는 경우: 당일 밤 + 다음날 새벽으로 나누어 처리
                                    // 당일 밤 부분 (23시~24시)
                                    schedule[dayIndex].activities.push({
                                        start: `${parsed.startHour.toString().padStart(2, '0')}:00`,
                                        end: '24:00',
                                        title: parsed.title,
                                        type: 'lifestyle'
                                    });
                                    
                                    // 다음날 새벽 부분 (00시~07시)
                                    const nextDayIndex = dayIndex + 1;
                                    if (nextDayIndex < schedule.length) {
                                        schedule[nextDayIndex].activities.push({
                                            start: '00:00',
                                            end: `${parsed.endHour.toString().padStart(2, '0')}:00`,
                                            title: parsed.title,
                                            type: 'lifestyle'
                                        });
                                    }
                                    
                                    console.log(`[LocalSchedule] 자정을 넘나드는 활동 day ${weekDay}에 추가:`, {
                                        start: `${parsed.startHour.toString().padStart(2, '0')}:00`,
                                        end: '24:00',
                                        title: parsed.title,
                                        type: 'lifestyle'
                                    });
                                } else {
                                    // 일반적인 경우
                                schedule[dayIndex].activities.push({
                                    start: `${parsed.startHour.toString().padStart(2, '0')}:00`,
                                    end: `${parsed.endHour.toString().padStart(2, '0')}:00`,
                                    title: parsed.title,
                                    type: 'lifestyle'
                                });
                                console.log(`[LocalSchedule] day ${weekDay} (${schedule[dayIndex].weekday})에 추가:`, {
                                    start: `${parsed.startHour.toString().padStart(2, '0')}:00`,
                                    end: `${parsed.endHour.toString().padStart(2, '0')}:00`,
                                    title: parsed.title,
                                    type: 'lifestyle'
                                });
                                }
                            }
                        }
                        }
                    }
                });
            }
            
        // 사용자 할 일 추가 (기존 할 일과 병합)
        const userTasks = utils.extractUserTasks(prompt);
        userTasks.forEach(task => {
            const dayIndex = task.day - 1;
            if (dayIndex >= 0 && dayIndex < schedule.length) {
                // 기존 할 일과 중복되지 않는지 확인
                const existingTask = schedule[dayIndex].activities.find(activity => 
                    activity.title === task.title && 
                    activity.start === task.start && 
                    activity.end === task.end
                );
                
                if (!existingTask) {
                    schedule[dayIndex].activities.push({
                        start: task.start,
                        end: task.end,
                        title: task.title,
                        type: task.type
                    });
                }
            }
        });
        
        // 할 일을 Firestore에 저장 (사용자 ID가 있는 경우)
        if (userTasks.length > 0 && req.body.sessionId) {
            try {
                const { saveTaskToFirestore } = require('../services/firestoreService');
                // 비동기 저장 (await 없이)
                saveTaskToFirestore(req.body.sessionId, userTasks[0]).then(() => {
                    console.log(`[Schedule] ${userTasks.length}개 할 일을 Firestore에 저장했습니다.`);
                }).catch(error => {
                    console.error('[Schedule] 할 일 Firestore 저장 실패:', error);
                });
            } catch (error) {
                console.error('[Schedule] 할 일 Firestore 저장 실패:', error);
            }
        }
        
        // 빈 요일 제거 (활동이 없는 요일은 제외)
        const filteredSchedule = schedule.filter(day => day.activities.length > 0);
        
        console.log('[LocalSchedule] 최종 스케줄:', filteredSchedule);
        return filteredSchedule;
    }

    // AI 응답을 클라이언트 형식으로 변환
    convertAIResponseToClientFormat(aiSchedule) {
        if (!Array.isArray(aiSchedule)) return [];
        
        const dayMap = new Map();
        
        aiSchedule.forEach(event => {
            if (!event.start || !event.end) return;
            
            // 날짜에서 요일 계산
            const startDate = new Date(event.start);
            const day = startDate.getDay() === 0 ? 7 : startDate.getDay(); // 일요일을 7로 변환
            
            if (!dayMap.has(day)) {
                dayMap.set(day, {
                    day: day,
                    weekday: utils.getKoreanDayName(day),
                    activities: []
                });
            }
            
            // 시간 추출 (HH:mm 형식)
            const startTime = event.start.split('T')[1]?.substring(0, 5) || '09:00';
            const endTime = event.end.split('T')[1]?.substring(0, 5) || '12:00';
            
            dayMap.get(day).activities.push({
                start: startTime,
                end: endTime,
                title: event.title || '활동',
                type: event.category === 'work' ? 'task' : 'lifestyle'
            });
        });
        
        return Array.from(dayMap.values()).sort((a, b) => a.day - b.day);
    }

    // 음성 인식
    async transcribeAudio(req, res) {
        try {
            const result = await aiService.transcribeAudio(req.file);
            res.json(result);
        } catch (error) {
            console.error('음성 인식 실패:', error);
            res.status(500).json({ error: '음성 인식에 실패했습니다.' });
        }
    }

    // 대화형 피드백 분석
    async analyzeConversationalFeedback(req, res) {
        try {
            const { conversationalFeedbacks } = req.body;
            
            if (!conversationalFeedbacks || !Array.isArray(conversationalFeedbacks)) {
                return res.status(400).json({ error: '대화형 피드백 데이터가 필요합니다.' });
            }

            const result = await aiService.analyzeConversationalFeedback(conversationalFeedbacks);
            res.json(result);
        } catch (error) {
            console.error('대화형 피드백 분석 실패:', error);
            res.status(500).json({ error: '피드백 분석에 실패했습니다.' });
        }
    }

    // 피드백 저장 및 분석
    async saveFeedback(req, res) {
        try {
            const { sessionId, scheduleId, feedbackText } = req.body;
            
            if (!feedbackText) {
                return res.status(400).json({ 
                    success: false, 
                    message: '피드백 내용이 필요합니다.' 
                });
            }

            // 간단한 피드백 분석
            const analysis = utils.analyzeFeedbackText(feedbackText);
            
            res.json({ 
                success: true, 
                analysis: analysis,
                advice: [
                    {
                        title: "스케줄 조정",
                        content: "피드백을 바탕으로 스케줄을 조정하겠습니다."
                    }
                ]
            });
        } catch (error) {
            console.error('피드백 저장 실패:', error);
            res.status(500).json({ 
                success: false, 
                message: '피드백 저장에 실패했습니다.' 
            });
        }
    }


    // AI 조언 생성
    async generateAdvice(req, res) {
        try {
            const { userData, activityAnalysis } = req.body;
            
            if (!userData) {
                return res.status(400).json({ 
                    ok: false, 
                    message: '사용자 데이터가 필요합니다.' 
                });
            }

            const advice = await aiService.generateDailyAdvice(userData, activityAnalysis);
            
            res.json({ 
                ok: true, 
                advice 
            });
        } catch (error) {
            console.error('AI 조언 생성 컨트롤러 에러:', error);
            res.status(500).json({ 
                ok: false, 
                message: 'AI 조언 생성에 실패했습니다.' 
            });
        }
    }

    // OpenAI 연결 진단
    async debugOpenAI(req, res) {
        try {
            const { status, data, message } = await aiService.debugOpenAIConnection();
            res.json({ ok: true, status, data, message });
        } catch (error) {
            const status = error.response?.status || 500;
            const data = error.response?.data;
            return res.status(500).json({ ok: false, status, data, message: error.message });
        }
    }
}

module.exports = new AIController();
module.exports.utils = utils;