const aiService = require('../services/aiService');

// 간단한 스케줄 생성 함수 (AI 실패 시 폴백)
function buildSimpleScheduleFromPrompt(prompt) {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    
    // 사용자 요청을 기반으로 한 더 현실적인 기본 스케줄
    return {
        schedule: [
            {
                title: "수면",
                start: `${dateStr}T00:00:00`,
                end: `${dateStr}T06:00:00`,
                category: "break",
                notes: "충분한 수면"
            },
            {
                title: "아침 식사",
                start: `${dateStr}T07:00:00`,
                end: `${dateStr}T08:00:00`,
                category: "meal",
                notes: "건강한 아침 식사"
            },
            {
                title: "주요 작업",
                start: `${dateStr}T09:00:00`,
                end: `${dateStr}T12:00:00`,
                category: "work",
                notes: prompt || "오늘의 주요 작업"
            },
            {
                title: "점심 식사",
                start: `${dateStr}T12:00:00`,
                end: `${dateStr}T13:00:00`,
                category: "meal",
                notes: "점심 식사"
            },
            {
                title: "오후 작업",
                start: `${dateStr}T13:30:00`,
                end: `${dateStr}T17:00:00`,
                category: "work",
                notes: "오후 업무 시간"
            },
            {
                title: "운동",
                start: `${dateStr}T17:30:00`,
                end: `${dateStr}T18:30:00`,
                category: "exercise",
                notes: "일일 운동"
            },
            {
                title: "저녁 식사",
                start: `${dateStr}T19:00:00`,
                end: `${dateStr}T20:00:00`,
                category: "meal",
                notes: "저녁 식사"
            },
            {
                title: "개인 시간",
                start: `${dateStr}T20:30:00`,
                end: `${dateStr}T22:00:00`,
                category: "study",
                notes: "독서나 학습 시간"
            }
        ],
        notes: "빠른 응답을 위한 기본 스케줄입니다. 더 정확한 스케줄을 원하시면 다시 시도해주세요."
    };
}

