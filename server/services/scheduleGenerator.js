// 스케줄 생성 로직 (AI 호출 및 프롬프트 생성)

const axios = require('axios');
const { extractAllowedDays, normalizeHHMM, timeToMinutes, minutesToTime, mapDayToWeekday } = require('../utils/scheduleUtils');
const { convertLifestyleToBusy } = require('../utils/lifestyleUtils');
const { calculateFreeWindows } = require('../utils/freeWindowsUtils');
const { mergeAIPlacements } = require('./scheduleValidator');

class ScheduleGenerator {
    constructor(openaiApiKey, axiosOpts, callWithRetry) {
        this.openaiApiKey = openaiApiKey;
        this.axiosOpts = axiosOpts;
        this.callWithRetry = callWithRetry;
    }

    /**
     * 주말 정책 확인 (사용자 피드백 또는 기본 설정)
     */
    detectWeekendPolicy(userMessages) {
        let weekendPolicy = 'allow'; // 기본: 주말도 스케줄 가능
        const weekendFeedback = userMessages
            .map(m => m.content || '')
            .join(' ')
            .toLowerCase();
        
        if (weekendFeedback.includes('주말') && 
            (weekendFeedback.includes('쉬') || weekendFeedback.includes('휴식') || weekendFeedback.includes('안') || weekendFeedback.includes('금지'))) {
            weekendPolicy = 'rest'; // 주말 휴식
            console.log('[새 아키텍처] 사용자 피드백: 주말 휴식 모드 활성화');
        }
        
        return weekendPolicy;
    }

    /**
     * 고정 일정(event/appointment)을 tasks에서 분리하여 busy에 추가
     */
    separateFixedEvents(existingTasks, now, baseRelDay, allowedDays) {
        const fixedEvents = [];
        const tasksOnly = [];
        
        // 고정 일정 키워드 (무조건 busy로 분리)
        const EVENT_KEYWORDS = ['회의', '미팅', '수업', '세미나', '발표', '진료', '인터뷰', '약속', '행사', '촬영', '면담', '상담', '강의', '시험'];
        
        for (const task of (existingTasks || [])) {
            const taskType = task.type || 'task';
            const taskTitle = (task.title || '').trim();
            
            // 1) 타입 체크: appointment, event 타입
            // 2) deadlineTime 존재 체크
            // 3) 키워드 체크: 회의/미팅/수업 등
            const isEvent = 
                taskType === 'appointment' || 
                taskType === 'event' || 
                task.deadlineTime ||
                EVENT_KEYWORDS.some(keyword => taskTitle.includes(keyword));
            
            if (isEvent) {
                // day 계산 (deadline 기준)
                if (task.deadline || task.deadlineAtMidnight) {
                    const deadlineDate = task.deadline ? new Date(task.deadline) : new Date(task.deadlineAtMidnight);
                    const daysDiff = Math.floor((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    const taskDay = baseRelDay + daysDiff;
                    
                    if (allowedDays.includes(taskDay)) {
                        const start = normalizeHHMM(task.deadlineTime || '12:00');
                        const duration = task.estimatedMinutes || task.durationMin || 60;
                        const startMin = timeToMinutes(start);
                        const endMin = startMin + duration;
                        const end = minutesToTime(endMin);
                        
                        fixedEvents.push({
                            day: taskDay,
                            start,
                            end,
                            title: taskTitle,
                            source: 'event'
                        });
                        console.log(`[새 아키텍처] 고정 일정으로 분리: ${taskTitle} → day ${taskDay}, ${start}-${end}`);
                    }
                } else {
                    // deadline이 없어도 키워드 매칭되면 busy에 포함 (하지만 day를 알 수 없으므로 경고)
                    console.warn(`[새 아키텍처] 고정 일정 키워드 매칭되었지만 deadline 없음: ${taskTitle}`);
                }
            } else {
                // task만 tasksOnly에 추가
                tasksOnly.push(task);
            }
        }
        
        return { fixedEvents, tasksOnly };
    }

    /**
     * tasks를 새 스키마로 변환 (taskId 추가) - task만 포함 + 전략 주입
     */
    prepareTasksForAI(tasksOnly, now, baseRelDay) {
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
            
            // 전략 계산: 중요/난이도 高 + 임박 마감
            const urgent = daysUntil(task.deadline) <= 3;
            const highPriority = task.importance === '상';
            const highDifficulty = task.difficulty === '상';
            const high = highPriority || highDifficulty;
            
            // chunk 전략 주입
            const minBlockMinutes = (high || urgent) ? 120 : 60;  // 분
            const deadlineDay = getDeadlineDay(task.deadline);
            
            return {
                id: taskId,
                title: task.title,
                deadline_day: deadlineDay,
                priority: highPriority ? '상' : (task.importance === '중' ? '중' : '하'),
                difficulty: highDifficulty ? '상' : (task.difficulty === '중' ? '중' : '하'),
                min_block_minutes: minBlockMinutes,
                prefer_around: task.preferNear || '19:00',
                // 메타 정보 (검증용 - 서버에서만 사용)
                _original: {
                    deadline: task.deadline,
                    importance: task.importance || '중',
                    difficulty: task.difficulty || '중',
                    daysUntil: daysUntil(task.deadline),
                    estimatedMinutes: task.estimatedMinutes || task.durationMin || 60
                }
            };
        });
        
        return { tasksForAI, tasksById };
    }

