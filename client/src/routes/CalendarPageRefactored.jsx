// 앱의 메인 페이지
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Calendar from '../components/Calendar/Calendar';
import CalendarHeader from '../components/Calendar/CalendarHeader';
import Modals from '../components/Modals/Modals';
import CalendarControls from '../components/Calendar/CalendarControls';

// 커스텀 훅들
import { useScheduleManagement } from '../hooks/useScheduleManagement';
import { useImageProcessing } from '../hooks/useImageProcessing';
import { useVoiceRecording } from '../hooks/useVoiceRecording';
import { useMessageManagement } from '../hooks/useMessageManagement';
import { useLifestyleSync } from '../hooks/useLifestyleSync';
import { usePersonalizedAI } from '../hooks/usePersonalizedAI';
import { useAuth } from '../contexts/AuthContext';

// 서비스 & 유틸리티
import apiService from '../services/apiService';
import firestoreService from '../services/firestoreService';
import { UI_CONSTANTS } from '../constants/ui';
import { 
  buildShedAIPrompt,
  buildFeedbackPrompt,
  convertScheduleToEvents
} from '../utils/scheduleUtils';
import { 
  resetToStartOfDay,
  parseDateString,
  convertToRelativeDay
} from '../utils/dateUtils';
import '../styles/calendar.css';
import '../styles/floating.css';

