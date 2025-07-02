// 시간 리셋하는 함수
function resetToStartOfDay(date, isEnd = false) {
    const newDate = new Date(date);
    if(isEnd)
        newDate.setHours(23, 59, 59, 999); 
    else 
        newDate.setHours(0, 0, 0, 0);
    return newDate;
}

// 요일 변환 함수 (JS기준 일=0 → GPT기준 월=1, ..., 일=7)
function getGptDayIndex(date) {
    const jsDay = date.getDay(); 
    return jsDay === 0 ? 7 : jsDay; 
}

// 날짜 → ISO 형식으로 포맷
function formatLocalISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
}

// 프롬프트 생성 _ver1(새로운 시간표 생성)
function buildShedAIPrompt(lifestyleText, taskText, today) {
    const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const gptDayIndex = getGptDayIndex(today); // 월=1 ~ 일=7
    const dayName = dayNames[today.getDay()];
    const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
    const nowTime = `${today.getHours()}시 ${today.getMinutes()}분`;

    const prefix =
`오늘 날짜는 ${dateStr} ${dayName}(day:${gptDayIndex})요일이며, 현재 시각 ${nowTime}이후부터의 시간대에만 할 일을 배치하세요. 이전 시간은 이미 지났으므로 제외하세요.
- 생활 패턴에 포함된 활동(예: 수면, 회사 업무, 가족 시간 등)은 **절대적으로 고정된 일정**이며,  
어떠한 할 일도 해당 시간대를 침범해서는 안 됩니다.
- 반드시 먼저 생활 패턴을 고정 시간대로 배치한 후, 남는 시간대에만 할 일을 배치하세요.
모든 할 일은 반드시 오늘(day:${gptDayIndex})을 기준으로 상대적 마감일을 day 숫자로 환산하여, 
해당 마감일까지 day:14, day:15 등 필요한 만큼 스케줄을 생성해야 합니다.
중요하거나 마감이 임박한 일은 오늘부터 바로 시작하고,
**절대로 day:7까지만 출력하거나 중간에 멈추지 마세요.
- 일정이 day:14 또는 그 이전에서 종료되더라도, 그 이유를 반드시 notes에 설명하세요.
- 예: "할 일의 총 소요 시간이 충분히 분산되어 day:10까지만 계획하면 됩니다."
- 계획이 짧게 끝난 경우, 사용자가 불안해하지 않도록 **왜 더 이상 배치하지 않았는지 반드시 notes에 포함**해야 합니다.

📌 마감일 처리 방식 안내:
- 날짜 기반 마감일("5월 19일 오전 9시", "5월 28일까지")이 주어질 경우,
  반드시 오늘 날짜를 기준으로 day:x 값을 계산하여 사용해야 합니다.
- 예: 오늘이 5월 15일(day:4)이고, 마감일이 5월 19일이면 → day:8입니다.
- 모든 할 일은 이 상대 day:x 값을 기준으로 정확히 스케줄링해야 하며,
  마감일을 초과한 일정 배치는 절대로 하지 마세요.`;

    return `${prefix}\n[생활 패턴]\n${lifestyleText}\n\n[할 일 목록]\n${taskText}`;
}

// 프롬프트 생성_ver2(기존 시간표 수정)
function buildFeedbackPrompt(lifestyleText, taskText, previousSchedule) {
    const prefix =
        `기존 시간표를 유지하면서, 피드백과 새로운 할 일을 반영해 전체 일정을 다시 설계하세요.
        기존 활동은 가능한 유지하되, 필요시 우선순위에 따라 재조정 가능합니다.`;

    return `${prefix}
            
[기존 시간표]
${JSON.stringify(previousSchedule, null, 2)}
            
[사용자 피드백 및 추가 할 일]
${lifestyleText}
${taskText}

[조건]
- 기존 할 일과 새 할 일을 병합해 중요도 및 마감일 기준으로 재정렬
- 사용자의 요구사항을 기반으로 스케줄을 재설계하기
- 야간 작업이나 쉬는 시간 조정 같은 피드백은 반드시 반영
- day:오늘부터 마감일까지 연속된 일정으로 출력
- 스케줄이 조기 종료될 경우 반드시 notes에 이유를 설명하세요
- 기존 할 일의 마감일이 수정된 게 아닌 이상, 기존의 마감일을 반드시 유지해야 하며, 절대로 더 일찍 끝내지 마세요
- 기존 작업이 day:14까지 진행되고 있었다면, 그 작업은 최소한 day:14까지 계속 배치되어야 합니다.
- 피드백으로 인해 새 작업이 추가되거나 시간이 부족하더라도, 기존 할 일을 삭제하거나 조기 종료하지 마세요.
`;
}

