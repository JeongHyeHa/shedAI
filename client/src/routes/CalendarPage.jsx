// /routes/CalendarPage.jsx
import React, { useRef, useState, useCallback, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import FloatingButtons from "../components/FloatingButtons.jsx";
import "../styles/calendar.css"; 
import "../styles/modal.css"; 
import "../styles/fullcalendar-custom.css";
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
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [allEvents, setAllEvents] = useState([]);
  const [lastSchedule, setLastSchedule] = useState(
    JSON.parse(localStorage.getItem("lastSchedule")) || null
  );

  // 로딩 시 진행 효과를 위한 타이머
  useEffect(() => {
    let timer;
    if (isLoading) {
      setLoadingProgress(1);  // 1부터 시작 
      timer = setInterval(() => {
        setLoadingProgress((prev) => (prev < 90 ? prev + 1 : prev));
      }, 300);
    } else {
      setLoadingProgress(100); // 로딩 완료 시
    }
    return () => timer && clearInterval(timer);
  }, [isLoading]);

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

  // 캘린더에 이벤트 적용하는 함수
  const applyEventsToCalendar = (events) => {
    const calendarApi = calendarRef.current?.getApi();
    if (!calendarApi) return;
    
    const viewType = calendarApi.view.type;
    const filtered = viewType === "dayGridMonth"
            ? events.filter(e => e.extendedProps.type !== "lifestyle")
            : events;
    
    calendarApi.removeAllEvents();
    calendarApi.addEventSource(filtered);
  };

  {/* AI에게 스케줄 생성 요청 */}
  const handleGenerateSchedule = useCallback(async (isNew = true) => {
    if (!taskText.trim()) return alert("할 일을 입력해주세요!");
    if (lifestyleList.length === 0) return alert("생활 패턴을 입력해주세요!");

    setIsLoading(true);
    setShowTaskModal(false);
    setStatusMessage("스케줄을 설계하는 중입니다...");

    const lifestyleText = lifestyleList.join("\n");
    const prompt = isNew  
      ? buildShedAIPrompt(lifestyleText, taskText, today)
      : buildFeedbackPrompt(lifestyleText, taskText, lastSchedule);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);  // 60초 타임아웃
      const response = await fetch("http://localhost:3001/api/generate-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      // 스케줄 생성 결과 Json 형식으로 받아옴 -> localstorage에 저장 
      const newSchedule = await response.json();
      setLastSchedule(newSchedule.schedule);
      localStorage.setItem("lastSchedule", JSON.stringify(newSchedule.schedule));

      // 이벤트 객체 생성 
      const events = convertScheduleToEvents(newSchedule.schedule, today).map(event => ({
        ...event,
        backgroundColor:
        event.extendedProps?.type === "lifestyle" ? "#CFCFCF" : undefined,
        extendedProps: {
          ...event.extendedProps,
          isDone: false,
          type: event.extendedProps?.type || "task"
        }
      }));

      // 모든 이벤트 상태 저장
      setAllEvents(events);
      
      // 캘린더에 이벤트 적용
      applyEventsToCalendar(events);

      setStatusMessage(
        typeof newSchedule.notes === "string"
          ? newSchedule.notes.replace(/\n/g, "<br>")
          : (newSchedule.notes || []).join("<br>")
      );
      setTaskText("");
    } catch (e) {
      setStatusMessage("요청 실패: 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  }, [taskText, lifestyleList, lastSchedule, today]);

  // 초기 로딩 시 생활 패턴 불러오기 및 마지막 스케줄 적용
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("lifestyleList"));
    if (saved) setLifestyleList(saved);
    
    // 마지막 스케줄이 있다면 이벤트로 변환
    if (lastSchedule) {
      const events = convertScheduleToEvents(lastSchedule, today).map(event => ({
        ...event,
        extendedProps: {
          ...event.extendedProps,
          isDone: false,
          type: event.extendedProps?.type || "task"
        }
      }));

      // 모든 이벤트 상태 저장
      setAllEvents(events);

      // 약간의 지연 후 이벤트 추가 (캘린더가 완전히 초기화된 후)
      setTimeout(() => {
        applyEventsToCalendar(events);
      }, 100);
    }
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
            end: "dayGridMonth,timeGridWeek,timeGridDay"
          }}
          events={[]}
          height="100%"
          contentHeight="auto"
          dayMaxEventRows={3} 
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          datesSet={(arg) => {
            // 뷰 변경 시 이벤트 필터링하여 다시 적용
            applyEventsToCalendar(allEvents);
          }}
          dayHeaderContent={(args) => {
            const weekday = args.date.toLocaleDateString("en-US", { weekday: "short" });
            return <span>{weekday}</span>;
          }}
          eventContent={(arg) => {
            const viewType = calendarRef.current?.getApi().view.type;
            const { isDone } = arg.event.extendedProps || {};
            const titleText = arg.event.title;

            const span = document.createElement("span");
            span.textContent = titleText;
            span.title = titleText;
            if (isDone) span.style.textDecoration = "line-through";

            if (viewType === "dayGridMonth") {
              return { domNodes: [span] };
            }

            // 일간/주간 뷰에서 task 이벤트 (체크박스 포함)
            if (viewType !== "dayGridMonth" && arg.event.extendedProps?.type === "task") {
              const checkbox = document.createElement("input");
              checkbox.type = "checkbox";
              checkbox.checked = !!isDone;
              checkbox.style.marginRight = "5px";
              checkbox.addEventListener("change", () => {
                // 현재 표시되는 이벤트의 속성 변경
                arg.event.setExtendedProp("isDone", checkbox.checked);    
                // allEvents 상태도 업데이트하여 뷰 간 동기화
                setAllEvents(prevEvents => {
                  return prevEvents.map(event => {
                    // 시작/종료 시간과 제목으로 동일한 이벤트 찾기
                    if (event.title === arg.event.title && 
                        new Date(event.start).getTime() === new Date(arg.event.start).getTime() &&
                        new Date(event.end).getTime() === new Date(arg.event.end).getTime()) {
                      return {
                        ...event,
                        extendedProps: {
                          ...event.extendedProps,
                          isDone: checkbox.checked
                        }
                      };
                    }
                    return event;
                  });
                });
              });

              const container = document.createElement("div");
              container.appendChild(checkbox);
              container.appendChild(span);
              return { domNodes: [container] };
            }
            
            return {domNodes:[span]}
          }}
        />
      </div>

      {/* 플로팅 버튼 (오른쪽 하단) */}
      <FloatingButtons
        onClickPlus={() => setShowTaskModal(true)}
        onClickPencil={() => setShowLifestyleModal(true)}
      />

      {/* 로딩 프로그레스 바 */}
      {isLoading && (
        <div className="loading-container">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${loadingProgress}%` }} />
          </div>
          <p className="loading-text">AI가 스케줄을 생성하고 있습니다... {loadingProgress}%</p>
        </div>
      )}

      <div className="status-message" dangerouslySetInnerHTML={{ __html: statusMessage }} />
      
      {/* 할 일 / 피드백 입력 모달 */}
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
              <button onClick={() => handleGenerateSchedule(true)} disabled={isLoading}>
                {isLoading ? "처리 중..." : "새로 생성"}
              </button>
              <button onClick={() => handleGenerateSchedule(false)} disabled={isLoading} >
                {isLoading ? "처리 중..." : "업데이트"}
              </button>
            </div>
            <button className="close-btn" onClick={() => setShowTaskModal(false)}>닫기</button>
          </div>
        </div>
      )}

      {/* 생활 패턴 입력 모달 */}
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