function CalendarPage() {
  const calendarRef = useRef(null);
  const today = resetToStartOfDay(new Date());
  
  // 인증 및 Firebase 훅
  const { user } = useAuth();
  const { userInsights, generatePersonalizedSchedule } = usePersonalizedAI();
  
  // 상태 관리
  const [lifestyleList, setLifestyleList] = useState([]);
  const [lastSchedule, setLastSchedule] = useState(null);
  const [loading, setLoading] = useState(false);

  // 사용자 데이터 로드
  useEffect(() => {
    const loadUserData = async () => {
      if (!user?.uid) return;
      
      try {
        setLoading(true);
               const userData = await firestoreService.getUserDataForAI(user.uid, user);
        
        if (userData) {
          setLifestyleList(userData.lifestylePatterns || []);
          setLastSchedule(userData.lastSchedule);
        }
      } catch (error) {
        console.error('사용자 데이터 로드 실패:', error);
      } finally {
        setLoading(false);
      }
    };

    loadUserData();
  }, [user?.uid]);
  
  // 커스텀 훅들
  const { 
    allEvents, 
    setAllEvents, 
    isLoading, 
    setIsLoading, 
    loadingProgress, 
    generateSchedule 
  } = useScheduleManagement();
  const { isConverting, convertImageToText } = useImageProcessing();
  const { isRecording, startVoiceRecording } = useVoiceRecording();
  const { 
    messages, 
    conversationContext, 
    attachments, 
    setAttachments, 
    currentMessage, 
    setCurrentMessage, 
    addAIMessage, 
    addUserMessage, 
    removeAttachment, 
    clearMessages 
  } = useMessageManagement();
  
  // UI 상태 관리
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showLifestyleModal, setShowLifestyleModal] = useState(false);
  const [lifestyleInput, setLifestyleInput] = useState("");
  const [currentScheduleSessionId, setCurrentScheduleSessionId] = useState(null);
  const [chatbotMode, setChatbotMode] = useState(UI_CONSTANTS.CHATBOT_MODES.TASK);
  const [taskInputMode, setTaskInputMode] = useState(UI_CONSTANTS.TASK_INPUT_MODES.CHATBOT);
  
  // 할 일 입력 폼 상태
  const [taskForm, setTaskForm] = useState({
    title: "",
    deadline: "",
    importance: "",
    difficulty: "",
    description: ""
  });

  // 스케줄 생성 콜백
  const handleScheduleGeneration = useCallback(async (prompt, message) => {
    addAIMessage(message);
    
    try {
      const result = await generateSchedule(
        prompt,
        {
          conversationContext: conversationContext.slice(-12),
          lifestylePatterns: lifestyleList
        },
        today
      );
      
      setLastSchedule(result.schedule);
      
      if (result.scheduleSessionId) {
        setCurrentScheduleSessionId(result.scheduleSessionId);
      }
      
      // 이벤트는 Calendar 컴포넌트에서 자동으로 처리됨
      addAIMessage("스케줄이 생성되었습니다!");
    } catch (error) {
      addAIMessage("스케줄 생성에 실패했습니다. 다시 시도해주세요.");
    }
  }, [generateSchedule, conversationContext, lifestyleList, today, addAIMessage]);

  // 생활패턴 동기화
  useLifestyleSync(
    lifestyleList, 
    lastSchedule, 
    today, 
    user?.uid, 
    handleScheduleGeneration
  );

  // 생활패턴 관리 함수들
  const handleAddLifestyle = useCallback(async () => {
    if (!lifestyleInput.trim() || !user?.uid) return;
    
    const newPatterns = lifestyleInput.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const updatedPatterns = [...lifestyleList, ...newPatterns];
    
    try {
      // Firebase에 저장
      await firestoreService.saveLifestylePatterns(user.uid, updatedPatterns);
      setLifestyleList(updatedPatterns);
      setLifestyleInput("");
    } catch (error) {
      console.error('생활패턴 저장 실패:', error);
    }
  }, [lifestyleInput, lifestyleList, user?.uid]);

  const handleDeleteLifestyle = useCallback(async (index) => {
    if (!user?.uid) return;
    
    const updatedPatterns = lifestyleList.filter((_, i) => i !== index);
    
    try {
      await firestoreService.saveLifestylePatterns(user.uid, updatedPatterns);
      setLifestyleList(updatedPatterns);
    } catch (error) {
      console.error('생활패턴 삭제 실패:', error);
    }
  }, [lifestyleList, user?.uid]);

  const handleClearAllLifestyles = useCallback(async () => {
    if (!user?.uid) return;
    
    if (window.confirm("모든 생활 패턴을 삭제하시겠습니까?")) {
      try {
        await firestoreService.saveLifestylePatterns(user.uid, []);
        setLifestyleList([]);
      } catch (error) {
        console.error('생활패턴 전체 삭제 실패:', error);
      }
    }
  }, [user?.uid]);

  // 폼 입력값 변경 핸들러
  const handleTaskFormChange = (e) => {
    const { id, value } = e.target;
    setTaskForm({
      ...taskForm,
      [id.replace('task-', '')]: value
    });
  };

  // 중요도, 난이도 버튼 선택 핸들러
  const handleLevelSelect = (field, value) => {
    setTaskForm({
      ...taskForm,
      [field]: value
    });
  };

  // 할 일 추가 폼 제출 핸들러
  const handleTaskFormSubmit = () => {
    if (!taskForm.title || !taskForm.deadline) {
      alert('제목과 마감일은 필수 입력 항목입니다.');
      return;
    }

    const deadlineDate = new Date(taskForm.deadline);
    const relativeDay = convertToRelativeDay(deadlineDate, today);
    
    const formattedMessage = `${taskForm.title} (${taskForm.importance}중요도, ${taskForm.difficulty}난이도, 마감일: ${taskForm.deadline} day:${relativeDay})${taskForm.description ? '\n' + taskForm.description : ''}`;
    
    addUserMessage(formattedMessage, []);
    handleProcessMessageWithAI(formattedMessage);
    
    setTaskForm({
      title: "",
      deadline: "",
      importance: "",
      difficulty: "",
      description: ""
    });
    
    setShowTaskModal(false);
  };

  // 메시지 제출 핸들러
  const handleSubmitMessage = () => {
    if (currentMessage.trim() === "" && attachments.length === 0) return;
    if (isLoading) return;

    addUserMessage(currentMessage, [...attachments]);
    setAttachments([]);
    
    if (chatbotMode === "feedback") {
      handleSubmitFeedbackMessage(currentMessage);
    } else {
      handleProcessMessageWithAI(currentMessage);
    }
    
    setCurrentMessage("");
  };

  // 피드백 메시지 처리
  const handleSubmitFeedbackMessage = async (messageText) => {
    if (!currentScheduleSessionId) {
      addAIMessage("먼저 스케줄을 생성해주세요. 피드백을 남길 스케줄이 없습니다.");
      return;
    }

    try {
      setIsLoading(true);
      setShowTaskModal(false);
      setShowLifestyleModal(false);
      addAIMessage("피드백을 분석하고 스케줄을 조정하는 중입니다...");

      const result = await apiService.saveFeedback(
        sessionIdRef.current,
        currentScheduleSessionId,
        messageText.trim()
      );
      
      if (result.success) {
        if (result.analysis) {
          addAIMessage(`📊 피드백 분석: ${result.analysis}`);
        }
        
        if (result.advice && result.advice.length > 0) {
          const adviceText = result.advice.map(item => 
            `💡 ${item.title || '조언'}: ${item.content}`
          ).join('\n');
          addAIMessage(adviceText);
        }
        
        addAIMessage("피드백을 반영하여 스케줄을 조정합니다...");
        
        const lifestyleText = lifestyleList.join("\n");
        const feedbackPrompt = buildFeedbackPrompt(lifestyleText, messageText, lastSchedule);
        
        await handleScheduleGeneration(feedbackPrompt, "피드백을 반영하여 스케줄을 조정합니다...");
      }
    } catch (error) {
      console.error("피드백 제출 실패:", error);
      addAIMessage("피드백 처리에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  };
  
  // 메시지를 AI로 처리하는 함수
  const handleProcessMessageWithAI = async (messageText) => {
    const preprocessMessage = (text) => {
      const patterns = [
        /이번\s*주\s*(월|화|수|목|금|토|일)요일/g,
        /다음\s*주\s*(월|화|수|목|금|토|일)요일/g,
        /(\d{1,2})월\s*(\d{1,2})일/g,
        /(\d+)일\s*(후|뒤)/g,
        /(\d+)주\s*(후|뒤)/g,
        /다음\s*(월|화|수|목|금|토|일)요일/g,
        /오는\s*(월|화|수|목|금|토|일)요일/g,
        /이번\s*(월|화|수|목|금|토|일)요일/g,
        /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g
      ];
    
      let processed = text;
    
      for (const pattern of patterns) {
        processed = processed.replaceAll(pattern, (match) => {
          const parsed = parseDateString(match, today);
          if (!parsed) return match;
    
          const day = convertToRelativeDay(parsed, today);
          return `${match} (day:${day})`;
        });
      }
    
      return processed;
    };
    
    const processedMessage = preprocessMessage(messageText);
    
    setIsLoading(true);
    setShowTaskModal(false);
    setShowLifestyleModal(false);
    addAIMessage("스케줄을 생성하는 중입니다...");
    
    const lifestyleText = lifestyleList.join("\n");
    const prompt = lastSchedule 
      ? buildFeedbackPrompt(lifestyleText, processedMessage, lastSchedule)
      : buildShedAIPrompt(lifestyleText, processedMessage, today);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      
      const newSchedule = await apiService.generateSchedule(
        prompt,
        conversationContext.slice(-12),
        sessionIdRef.current
      );
      
      clearTimeout(timeoutId);

      setLastSchedule(newSchedule.schedule);

      if (newSchedule.scheduleSessionId) {
        setCurrentScheduleSessionId(newSchedule.scheduleSessionId);
      }

      const events = convertScheduleToEvents(newSchedule.schedule, today).map(event => ({
        ...event,
        extendedProps: {
          ...event.extendedProps,
          isDone: false,
        }
      }));

      setAllEvents(events);
      // 이벤트는 Calendar 컴포넌트에서 자동으로 처리됨

      const calendarApi = calendarRef.current?.getApi();
      if (calendarApi) {
        const currentView = calendarApi.view.type;
        calendarApi.changeView(currentView);
      }

      const aiResponse = typeof newSchedule.notes === "string"
        ? newSchedule.notes.replace(/\n/g, "<br>")
        : (newSchedule.notes || []).join("<br>");
      
      addAIMessage("스케줄을 생성했습니다!");
      addAIMessage(aiResponse);
    } catch (e) {
      addAIMessage("요청 실패: 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  };

  // 캘린더 초기화 함수
  const handleResetCalendar = () => {
    if (window.confirm("모든 일정을 초기화하시겠습니까?")) {
      resetSession();
      setLastSchedule(null);
      setAllEvents([]);
      calendarRef.current?.getApi().removeAllEvents();
      clearMessages();
      setCurrentScheduleSessionId(null);
      addAIMessage("캘린더가 초기화되었습니다. 새로운 일정을 추가해주세요.");
    }
  };

  // AI 조언 조회
  const fetchAIAdvice = async () => {
    try {
      const result = await apiService.getAdvice(sessionIdRef.current);
      
      if (result.advice && result.advice.length > 0) {
        const adviceText = result.advice.map(item => 
          `💡 ${item.title || '조언'}: ${item.content}`
        ).join('\n');
        addAIMessage(adviceText);
      } else {
        addAIMessage("현재 제공할 AI 조언이 없습니다.");
      }
    } catch (error) {
      console.error("AI 조언 조회 실패:", error);
      addAIMessage("AI 조언을 불러오는데 실패했습니다.");
    }
  };

  // 이미지 업로드 핸들러
  const handleImageUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const newAttachment = {
        type: 'image',
        data: e.target.result,
        file: file
      };
      setAttachments(prev => [...prev, newAttachment]);
    };
    reader.readAsDataURL(file);

    try {
      const text = await convertImageToText(file);
      if (text) {
        setCurrentMessage(text);
      }
    } catch (error) {
      console.error('이미지 OCR 실패:', error);
    }

    event.target.value = null;
  };

  // 음성 녹음 핸들러
  const handleVoiceRecording = async () => {
    try {
      const text = await startVoiceRecording();
      setCurrentMessage(text);
    } catch (error) {
      console.error('음성 녹음 실패:', error);
    }
  };

  // 캘린더 이벤트 핸들러들
  const handleEventMount = (info) => {
    if (info.event.extendedProps?.type === "lifestyle") {
      const viewType = calendarRef.current?.getApi().view.type;
      
      if (viewType === "dayGridMonth") {
        // 월간 뷰에서 lifestyle 이벤트 숨김
        info.el.style.display = "none";
      } else {
        // 주간/일간 뷰에서 lifestyle 이벤트 스타일링
        info.el.style.backgroundColor = "#CFCFCF";
        info.el.style.borderColor = "#AAAAAA";
        info.el.style.color = "#333333";
        info.el.style.fontWeight = "normal";
      }
    }
  };

  const handleViewDidMount = (arg) => {
    // 이벤트는 Calendar 컴포넌트에서 자동으로 처리됨
  };

  const handleDatesSet = (arg) => {
    // 이벤트는 Calendar 컴포넌트에서 자동으로 처리됨
  };

  const handleDayHeaderContent = (args) => {
    const weekday = args.date.toLocaleDateString("en-US", { weekday: "short" });
    const span = document.createElement("span");
    span.textContent = weekday;
    return { domNodes: [span] };
  };

  const handleEventContent = (arg) => {
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

    if (viewType !== "dayGridMonth" && arg.event.extendedProps?.type === "task") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isDone ?? false;
      checkbox.style.marginRight = "5px";
      checkbox.addEventListener("change", () => {
        arg.event.setExtendedProp("isDone", checkbox.checked);    
        setAllEvents(prevEvents => {
          return prevEvents.map(event => {
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
  };

  return (
    <div className="calendar-page">
      <CalendarHeader isLoading={isLoading} loadingProgress={loadingProgress} />
      
      <Calendar
        ref={calendarRef}
        events={allEvents}
        onEventMount={handleEventMount}
        onViewDidMount={handleViewDidMount}
        onDatesSet={handleDatesSet}
        onDayHeaderContent={handleDayHeaderContent}
        onEventContent={handleEventContent}
      />

      <CalendarControls
        onPlusClick={() => {
          setTaskInputMode(UI_CONSTANTS.TASK_INPUT_MODES.CHATBOT);
          setShowTaskModal(true);
        }}
        onPencilClick={() => setShowLifestyleModal(true)}
        onAdviceClick={fetchAIAdvice}
        onReportClick={() => window.location.href = '/report'}
        onResetClick={handleResetCalendar}
      />

      <Modals
        // Task Modal Props
        showTaskModal={showTaskModal}
        setShowTaskModal={setShowTaskModal}
        taskInputMode={taskInputMode}
        setTaskInputMode={setTaskInputMode}
        messages={messages}
        currentMessage={currentMessage}
        setCurrentMessage={setCurrentMessage}
        attachments={attachments}
        onRemoveAttachment={removeAttachment}
        onSubmitMessage={handleSubmitMessage}
        onImageUpload={handleImageUpload}
        onVoiceRecording={handleVoiceRecording}
        isRecording={isRecording}
        isConverting={isConverting}
        isLoading={isLoading}
        chatbotMode={chatbotMode}
        onModeChange={setChatbotMode}
        
        // Task Form Props
        taskForm={taskForm}
        onTaskFormChange={handleTaskFormChange}
        onLevelSelect={handleLevelSelect}
        onTaskFormSubmit={handleTaskFormSubmit}
        
        // Lifestyle Modal Props
        showLifestyleModal={showLifestyleModal}
        setShowLifestyleModal={setShowLifestyleModal}
        lifestyleList={lifestyleList}
        lifestyleInput={lifestyleInput}
        setLifestyleInput={setLifestyleInput}
        onAddLifestyle={handleAddLifestyle}
        onDeleteLifestyle={handleDeleteLifestyle}
        onClearAllLifestyles={handleClearAllLifestyles}
      />
    </div>
  );
}

export default CalendarPage;