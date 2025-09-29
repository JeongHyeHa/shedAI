import React, { useRef, useEffect } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import '../../styles/fullcalendar-custom.css';

const Calendar = ({ 
  events = [], 
  onEventMount, 
  onViewDidMount, 
  onDatesSet,
  onDayHeaderContent,
  onEventContent 
}) => {
  const calendarRef = useRef(null);

  // 이벤트를 캘린더에 적용
  const applyEventsToCalendar = (eventsToApply) => {
    const calendarApi = calendarRef.current?.getApi();
    if (!calendarApi) return;
    
    calendarApi.removeAllEvents();
    const viewType = calendarApi.view.type;
    
    const processedEvents = eventsToApply.map(event => {
      const newEvent = { ...event };      
      if (event.extendedProps?.type === "lifestyle") {
        if (viewType === "dayGridMonth") {
          newEvent.display = "none";
        } else {
          newEvent.backgroundColor = "#CFCFCF";
          newEvent.borderColor = "#AAAAAA";
          newEvent.textColor = "#333333";
        }
      }
      return newEvent;
    });

    calendarApi.addEventSource(processedEvents);
  };

  // 이벤트가 변경될 때마다 캘린더에 적용
  useEffect(() => {
    if (events.length > 0) {
      applyEventsToCalendar(events);
    }
  }, [events]);

  return (
    <div className="calendar-container">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          start: "prev,next today",
          center: "title",
          end: "dayGridMonth,timeGridWeek,timeGridDay"
        }}
        events={[]}
        height="auto"
        aspectRatio={1.35}
        contentHeight="auto"
        dayMaxEventRows={3} 
        allDaySlot={true}
        navLinks={true}
        nowIndicator={true}
        eventDidMount={onEventMount}
        viewClassNames={(arg) => [`view-${arg.view.type}`]}
        viewDidMount={onViewDidMount}
        datesSet={onDatesSet}
        dayHeaderContent={onDayHeaderContent}
        eventContent={onEventContent}
      />
    </div>
  );
};

export default Calendar;
