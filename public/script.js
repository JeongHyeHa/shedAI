// 최종 자동 포맷 변환 & 시간표 생성

// 자동 포맷 변환 함수
function autoFormatInput(rawInput) {
    const lines = rawInput.split('\n');
    let result = '';
    let currentSection = '';

    lines.forEach(line => {
        const trimmedLine = line.trim();

        if (trimmedLine.includes('생활패턴') || trimmedLine.includes('생활 패턴')) {
            currentSection = '[생활 패턴]';
            result += `${currentSection}\n`;
        } else if (trimmedLine.includes('할 일 목록')) {
            currentSection = '[할 일 목록]';
            result += `\n${currentSection}\n`;
        } else if (trimmedLine !== '') {
            if (currentSection) {
                result += `- ${trimmedLine}\n`;
            }
        }
    });

    return result;
}

// FullCalendar 캘린더 생성
document.addEventListener('DOMContentLoaded', function () {
    var calendarEl = document.getElementById('calendar');

    var calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
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
        const promptInput = document.getElementById('promptInput');
        let prompt = promptInput.value.trim();

        if (!prompt) {
            alert('프롬프트를 입력해주세요!');
            return;
        }

        const formattedPrompt = autoFormatInput(prompt);
        console.log('자동 변환된 프롬프트:', formattedPrompt);

        try {
            const response = await fetch('/api/generate-schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: formattedPrompt })
            });
            const newSchedule = await response.json();
            const convertedEvents = convertScheduleToCalendarEvents(newSchedule.schedule); // 변환 로직

            calendar.removeAllEvents(); // 기존 시간표 삭제
            calendar.addEventSource(convertedEvents); // 새로운 시간표 추가
            promptInput.value = '';
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