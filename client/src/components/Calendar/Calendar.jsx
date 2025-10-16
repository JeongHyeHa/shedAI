// 달력 컴포넌트 : 달력을 화면에 보여주는 컴포넌트
import React, { useRef, useEffect } from 'react'; // 웹페이지를 만드는 도구(달력에 접근/변경될 때마다 실행)
import FullCalendar from '@fullcalendar/react';  
import dayGridPlugin from '@fullcalendar/daygrid';  // 월간 달력 뷰
import timeGridPlugin from '@fullcalendar/timegrid';  // 주간/일간 달력 뷰
import '../../styles/fullcalendar-custom.css';

const Calendar = React.forwardRef(({ 
  events = [],        // 달력에 표시할 일정들(기본값 빈 배열)
  onEventMount,       // 일정이 달력에 나타날 때 실행할 함수
  onViewDidMount,     // 달력 뷰가 변경될 때 실행할 함수
  onDatesSet,         // 날짜가 변경될 때 실행할 함수
  onDayHeaderContent, // 요일 헤더를 만들 때 실행할 함수
  onEventContent      // 일정 내용을 만들 때 실행할 함수
}, ref) => {
  // ref는 부모 컴포넌트에서 전달받음

  // 이벤트 처리 함수 (lifestyle 타입 스타일링)
  const processEvents = (eventsToProcess) => {
    return eventsToProcess.map(event => {
      const newEvent = { ...event };      
      if (event.extendedProps?.type === "lifestyle") {
        newEvent.backgroundColor = "#CFCFCF";
        newEvent.borderColor = "#AAAAAA";
        newEvent.textColor = "#333333";
        newEvent.className = "lifestyle-event";
      }
      return newEvent;
    });
  };

  // 이벤트가 변경될 때마다 달력 업데이트 
  useEffect(() => {
    const calendarApi = ref?.current?.getApi();
    if (!calendarApi) return;
    
    calendarApi.removeAllEvents();
    if (events.length > 0) {
      const processedEvents = processEvents(events);
      calendarApi.addEventSource(processedEvents);
    }
  }, [events]);

  // 주말과 평일 구분을 위한 스타일 적용
  useEffect(() => {
    const calendarApi = ref?.current?.getApi();
    if (!calendarApi) return;

    const applyWeekendStyles = () => {
      // 모든 날짜 셀에 대해 주말 스타일 적용
      const dayElements = document.querySelectorAll('.fc-daygrid-day, .fc-timegrid-day');
      dayElements.forEach(dayEl => {
        const dateStr = dayEl.getAttribute('data-date');
        if (dateStr) {
          const date = new Date(dateStr);
          const dayOfWeek = date.getDay(); // 0=일요일, 6=토요일
          
          if (dayOfWeek === 0 || dayOfWeek === 6) {
            // 주말 (일요일, 토요일)
            dayEl.classList.add('weekend-day');
            dayEl.style.backgroundColor = '#FFF8DC';
          } else {
            // 평일
            dayEl.classList.remove('weekend-day');
            dayEl.style.backgroundColor = '';
          }
        }
      });

      // 요일 헤더에도 주말 스타일 적용
      const headerElements = document.querySelectorAll('.fc-col-header-cell');
      headerElements.forEach(headerEl => {
        const dayClass = Array.from(headerEl.classList).find(cls => cls.startsWith('fc-day-'));
        if (dayClass) {
          const dayName = dayClass.replace('fc-day-', '');
          if (dayName === 'sun' || dayName === 'sat') {
            headerEl.style.backgroundColor = '#FFF8DC';
            headerEl.style.fontWeight = 'bold';
          } else {
            headerEl.style.backgroundColor = '';
            headerEl.style.fontWeight = '';
          }
        }
      });
    };

    // 초기 적용
    applyWeekendStyles();

    // 날짜 변경 시마다 다시 적용
    const handleDatesSet = () => {
      setTimeout(applyWeekendStyles, 100);
    };

    calendarApi.on('datesSet', handleDatesSet);
    calendarApi.on('viewDidMount', handleDatesSet);

    return () => {
      calendarApi.off('datesSet', handleDatesSet);
      calendarApi.off('viewDidMount', handleDatesSet);
    };
  }, []);

  // 실제 달력 화면 만들기 
  return (
    <div className="calendar-container">
      <FullCalendar
        ref={ref} // 달력에 리모컨 연결 
        plugins={[dayGridPlugin, timeGridPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          start: "prev,next today",
          center: "title",
          end: "dayGridMonth,timeGridWeek,timeGridDay"
        }}
        height="auto"
        aspectRatio={1.35}  // 가로 세로 비율
        contentHeight="auto"
        dayMaxEventRows={3} 
        allDaySlot={true}
        navLinks={true}     // 날짜 클릭으로 이동 가능
        nowIndicator={true} // 현재 날짜 표시
        eventDidMount={onEventMount}  // 일정이 달력에 나타날 때 실행할 함수
        viewClassNames={(arg) => [`view-${arg.view.type}`]}
        viewDidMount={onViewDidMount} // 달력 뷰가 변경될 때 실행할 함수
        datesSet={onDatesSet}         // 날짜가 변경될 때 실행할 함수
        dayHeaderContent={onDayHeaderContent} // 요일 헤더를 만들 때 실행할 함수
        eventContent={onEventContent} // 일정 내용을 만들 때 실행할 함수
      />
    </div>
  );
});

export default Calendar;
