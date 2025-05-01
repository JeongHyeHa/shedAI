// 시간 리셋하는 함수
function resetToStartOfDay(date, isEnd = false) {
    const newDate = new Date(date);
    if(isEnd)
        newDate.setHours(23, 59, 59, 999); 
    else 
        newDate.setHours(0, 0, 0, 0);

    return newDate;
}

// JS 기준 요일(day:0=일) -> GPT 요일로 변환(day:1=일)
function getGptDayIndex(date) {
    const jsDay = date.getDay(); // 0 = 일요일, 1 = 월요일 ...
    return jsDay === 0 ? 7 : jsDay; // GPT 기준: 월(1)~일(7)
}

function buildShedAIPrompt(lifestyleText, taskText, today) {
    const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const dayIndex = today.getDay(); // 일(0) ~ 토(6)
    const gptDayIndex = getGptDayIndex(today); // GPT 기준: 일(day:1) ~ 토(day:7)
    const dayName = dayNames[dayIndex];
    const prefix =
        `오늘은 GPT 기준 ${dayName}(day:${gptDayIndex})입니다. 
        가능한 한 오늘(day:${gptDayIndex})부터 day:7까지를 이번 주로 간주하고, 
        중요하거나 마감이 임박한 일은 가능한 한 오늘부터 바로 시작해주세요.  
        부족한 경우 다음 주 월요일부터 이어서 할 일을 배치해주세요.`;

    return `${prefix}\n[생활 패턴]\n${lifestyleText}\n\n[할 일 목록]\n${taskText}`;
}

// FullCalendar 캘린더 생성
document.addEventListener('DOMContentLoaded', function () {
    const today = resetToStartOfDay(new Date());

    var calendarEl = document.getElementById('calendar');

    var calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        initialDate: new Date(today),
        nowIndicator: true,
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridDay,timeGridWeek,dayGridMonth'
        },
        events: []  // 초기에는 비워두기
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

            const today = resetToStartOfDay(new Date());
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

// day -> 실제 날짜로 변환
function convertScheduleToEvents(gptSchedule, today = new Date()) {
    const events = [];
    const gptDayToday = getGptDayIndex(today);  // GPT 기준 오늘 날짜 

    gptSchedule.forEach(dayBlock => {
        // 지난 요일이면 다음 주로 넘김
        const dateOffset = (dayBlock.day - gptDayToday + 7) % 7;
        const targetDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dateOffset);
        const dateStr = formatLocalISO(targetDate).split('T')[0];

        dayBlock.activities.forEach(activity => {
            const start = new Date(`${dateStr}T${activity.start}`);
            let end = new Date(`${dateStr}T${activity.end}`);

            if (end < start) {
                if (activity.title.includes("수면")) {    // ex) 23:30~07:00 
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
                } else {
                    end.setDate(end.getDate() + 1);
                }
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

function pad(n) {
    return n.toString().padStart(2, '0');
}

function formatLocalISO(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}