// GPT 스케줄 → FullCalendar 캘린더 생성
function convertScheduleToEvents(gptSchedule, today = new Date()) {
    const events = [];
    const gptDayToday = gptSchedule[0].day;

    gptSchedule.forEach(dayBlock => {
        const dateOffset = dayBlock.day - gptDayToday;
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + dateOffset);
        const dateStr = formatLocalISO(targetDate).split('T')[0];

        dayBlock.activities.forEach(activity => {
            const start = new Date(`${dateStr}T${activity.start}`);
            let end = new Date(`${dateStr}T${activity.end}`);

            const startHour = Number(activity.start.split(":")[0]);
            const endHour = Number(activity.end.split(":")[0]);

            // 하루를 넘어가는 활동 처리 (예: 수면)
            if (endHour < startHour || (startHour >= 23 && endHour <= 6)) {
                // 다음 날짜 생성
                const nextDay = new Date(targetDate);
                nextDay.setDate(nextDay.getDate() + 1);
                const nextDateStr = formatLocalISO(nextDay).split('T')[0];
                
                // 시작 시간부터 자정까지
                const endOfDay = new Date(`${dateStr}T23:59:59`);
                events.push({
                    title: activity.title,
                    start: formatLocalISO(start),
                    end: formatLocalISO(endOfDay),
                    allDay: false,
                    extendedProps: {
                        type: activity.type || "lifestyle"
                    }
                });
                
                // 자정부터 종료 시간까지는 다음 날에 표시 (첫날이 아닌 경우에만)
                if (dateOffset > 0 || dayBlock.day > gptDayToday) {
                    const nextDayStart = new Date(`${nextDateStr}T00:00:00`);
                    const nextDayEnd = new Date(`${nextDateStr}T${activity.end}`);
                    events.push({
                        title: activity.title,
                        start: formatLocalISO(nextDayStart),
                        end: formatLocalISO(nextDayEnd),
                        allDay: false,
                        extendedProps: {
                            type: activity.type || "lifestyle"
                        }
                    });
                }
            } else {
                // 일반 활동 처리
                events.push({
                    title: activity.title,
                    start: formatLocalISO(start),
                    end: formatLocalISO(end),
                    allDay: false,
                    extendedProps: {
                        type: activity.type || "lifestyle"
                    }
                });
            }
        });
    });

    return events;
}

let lastSchedule = null;

