// /routes/CalendarPage.jsx
import React from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import "../styles/calendar.css"; // 기존 감성 스타일 CSS 연결
import FloatingButtons from "../components/FloatingButtons.jsx";
import timeGridPlugin from "@fullcalendar/timegrid";


function CalendarPage() {
  return (
    <div className="calendar-page">
      {/* 상단 로고 & 월 표시 */}
      <header className="custom-header">
        <div className="logo">shedAI</div>
        <div className="month-title">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin]}
            initialView="dayGridMonth"
            headerToolbar={{
              start: "prev,next today",   
              center: "title",           
              end: "dayGridMonth,timeGridWeek,timeGridDay" 
            }}
            events={[]}
             height="auto"
            dayHeaderContent={(args) => {
              const weekday = args.date.toLocaleDateString("en-US", { weekday: "short" });
              return <span>{weekday}</span>;
            }}
          />
        </div>
      </header>

      {/* 플로팅 버튼 (오른쪽 하단) */}
      <FloatingButtons />
    </div>
  );
}

export default CalendarPage;
