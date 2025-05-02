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

// 프롬프트 생성
function buildShedAIPrompt(lifestyleText, taskText, today) {
    const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const dayIndex = today.getDay(); // 일(0) ~ 토(6)
    const gptDayIndex = getGptDayIndex(today); // GPT 기준: 일(day:1) ~ 토(day:7)
    const dayName = dayNames[dayIndex];
    const prefix =
        `오늘은 GPT 기준 ${dayName}(day:${gptDayIndex})입니다. 
        모든 할 일은 반드시 오늘(day:${gptDayIndex})을 기준으로 상대적 마감일을 day 숫자로 환산하여, 
        해당 마감일까지 day:14, day:15 등 필요한 만큼 스케줄을 생성해야 합니다.
        중요하거나 마감이 임박한 일은 오늘부터 바로 시작하고,
        **절대로 day:7까지만 출력하거나 중간에 멈추지 마세요.`;

    return `${prefix}\n[생활 패턴]\n${lifestyleText}\n\n[할 일 목록]\n${taskText}`;
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

            if (end < start) {
                const startOfToday = resetToStartOfDay(start)   // 자정으로 초기화(00:00)
                const endOfToday = resetToStartOfDay(start, true);  // 하루 끝으로 초기화(23:59)

                // 00:00 ~ 07:00 수면
                events.push({
                    title: activity.title,
                    start: formatLocalISO(startOfToday),
                    end: formatLocalISO(end)
                });

                // 23:30 ~ 23:59 수면
                events.push({
                    title: activity.title,
                    start: formatLocalISO(start),
                    end: formatLocalISO(endOfToday)
                });
                return;
            }
            events.push({
                title: activity.title,
                start: formatLocalISO(start),
                end: formatLocalISO(end)
            });
        });
    });

    return events;
}

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
        events: [] 
    });

    calendar.render();

    // 새로운 시간표 생성 버튼
    document.getElementById('generateBtn').addEventListener('click', async function () {
        const lifestyle = document.getElementById('lifestyleInput').value.trim();
        const tasks = document.getElementById('taskInput').value.trim();

        if (!lifestyle || !tasks) {
            alert("생활 패턴과 할 일 목록을 모두 입력해주세요!");
            return;
        }

        const prompt = buildShedAIPrompt(lifestyle, tasks, new Date());

        try {
            const response = await fetch('/api/generate-schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });

            const newSchedule = await response.json();
            const events = convertScheduleToEvents(newSchedule.schedule, today);
            calendar.removeAllEvents(); // 기존 시간표 삭제
            calendar.addEventSource(events); // 새로운 시간표 추가

            document.getElementById('lifestyleInput').value = '';
            document.getElementById('taskInput').value = '';

        } catch (error) {
            console.error('새 시간표 생성 실패:', error);
        }
    });
});