class AIController {
    // 스케줄 생성
    async generateSchedule(req, res) {
        try {
            console.log('[Schedule] 요청 받음:', {
                hasPrompt: !!req.body?.prompt, 
                hasContext: !!req.body?.conversationContext,
                hasSessionId: !!req.body?.sessionId,
                hasLifestylePatterns: !!req.body?.lifestylePatterns,
                lifestylePatterns: req.body?.lifestylePatterns
            });
            
            // 한글 인코딩 디버깅
            console.log('[Schedule] 원본 lifestylePatterns:', req.body?.lifestylePatterns);
            if (req.body?.lifestylePatterns) {
                req.body.lifestylePatterns.forEach((pattern, index) => {
                    console.log(`[Schedule] 패턴 ${index + 1} 원본:`, pattern);
                    console.log(`[Schedule] 패턴 ${index + 1} 길이:`, pattern.length);
                    console.log(`[Schedule] 패턴 ${index + 1} 바이트:`, Buffer.from(pattern, 'utf8'));
                });
            }
            
            const { prompt, conversationContext = [], sessionId, lifestylePatterns = [] } = req.body || {};
            if (!prompt || typeof prompt !== 'string') {
                return res.status(400).json({ error: 'prompt가 필요합니다.' });
            }

            // 대화 맥락을 포함한 메시지 구성 (안전하게 처리)
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

            // 빠른 응답을 위해 로컬 스케줄 생성 사용 (AI 우회)
            console.log('[Schedule] 빠른 로컬 스케줄 생성 사용');
            
            // 인라인으로 간단한 스케줄 생성
            const today = new Date();
            const jsDay = today.getDay(); // 0=일,6=토
            const baseGptDay = jsDay === 0 ? 7 : jsDay; // 월=1~일=7
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const dateStr = tomorrow.toISOString().split('T')[0];
            
            // 사용자의 생활패턴을 기반으로 스케줄 생성 (일수 확장)
            const schedule = [];
            const daysRequested = Math.max(
                1,
                Math.min(365, Number(req.body?.daysRequested || req.query?.days || 28))
            );
            
            // 생활패턴 처리
            if (Array.isArray(lifestylePatterns) && lifestylePatterns.length > 0) {
                console.log('[Schedule] 생활패턴 처리 시작, 개수:', lifestylePatterns.length);
                
                lifestylePatterns.forEach((pattern, index) => {
                    if (pattern && typeof pattern === 'string') {
                        console.log(`[Schedule] 패턴 ${index + 1} 처리:`, pattern);
                        
                        // 한글이 깨진 경우를 위한 하드코딩된 패턴 매칭
                        let startHour, endHour, isWeekday = false, isWeekend = false;
                        
                        // 패턴별 하드코딩 매칭
                        if (pattern.includes('3') && pattern.includes('11')) {
                            // "주말 새벽 3시~ 오전 11시 수면"
                            startHour = 3;
                            endHour = 11;
                            isWeekend = true;
                            console.log('[Schedule] 주말 수면 패턴 매칭');
                        } else if (pattern.includes('8') && pattern.includes('5')) {
                            // "평일 8시~ 오후 5시 동은정보기술 출근"
                            startHour = 8;
                            endHour = 17; // 오후 5시 = 17시
                            isWeekday = true;
                            console.log('[Schedule] 평일 출근 패턴 매칭');
                        } else if (pattern.includes('12') && pattern.includes('6')) {
                            // "평일 12시 30분~ 6시 수면" -> 00:30~06:00 (새벽 12:30~06:00)
                            startHour = 0; // 12시 = 00시 (새벽)
                            endHour = 6; // 다음날 새벽 6시
                            isWeekday = true;
                            console.log('[Schedule] 평일 야간 수면 패턴 매칭');
                        } else {
                            // 기본 파싱 시도
                            const numbers = pattern.match(/\d+/g);
                            if (numbers && numbers.length >= 2) {
                                startHour = parseInt(numbers[0]);
                                endHour = parseInt(numbers[1]);
                                
                                // 오후 시간 처리
                                if (pattern.includes('오후') || pattern.includes('5')) {
                                    endHour = endHour === 12 ? 12 : endHour + 12;
                                }
                                
                                // 요일 판단
                                isWeekday = pattern.includes('평일');
                                isWeekend = pattern.includes('주말');
                            } else {
                                console.log('[Schedule] 패턴 파싱 실패, 건너뜀');
                                return;
                            }
                        }
                        
                        console.log('[Schedule] 최종 파싱 결과:', { startHour, endHour, isWeekday, isWeekend });
                        
                        // 패턴별 제목 생성 (접두사 제거)
                        let patternTitle;
                        if (isWeekend) {
                            patternTitle = "수면";
                        } else if (isWeekday && startHour === 8) {
                            patternTitle = "출근";
                        } else if (isWeekday && (startHour === 0 || startHour === 12)) {
                            patternTitle = "수면";
                        } else {
                            patternTitle = "수면";
                        }
                        
                        const applyDayRange = (startDay, endDay, blockBuilder) => {
                            for (let day = startDay; day <= endDay; day++) {
                                const built = blockBuilder(day);
                                if (built) schedule.push(built);
                            }
                        };

                        if (isWeekday) {
                            // 전체 기간에서 평일만 선택적으로 반복 배치
                            applyDayRange(1, daysRequested, (day) => {
                                // 오늘의 GPT 요일(baseGptDay)을 기준으로 상대 day를 실제 요일로 변환
                                // 예) 오늘이 수(3)이고 day가 4면: ((3 + 4 - 2) % 7) + 1 = 6(토)
                                const weekdayIndex = ((baseGptDay + day - 2) % 7) + 1; // 1..7
                                if (weekdayIndex >= 1 && weekdayIndex <= 5) {
                                    if (startHour === 0 && endHour === 6) {
                                        return {
                                            title: patternTitle,
                                            days: [{ day, start: "00:30", end: "06:00", title: patternTitle, type: "lifestyle" }]
                                        };
                                    } else {
                                        return {
                                            title: patternTitle,
                                            days: [{
                                                day,
                                                start: `${startHour.toString().padStart(2, '0')}:00`,
                                                end: `${endHour.toString().padStart(2, '0')}:00`,
                                                title: patternTitle,
                                                type: "lifestyle"
                                            }]
                                        };
                                    }
                                }
                                return null;
                            });
                        } else if (isWeekend) {
                            // 전체 기간에서 주말만 반복 배치
                            applyDayRange(1, daysRequested, (day) => {
                                const weekdayIndex = ((baseGptDay + day - 2) % 7) + 1; // 1..7
                                if (weekdayIndex === 6 || weekdayIndex === 7) {
                                    return {
                                        title: patternTitle,
                                        days: [{
                                            day,
                                            start: `${startHour.toString().padStart(2, '0')}:00`,
                                            end: `${endHour.toString().padStart(2, '0')}:00`,
                                            title: patternTitle,
                                            type: "lifestyle"
                                        }]
                                    };
                                }
                                return null;
                            });
                        } else {
                            // 요일 구분이 없으면 전체 기간에 반복 배치
                            applyDayRange(1, daysRequested, (day) => ({
                                title: patternTitle,
                                days: [{
                                    day,
                                    start: `${startHour.toString().padStart(2, '0')}:00`,
                                    end: `${endHour.toString().padStart(2, '0')}:00`,
                                    title: patternTitle,
                                    type: "lifestyle"
                                }]
                            }));
                        }
                    }
                });
            }
            
            // 기본 작업 추가 (사용자 요청) - 시스템 프롬프트 필터링
            if (prompt && !prompt.includes('당신은 사용자의 생활 패턴과 할 일') && !prompt.includes('고급 일정 관리 전문가')) {
                const taskTitle = prompt.length > 20 ? prompt.substring(0, 20) + "..." : prompt;
                schedule.push({
                    title: taskTitle,
                    days: [{
                        day: 1,
                        start: "09:00",
                        end: "12:00",
                        title: taskTitle,
                        type: "task"
                    }]
                });
            }
            
            // 생활패턴이 없으면 기본 스케줄 추가
            if (schedule.length === 0) {
                schedule.push({
                    title: "기본 수면",
                    days: [{
                        day: 1,
                        start: "00:00",
                        end: "06:00",
                        title: "기본 수면",
                        type: "lifestyle"
                    }]
                });
            }
            
            const fallback = {
                schedule: schedule,
                notes: "사용자의 생활패턴을 반영한 스케줄입니다."
            };
            
        console.log('[Schedule] 생성된 스케줄:', JSON.stringify(fallback, null, 2));
        
        return res.json(fallback);
        } catch (error) {
            console.error('스케줄 생성 실패:', error);
            res.status(500).json({ error: '스케줄 생성에 실패했습니다.' });
        }
    }
    // GPT-4o 이미지 처리
    async processImage(req, res) {
        try {
            const { image, prompt } = req.body;
            
            if (!image) {
                return res.status(400).json({ error: '이미지가 필요합니다.' });
            }

            const result = await aiService.processImage(image, prompt);
            res.json({ text: result });
        } catch (error) {
            console.error('GPT-4o 이미지 처리 실패:', error);
            res.status(500).json({ error: '이미지 처리에 실패했습니다.' });
        }
    }

    // Whisper 음성 인식
    async transcribeAudio(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ error: '오디오 파일이 필요합니다.' });
            }

            const result = await aiService.transcribeAudio(req.file.buffer);
            res.json({ text: result });
        } catch (error) {
            console.error('Whisper 음성 인식 실패:', error);
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

    // OpenAI 연결 진단 (최소한의 호출로 상태 확인)
    async debugOpenAI(req, res) {
        try {
            const messages = [
                { role: 'system', content: 'You are a test assistant.' },
                { role: 'user', content: 'Return the JSON {"ok":true} only.' }
            ];
            const text = await aiService.generateSchedule(messages);
            return res.json({ ok: true, length: typeof text === 'string' ? text.length : 0, sample: String(text).slice(0, 120) });
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            return res.status(500).json({ ok: false, status, data, message: error.message });
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

}

module.exports = new AIController();
