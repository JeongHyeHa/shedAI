
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
    events: []  // 초기에는 비워두기
  });

  calendar.render();

  // 서버로부터 기본 시간표 불러오기
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

  // 프롬프트로 새로운 시간표 생성하기
  document.getElementById('generateBtn').addEventListener('click', async function () {
      const prompt = document.getElementById('promptInput').value;
      if (!prompt.trim()) {
          alert('프롬프트를 입력해주세요!');
          return;
      }

      try {
          const response = await fetch('/api/generate-schedule', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: prompt })
          });
          const newSchedule = await response.json();

          calendar.removeAllEvents(); // 기존 시간표 삭제
          calendar.addEventSource(newSchedule); // 새로운 시간표 추가
      } catch (error) {
          console.error('새 시간표 생성 실패:', error);
      }
  });

  // 저장 버튼
  document.getElementById('saveBtn').addEventListener('click', function () {
      html2canvas(calendarEl).then(function (canvas) {
          var link = document.createElement('a');
          link.download = 'my_calendar.png';
          link.href = canvas.toDataURL();
          link.click();
      });
  });
});