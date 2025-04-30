
// FullCalendar 캘린더 생성
document.addEventListener('DOMContentLoaded', function () {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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

        const prompt = `[생활 패턴]\n${lifestyle}\n\n[할 일 목록]\n${tasks}`;

        try {
            const response = await fetch('/api/generate-schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });

            const newSchedule = await response.json();

            const today = new Date();
            today.setHours(0, 0, 0, 0);
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

    const todayIndex = today.getDay(); // 일(0), 월(1), ..., 토(6)
    const gptDayToday = todayIndex === 0 ? 7 : todayIndex; // GPT 기준: 월(1) ~ 일(7) // 오늘 날짜 

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
                    const startOfToday = new Date(start);
                    startOfToday.setHours(0, 0, 0, 0);

                    const endOfToday = new Date(start);
                    endOfToday.setHours(23, 59, 59, 999);

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