    /**
     * AI 프롬프트 생성
     */
    buildSystemPrompt({ year, month, date, currentDayName, anchorDay, baseRelDay, freeWindowsList, tasksForAIJSON, weekendInstruction }) {
        return {
            role: 'system',
            content: `당신은 스케줄러입니다. 제공된 free_windows 안에서만 tasks를 배치하세요.

**현재 날짜: ${year}년 ${month}월 ${date}일 (${currentDayName})**
**기준 day: ${anchorDay}**

**규칙 (가능한 한 따르세요):**
1) 배치는 제공된 free_windows 내부에서만
2) 각 작업은 deadline_day를 넘기지 마세요
3) priority='상' 또는 difficulty='상' 또는 deadline_day<=${baseRelDay + 3}이면 블록 길이 최소 min_block_minutes(120분) 이상
4) 같은 날에 동일 작업은 가급적 1회, 부족하면 2회까지 분할
5) 겹치기 금지, 생활패턴/고정일정 침범 금지
6) **주말 정책**: ${weekendInstruction}

**입력:**
\`\`\`json
{
  "free_windows": ${JSON.stringify(freeWindowsList, null, 2)},
  "tasks": ${JSON.stringify(tasksForAIJSON, null, 2)}
}
\`\`\`

**출력 형식:**
\`\`\`json
{
  "placements": [
    { "task_id": "t1", "day": 8, "start": "17:00", "end": "19:00" },
    { "task_id": "t2", "day": 7, "start": "13:00", "end": "15:00" }
  ]
}
\`\`\`

placements 배열만 반환하세요.`
        };
    }

    /**
     * AI 응답 파싱
     */
    parseAIResponse(content, tasksById) {
        // JSON 파싱 - 더 강화된 처리
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
        
        // placements, breaks, unplaced 구조 파싱
        let placements = [];
        let breaks = [];
        let unplaced = [];
        let explanation = '';
        
        // AI 응답 파싱: placements 배열 또는 schedule 구조
        if (Array.isArray(parsed.placements)) {
            console.log('[새 아키텍처] placements 구조 사용');
            placements = parsed.placements || [];
            breaks = parsed.breaks || [];
            unplaced = parsed.unplaced || [];
            explanation = parsed.explanation || parsed.reason || '';
            
            console.log(`[새 아키텍처] placements: ${placements.length}개`);
            console.log(`[새 아키텍처] breaks: ${breaks.length}개`);
            console.log(`[새 아키텍처] unplaced: ${unplaced.length}개`);
        } else if (Array.isArray(parsed)) {
            // AI가 placements 배열만 반환한 경우
            console.log('[새 아키텍처] placements 배열 직접 반환');
            placements = parsed || [];
            breaks = [];
            unplaced = [];
            explanation = '';
            
            console.log(`[새 아키텍처] placements: ${placements.length}개`);
        } else {
            // 레거시 호환: schedule 구조를 placements로 변환
            console.log('[레거시 호환] schedule 구조를 placements로 변환');
            
            if (Array.isArray(parsed.schedule)) {
                for (const dayObj of parsed.schedule) {
                    if (!dayObj || !Array.isArray(dayObj.activities)) continue;
                    
                    for (const act of dayObj.activities) {
                        // task 타입만 placements로 변환
                        if (act.type === 'task') {
                            // taskId가 없으면 title로 tasksById에서 찾기
                            let taskId = act.taskId || act.id;
                            if (!taskId && act.title) {
                                // tasksById에서 title로 찾기
                                for (const [tid, task] of Object.entries(tasksById)) {
                                    if (task.title === act.title) {
                                        taskId = tid;
                                        break;
                                    }
                                }
                                // 못 찾으면 생성 (임시 ID)
                                if (!taskId) {
                                    taskId = `t_${act.title.replace(/\s+/g, '_')}`;
                                }
                            }
                            
                            if (taskId) {
                                placements.push({
                                    taskId: taskId,
                                    day: dayObj.day,
                                    start: act.start,
                                    end: act.end,
                                    reason: act.reason || ''
                                });
                            }
                        }
                    }
                }
            }
            
            explanation = parsed.explanation || '';
        }
        
        return { placements, breaks, unplaced, explanation };
    }

    /**
     * AI 스케줄 생성 호출
     */
    async callOpenAI(messages) {
        const payload = {
            model: 'gpt-4o-mini',
            messages: messages,
            temperature: 0.2,
            max_tokens: 2400,
            response_format: { type: 'json_object' }
        };
        
        const T1 = Date.now();
        
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
                console.log('[타이밍] 총 소요 시간:', T4 - T1, 'ms');
                return res;
            });
        });
        
        return response.data.choices?.[0]?.message?.content;
    }
}

module.exports = ScheduleGenerator;

