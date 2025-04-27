
document.addEventListener('DOMContentLoaded', function() {
  var calendarEl = document.getElementById('calendar');

  var calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'timeGridWeek',
    nowIndicator: true,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'timeGridDay,timeGridWeek,dayGridMonth'
    },
    events: []  // 임시 비워둠
  });

  calendar.render();

    async function loadSchedule() {
        try {
            const response = await fetch('/api/schedule');
            const scheduleData = await response.json();
            calendar.addEventSource(scheduleData);
        } catch (error) {
            console.error('시간표 불러오기 실패:', error);
        }
    }

    // 함수 호출
    loadSchedule();

    // ✨ 저장 버튼
    document.getElementById('saveBtn').addEventListener('click', function () {
        html2canvas(calendarEl).then(function (canvas) {
            var link = document.createElement('a');
            link.download = 'my_calendar.png';
            link.href = canvas.toDataURL();
            link.click();
        });
    });
});