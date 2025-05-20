// /routes/CalendarPage.jsx
import React, { useRef, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import FloatingButtons from "../components/FloatingButtons.jsx";
import timeGridPlugin from "@fullcalendar/timegrid";
import "../styles/calendar.css"; // 기존 감성 스타일 CSS 연결

function CalendarPage() {
  const calendarRef = useRef(null);
  useEffect(() => {
    const calendarApi = calendarRef.current?.getApi();
  }, []);

  return (
    <div className="calendar-page">
      <h1 className="calendar-title">나만의 시간표 캘린더</h1>

      {/* 캘린더 */}
      <div className="calendar-container">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            start: "prev,next today",
            center: "title",
            end: "dayGridMonth,timeGridDay,timeGridWeek"
          }}
          events={[]}
          height="100%"
          contentHeight="auto"
          expandRows={true}
          dayHeaderContent={(args) => {
            const weekday = args.date.toLocaleDateString("en-US", { weekday: "short" });
            return <span>{weekday}</span>;
          }}
        />
      </div>

      {/* 플로팅 버튼 (오른쪽 하단) */}
      <FloatingButtons />
    </div>
  );
}

export default CalendarPage;
