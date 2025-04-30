
// FullCalendar 캘린더 생성
document.addEventListener('DOMContentLoaded', function () {
    var calendarEl = document.getElementById('calendar');

    var calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        initialDate: new Date(),
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
            const events = convertScheduleToEvents(newSchedule.schedule, new Date());
            console.log("받은 시간표:", events);

            calendar.removeAllEvents(); // 기존 시간표 삭제
            calendar.addEventSource(events); // 새로운 시간표 추가

            document.getElementById('lifestyleInput').value = '';
            document.getElementById('taskInput').value = '';

        } catch (error) {
            console.error('새 시간표 생성 실패:', error);
        }
    });

    // 시간표 저장 버튼
    document.getElementById('saveBtn').addEventListener('click', function () {
        html2canvas(calendarEl).then(function (canvas) {
            var link = document.createElement('a');
            link.download = 'my_calendar.png';
            link.href = canvas.toDataURL();
            link.click();
        });
    });
});

// GPT JSON을 FullCalendar 형식으로 변환
function convertScheduleToCalendarEvents(schedule) {
    const events = [];
    const baseDate = new Date(); // 오늘 날짜 기준

    schedule.forEach((dayObj, index) => {
        const dayOffset = index; // day 1 = 오늘, day 2 = 내일...

        dayObj.activities.forEach(activity => {
            const startParts = activity.start.split(':');
            const endParts = activity.end.split(':');

            const start = new Date(baseDate);
            start.setDate(baseDate.getDate() + dayOffset);
            start.setHours(Number(startParts[0]), Number(startParts[1]));

            const end = new Date(baseDate);
            end.setDate(baseDate.getDate() + dayOffset);
            end.setHours(Number(endParts[0]), Number(endParts[1]));

            events.push({
                title: activity.title,
                start: start.toISOString(),
                end: end.toISOString()
            });
        });
    });

    return events;
}


// day -> 실제 날짜로 변환
function convertScheduleToEvents(gptSchedule, today = new Date()) {
    const events = [];

    const todayIndex = today.getDay(); // 일: 0, 월: 1, ..., 토: 6
    const gptDayToday = todayIndex === 0 ? 7 : todayIndex; // GPT 기준 day: 1 = 월 → 일요일(getDay=0)은 7로 보정

    gptSchedule.forEach(dayBlock => {
        const targetDate = new Date(today);

        // 지난 요일이면 다음 주로 넘김
        const dateOffset = (dayBlock.day - gptDayToday + 7) % 7;
        targetDate.setDate(today.getDate() + dateOffset);
        const dateStr = targetDate.toISOString().split('T')[0];

        dayBlock.activities.forEach(activity => {
            const start = new Date(`${dateStr}T${activity.start}`);
            let end = new Date(`${dateStr}T${activity.end}`);

            if (end < start) {
                if (activity.title.includes("수면")) {
                    // 수면은 두 개의 이벤트로 나눠서 표시
                    const midnight = new Date(start);
                    midnight.setHours(0, 0, 0, 0);

                    const earlyMorningEnd = new Date(`${dateStr}T${activity.end}`);
                    const lateNightStart = new Date(`${dateStr}T${activity.start}`);
                    const lateNightEnd = new Date(start);
                    lateNightEnd.setHours(23, 59, 59, 999);

                    // 00:00 ~ 07:00 수면
                    events.push({
                        title: activity.title,
                        start: midnight.toISOString(),
                        end: earlyMorningEnd.toISOString()
                    });

                    // 23:30 ~ 23:59 수면
                    events.push({
                        title: activity.title,
                        start: lateNightStart.toISOString(),
                        end: lateNightEnd.toISOString()
                    });
                    return;
                } else {
                    end.setDate(end.getDate() + 1);
                }
            }

            events.push({
                title: activity.title,
                start: start.toISOString(),
                end: end.toISOString()
            });
        });
    });

    return events;
}