// DOM 로딩 시 캘린더 세팅
document.addEventListener('DOMContentLoaded', function () {
    const today = resetToStartOfDay(new Date());
    var calendarEl = document.getElementById('calendar');
    var calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        initialDate: today,
        nowIndicator: true,
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridDay,timeGridWeek,dayGridMonth'
        },
        events: [],
        eventDidMount: function (info) {
            if (calendar.view.type === 'dayGridMonth') {
                if (info.event.extendedProps?.source !== 'task') {
                    info.el.style.display = 'none';  // 숨기기
                }
            }
        }
    });
    calendar.render();

    // === 새로고침 시 lastSchedule만 반영 (로딩/스케줄 생성 X) ===
    const lastSchedule = JSON.parse(localStorage.getItem('lastSchedule'));
    if (lastSchedule) {
        const events = convertScheduleToEvents(lastSchedule, new Date());
        calendar.removeAllEvents();
        calendar.addEventSource(events);
    }

    // === 생활패턴 추가/삭제 시 DB에 반영 ===
    async function saveLifestylePatternsToDB() {
        // 전체 생활패턴 목록 수집
        const lifestyleItems = Array.from(document.querySelectorAll('.lifestyle-item span')).map(el => el.textContent.trim());
        const sessionId = getOrCreateSessionId();
        // 서버에 저장
        await fetch('/api/lifestyle-patterns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, patterns: lifestyleItems })
        });
    }
    // 생활패턴 추가/삭제 버튼에 DB 저장 함수 연결
    const addLifestyleBtn = document.getElementById('addLifestyleBtn');
    if (addLifestyleBtn) addLifestyleBtn.addEventListener('click', saveLifestylePatternsToDB);
    const deleteLifestyleBtn = document.getElementById('deleteLifestyleBtn');
    if (deleteLifestyleBtn) deleteLifestyleBtn.addEventListener('click', saveLifestylePatternsToDB);

    // === 새로운 시간표 생성 ===
    document.getElementById('newScheduleBtn').addEventListener('click', async function () {
        const lifestyle = document.getElementById('lifestyleInput').value.trim();
        const tasks = document.getElementById('taskInput').value.trim();
        if (!lifestyle || !tasks) {
            alert("생활 패턴과 할 일 목록을 모두 입력해주세요!");
            return;
        }
        await generateSchedule(lifestyle, tasks, true, null, new Date());
    });

    // === 기존 시간표 수정 ===
    document.getElementById('updateScheduleBtn').addEventListener('click', async function () {
        const newLifestyle = document.getElementById('lifestyleInput').value.trim();
        const newTasks = document.getElementById('taskInput')?.value.trim() || "";
        if (!newTasks) {
            alert("추가할 할 일을 입력해주세요!");
            return;
        }
        await generateSchedule(newLifestyle, newTasks, false, lastSchedule, new Date());
    });

    // === [USER SESSION 관리 유틸 추가] ===
    const FIXED_USER_ID = 'test_user_001';
    function getOrCreateSessionId() {
        return FIXED_USER_ID;
    }

    // === [fetch 요청에 session_id 포함] ===
    // 프롬프트 기반 시간표 생성하는 함수
    async function generateSchedule(lifestyle, tasks, isNew = false, previousSchedule = null, nowDate = new Date()) {
        const statusDiv = document.getElementById('statusMessage');
        statusDiv.innerText = "스케줄을 설계합니다...";

        let prompt;
        if (isNew)
            prompt = buildShedAIPrompt(lifestyle, tasks, nowDate);
        else {
            prompt = buildFeedbackPrompt(lifestyle, tasks, previousSchedule);
        }

        // session_id 추가
        const sessionId = getOrCreateSessionId();

        try {
            const response = await fetch('/api/generate-schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, session_id: sessionId })
            });

            const newSchedule = await response.json();
            lastSchedule = newSchedule.schedule;    // 스케줄 백업
            console.log("받은 GPT 응답: ", newSchedule);

            const events = convertScheduleToEvents(newSchedule.schedule, nowDate);
            calendar.removeAllEvents();      // 기존 시간표 삭제
            calendar.addEventSource(events); // 새로운 시간표 추가

            // 상태창 메시지 처리
            if (typeof newSchedule.notes === 'string') { 
                statusDiv.innerHTML = newSchedule.notes.replace(/\n/g, '<br>');
            } else if (Array.isArray(newSchedule.notes)) {
                statusDiv.innerHTML = newSchedule.notes.join('<br>');
            }

            // 입력창 초기화
            document.getElementById('lifestyleInput').value = '';
            document.getElementById('taskInput').value = '';
        } catch (error) {
            console.error('새 시간표 생성 실패:', error);
            statusDiv.innerText = "출력에 실패했습니다.";
        }
    }

    // === 주간/일간 뷰에서 새로고침 없이도 이벤트가 보이도록 ===
    function refreshCalendarEvents() {
        const lastSchedule = JSON.parse(localStorage.getItem('lastSchedule'));
        if (lastSchedule) {
            const events = convertScheduleToEvents(lastSchedule, new Date());
            calendar.removeAllEvents();
            calendar.addEventSource(events);
        }
    }
    // 뷰 변경 시마다 이벤트 재적용
    calendar.on('datesSet', refreshCalendarEvents);
    calendar.on('viewDidMount', refreshCalendarEvents);
});