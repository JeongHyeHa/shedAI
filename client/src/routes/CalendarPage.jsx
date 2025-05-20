// /routes/CalendarPage.jsx
import React, { useRef, useState, useCallback } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import FloatingButtons from "../components/FloatingButtons.jsx";
import "../styles/calendar.css"; 
import "../styles/modal.css"; 
import {buildShedAIPrompt, buildFeedbackPrompt, convertScheduleToEvents, resetToStartOfDay} from "../utils/scheduleUtils";

function CalendarPage() {
  const calendarRef = useRef(null);
  const today = resetToStartOfDay(new Date());

  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showLifestyleModal, setShowLifestyleModal] = useState(false);
  
  const [taskText, setTaskText] = useState("");
  const [lifestyleInput, setLifestyleInput] = useState("");
  const [lifestyleList, setLifestyleList] = useState([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [lastSchedule, setLastSchedule] = useState(
    JSON.parse(localStorage.getItem("lastSchedule")) || null
  );

  const handleAddLifestyle = () => {
    if (!lifestyleInput.trim()) return;
    const updatedList = [...lifestyleList, lifestyleInput.trim()];
    setLifestyleList(updatedList);
    setLifestyleInput("");
    localStorage.setItem("lifestyleList", JSON.stringify(updatedList));
  };

  const handleDeleteLifestyle = (index) => {
    const updatedList = lifestyleList.filter((_, i) => i !== index);
    setLifestyleList(updatedList);
    localStorage.setItem("lifestyleList", JSON.stringify(updatedList));
  };

  const handleGenerateSchedule = useCallback(async (isNew = true) => {
    if (!taskText.trim()) {
      alert("할 일을 입력해주세요!");
      return;
    }
    
    if (lifestyleList.length === 0 ) {
      alert("생활 패턴을 입력해주세요!");
      return;
    }

    const lifestyleText = lifestyleList.join("\n");
    const prompt = isNew
      ? buildShedAIPrompt(lifestyleText, taskText, today)
      : buildFeedbackPrompt(lifestyleText, taskText, lastSchedule);

    setStatusMessage("스케줄을 설계합니다...");

    try {
      const response = await fetch("http://localhost:3001/api/generate-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });      

      const newSchedule = await response.json();
      setLastSchedule(newSchedule.schedule);
      localStorage.setItem("lastSchedule", JSON.stringify(newSchedule.schedule));

      const events = convertScheduleToEvents(newSchedule.schedule, today);
      const calendarApi = calendarRef.current?.getApi();
      calendarApi.removeAllEvents();
      calendarApi.addEventSource(events);

      setStatusMessage(
        typeof newSchedule.notes === "string"
          ? newSchedule.notes.replace(/\n/g, "<br>")
          : (newSchedule.notes || []).join("<br>")
      );

      setTaskText("");
    } catch (e) {
      console.error("스케줄 생성 실패", e);
      setStatusMessage("출력에 실패했습니다.");
    }
  }, [taskText, lifestyleList, lastSchedule]);

  React.useEffect(() => {
    const savedLifestyle = JSON.parse(localStorage.getItem("lifestyleList"));
    if (savedLifestyle) setLifestyleList(savedLifestyle);
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
          initialDate={today}
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
      <FloatingButtons
        onClickPlus={() => setShowTaskModal(true)}
        onClickPencil={() => setShowLifestyleModal(true)}
      />

      <div className="status-message" dangerouslySetInnerHTML={{ __html: statusMessage }} />

      {showTaskModal && (
        <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>할 일 / 피드백 입력</h2>
            <textarea
              value={taskText}
              onChange={(e) => setTaskText(e.target.value)}
              placeholder="오늘 할 일이나 피드백을 입력하세요"
            />
            <div className="modal-buttons">
              <button onClick={() => handleGenerateSchedule(true)}>🆕 새로 생성</button>
              <button onClick={() => handleGenerateSchedule(false)}>🔁 업데이트</button>
            </div>
            <button className="close-btn" onClick={() => setShowTaskModal(false)}>닫기</button>
          </div>
        </div>
      )}

      {showLifestyleModal && (
        <div className="modal-overlay" onClick={() => setShowLifestyleModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>생활 패턴 입력</h2>
            <div className="lifestyle-grid">
              {lifestyleList.map((item, index) => (
                <div key={index} className="lifestyle-item">
                  {item}
                  <button onClick={() => handleDeleteLifestyle(index)}>삭제</button>
                </div>
              ))}
            </div>
            <input
              value={lifestyleInput}
              onChange={(e) => setLifestyleInput(e.target.value)}
              placeholder="예: 00시~08시 수면"
            />
            <button onClick={handleAddLifestyle}>추가</button>
            <button className="close-btn" onClick={() => setShowLifestyleModal(false)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CalendarPage;
