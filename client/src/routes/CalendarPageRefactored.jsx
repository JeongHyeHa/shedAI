import React, { useState, useEffect, useCallback, useRef } from 'react';
import Calendar from '../components/Calendar/Calendar';
import Chatbot from '../components/Chatbot/Chatbot';
import TaskFormModal from '../components/Modals/TaskFormModal';
import LifestyleModal from '../components/Modals/LifestyleModal';
import LoadingSpinner from '../components/UI/LoadingSpinner';
import FloatingButtons from '../components/UI/FloatingButtons';
import { useSession } from '../hooks/useSession';
import { useLocalStorage } from '../hooks/useLocalStorage';
import apiService from '../services/apiService';
import { 
  buildShedAIPrompt, 
  buildFeedbackPrompt, 
  convertScheduleToEvents, 
  resetToStartOfDay, 
  parseDateString, 
  convertToRelativeDay 
} from '../utils/scheduleUtils';
import { UI_CONSTANTS, STORAGE_KEYS } from '../constants/ui';
import '../styles/calendar.css';
import '../styles/floating.css';

function CalendarPage() {
  const calendarRef = useRef(null);
  const today = resetToStartOfDay(new Date());
  
  // 세션 관리
  const { sessionIdRef, initializeSession, resetSession } = useSession();
  
  // 로컬 스토리지 훅
  const [lifestyleList, setLifestyleList] = useLocalStorage(STORAGE_KEYS.LIFESTYLE_LIST, []);
  const [lastSchedule, setLastSchedule] = useLocalStorage(STORAGE_KEYS.LAST_SCHEDULE, null);
  const [messages, setMessages] = useLocalStorage(STORAGE_KEYS.CHAT_MESSAGES, []);
  const [conversationContext, setConversationContext] = useLocalStorage(STORAGE_KEYS.CHAT_CONTEXT, []);
  
  // 상태 관리
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showLifestyleModal, setShowLifestyleModal] = useState(false);
  const [lifestyleInput, setLifestyleInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [allEvents, setAllEvents] = useState([]);
  const [isConverting, setIsConverting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [currentMessage, setCurrentMessage] = useState("");
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

  const isFirstMount = useRef(true);

  // 세션 초기화
  useEffect(() => {
    initializeSession();
  }, [initializeSession]);

  // 초기 데이터 로드
  useEffect(() => {
    try {
      const savedSchedule = localStorage.getItem(STORAGE_KEYS.LAST_SCHEDULE);
      if (savedSchedule) {
        const parsedSchedule = JSON.parse(savedSchedule);
        setLastSchedule(parsedSchedule);
        const events = convertScheduleToEvents(parsedSchedule, today).map(event => ({
          ...event,
          extendedProps: {
            ...event.extendedProps,
            isDone: false,
            type: event.extendedProps?.type || "task"
          }
        }));
        setAllEvents(events);
        setTimeout(() => applyEventsToCalendar(events), 100);
      }
    } catch (error) {
      console.error("Error parsing lastSchedule from localStorage:", error);
    }
    
    const savedSessionId = localStorage.getItem(STORAGE_KEYS.LAST_SCHEDULE_SESSION_ID);
    if (savedSessionId) setCurrentScheduleSessionId(savedSessionId);
  }, []);

  // 로딩 프로그레스 관리
  useEffect(() => {
    let timer;
    if (isLoading) {
      setLoadingProgress(0);
      setTimeout(() => setLoadingProgress(1), 50);
      timer = setInterval(() => {
        setLoadingProgress((prev) => (prev < 90 ? prev + 1 : prev));
      }, 300);
    } else if (loadingProgress > 0 && loadingProgress < 100) {
      setLoadingProgress(100);
    }
    return () => timer && clearInterval(timer);
  }, [isLoading]);

  // 생활패턴 변경 시 서버 동기화 및 스케줄 재생성
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    
    // 서버 동기화
    (async () => {
      try {
        await apiService.saveLifestylePatterns(sessionIdRef.current, lifestyleList);
      } catch (error) {
        console.error("생활 패턴 저장 오류:", error);
      }
    })();
    
    // 스케줄 자동 생성
    if (lifestyleList.length === 0) return;
    const lifestyleText = lifestyleList.join("\n");
    const prompt = lastSchedule
      ? buildFeedbackPrompt(lifestyleText, "", lastSchedule)
      : buildShedAIPrompt(lifestyleText, "", today);
    
    (async () => {
      setIsLoading(true);
      setShowTaskModal(false);
      setShowLifestyleModal(false);
      addAIMessage("생활패턴이 변경되어 스케줄을 다시 생성합니다...");
      
      try {
        const newSchedule = await apiService.generateSchedule(
          prompt,
          conversationContext.slice(-12),
          sessionIdRef.current
        );
        
        setLastSchedule(newSchedule.schedule);
        localStorage.setItem(STORAGE_KEYS.LAST_SCHEDULE, JSON.stringify(newSchedule.schedule));
        
        if (newSchedule.scheduleSessionId) {
          setCurrentScheduleSessionId(newSchedule.scheduleSessionId);
          localStorage.setItem(STORAGE_KEYS.LAST_SCHEDULE_SESSION_ID, newSchedule.scheduleSessionId);
        }
        
        const events = convertScheduleToEvents(newSchedule.schedule, today).map(event => ({
          ...event,
          extendedProps: {
            ...event.extendedProps,
            isDone: false,
          }
        }));
        
        setAllEvents(events);
        applyEventsToCalendar(events);
        addAIMessage("생활패턴 변경에 따라 스케줄이 새로 생성되었습니다.");
      } catch (e) {
        addAIMessage("스케줄 자동 생성 실패: 다시 시도해주세요.");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [lifestyleList]);

  // 캘린더에 이벤트 적용
  const applyEventsToCalendar = (events) => {
    const calendarApi = calendarRef.current?.getApi();
    if (!calendarApi) return;
    
    calendarApi.removeAllEvents();
    const viewType = calendarApi.view.type;
    
    const processedEvents = events.map(event => {
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

  // AI 메시지 추가
  const addAIMessage = (text) => {
    const newMessage = {
      type: 'ai',
      text,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
    setConversationContext(prev => [
      ...prev,
      { role: 'assistant', content: text }
    ]);
  };
  
  // 사용자 메시지 추가
  const addUserMessage = (text, userAttachments = []) => {
    const newMessage = {
      type: 'user',
      text,
      attachments: [...userAttachments],
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
    setAttachments([]);
    setCurrentMessage('');
    setConversationContext(prev => [
      ...prev,
      { role: 'user', content: text }
    ]);
  };

  // 이미지 압축 함수
  const compressImage = (file, maxWidth = 1920, quality = 0.8) => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  // 이미지를 Base64로 변환
  const convertImageToBase64 = async (file) => {
    try {
      const maxSize = 20 * 1024 * 1024; // 20MB
      
      if (file.size > maxSize) {
        console.log('이미지가 너무 커서 압축합니다...');
        const compressedImage = await compressImage(file, 2560, 0.8);
        const base64Data = compressedImage.split(',')[1];
        const sizeInBytes = (base64Data.length * 3) / 4;
        
        if (sizeInBytes > maxSize) {
          console.log('여전히 크므로 더 강하게 압축합니다...');
          const moreCompressedImage = await compressImage(file, 1920, 0.6);
          const moreCompressedData = moreCompressedImage.split(',')[1];
          const moreCompressedSize = (moreCompressedData.length * 3) / 4;
          
          if (moreCompressedSize > maxSize) {
            throw new Error('이미지 파일이 너무 큽니다. 더 작은 이미지를 선택해주세요.');
          }
          
          return moreCompressedImage;
        }
        
        return compressedImage;
      } else {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
    } catch (error) {
      throw new Error(`이미지 처리 실패: ${error.message}`);
    }
  };

  // GPT-4o를 사용한 이미지 처리
  const convertImageToText = async (imageFile) => {
    try {
      setIsConverting(true);
      console.log('GPT-4o 이미지 처리 시작...');
      
      const base64Image = await convertImageToBase64(imageFile);
      console.log('Base64 변환 완료, 크기:', Math.round(base64Image.length / 1024), 'KB');
      
      const result = await apiService.processImage(
        base64Image,
        "이 이미지에서 시간표나 일정 정보를 텍스트로 추출해주세요. 요일, 시간, 과목명 등을 정확히 인식하여 정리해주세요."
      );
      
      console.log('GPT-4o 이미지 처리 결과:', result.text);
      return result.text;
    } catch (error) {
      console.error('GPT-4o 이미지 처리 실패:', error);
      let errorMessage = '이미지 처리에 실패했습니다.';
      if (error.message.includes('너무 큽니다')) {
        errorMessage = error.message;
      } else if (error.message.includes('413')) {
        errorMessage = '이미지 파일이 너무 큽니다. 더 작은 이미지를 선택해주세요.';
      } else if (error.message.includes('404')) {
        errorMessage = '서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.';
      }
      
      alert(errorMessage);
      throw error;
    } finally {
      setIsConverting(false);
    }
  };

  // 음성 녹음 시작
  const startVoiceRecording = () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('이 브라우저는 음성 녹음을 지원하지 않습니다.');
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        setIsRecording(true);
        
        const mediaRecorder = new MediaRecorder(stream);
        const audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
          audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
          await processAudioWithWhisper(audioBlob);
          stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        setTimeout(() => {
          mediaRecorder.stop();
          setIsRecording(false);
        }, 5000);
      })
      .catch(error => {
        console.error('마이크 접근 오류:', error);
        alert('마이크 접근 권한이 필요합니다.');
        setIsRecording(false);
      });
  };

  // Whisper API로 음성 처리
  const processAudioWithWhisper = async (audioBlob) => {
    try {
      const result = await apiService.transcribeAudio(audioBlob);
      console.log('Whisper 음성 인식 결과:', result.text);
      setCurrentMessage(result.text);
    } catch (error) {
      console.error('Whisper 음성 인식 실패:', error);
      alert('음성 인식에 실패했습니다. 다시 시도해주세요.');
      setIsRecording(false);
    }
  };

  // 파일 변환 처리
  const handleFileConversion = async (file) => {
    try {
      if (file.type.startsWith('audio/')) {
        alert('음성 파일은 녹음 버튼을 사용해주세요.');
        return;
      } else if (file.type.startsWith('image/')) {
        const text = await convertImageToText(file);
        setCurrentMessage(text);
        addUserMessage(text);
      }
    } catch (error) {
      console.error('파일 변환 실패:', error);
      alert('파일 변환에 실패했습니다. 다시 시도해주세요.');
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
        addUserMessage(text);
      }
    } catch (error) {
      console.error('이미지 OCR 실패:', error);
    }

    event.target.value = null;
  };

  // 첨부파일 제거 핸들러
  const handleRemoveAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // 생활패턴 관리 함수들
  const handleAddLifestyle = useCallback(() => {
    if (!lifestyleInput.trim()) return;
    const newPatterns = lifestyleInput.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    setLifestyleList(prev => [...prev, ...newPatterns]);
    setLifestyleInput("");
  }, [lifestyleInput, setLifestyleList]);

  const handleDeleteLifestyle = (index) => {
    setLifestyleList(prev => prev.filter((_, i) => i !== index));
  };

  const handleClearAllLifestyles = () => {
    if (window.confirm("모든 생활 패턴을 삭제하시겠습니까?")) {
      setLifestyleList([]);
    }
  };

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
        
        const newSchedule = await apiService.generateSchedule(
          feedbackPrompt,
          conversationContext.slice(-12),
          sessionIdRef.current
        );
        
        if (newSchedule.schedule) {
          setLastSchedule(newSchedule.schedule);
          localStorage.setItem(STORAGE_KEYS.LAST_SCHEDULE, JSON.stringify(newSchedule.schedule));

          if (newSchedule.scheduleSessionId) {
            setCurrentScheduleSessionId(newSchedule.scheduleSessionId);
            localStorage.setItem(STORAGE_KEYS.LAST_SCHEDULE_SESSION_ID, newSchedule.scheduleSessionId);
          }

          const events = convertScheduleToEvents(newSchedule.schedule, today).map(event => ({
            ...event,
            extendedProps: {
              ...event.extendedProps,
              isDone: false,
            }
          }));

          setAllEvents(events);
          applyEventsToCalendar(events);

          const aiResponse = typeof newSchedule.notes === "string"
            ? newSchedule.notes.replace(/\n/g, "<br>")
            : (newSchedule.notes || []).join("<br>");
          
          addAIMessage("✅ 피드백을 반영하여 스케줄을 조정했습니다!");
          if (aiResponse) {
            addAIMessage(aiResponse);
          }
        } else {
          addAIMessage("스케줄 조정에 실패했습니다. 다시 시도해주세요.");
        }
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
    
      let foundDates = [];
      let processed = text;
    
      for (const pattern of patterns) {
        processed = processed.replaceAll(pattern, (match) => {
          const parsed = parseDateString(match, today);
          if (!parsed) return match;
    
          const day = convertToRelativeDay(parsed, today);
          foundDates.push({ original: match, date: parsed, relativeDay: day });
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
      localStorage.setItem(STORAGE_KEYS.LAST_SCHEDULE, JSON.stringify(newSchedule.schedule));

      if (newSchedule.scheduleSessionId) {
        setCurrentScheduleSessionId(newSchedule.scheduleSessionId);
        localStorage.setItem(STORAGE_KEYS.LAST_SCHEDULE_SESSION_ID, newSchedule.scheduleSessionId);
      }

      const events = convertScheduleToEvents(newSchedule.schedule, today).map(event => ({
        ...event,
        extendedProps: {
          ...event.extendedProps,
          isDone: false,
        }
      }));

      setAllEvents(events);
      applyEventsToCalendar(events);

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
      setMessages([]);
      setConversationContext([]);
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

  // 캘린더 이벤트 핸들러들
  const handleEventMount = (info) => {
    if (info.event.extendedProps?.type === "lifestyle") {
      info.el.style.backgroundColor = "#CFCFCF";
      info.el.style.borderColor = "#AAAAAA";
      info.el.style.color = "#333333";
      info.el.style.fontWeight = "normal";
      
      const viewType = calendarRef.current?.getApi().view.type;
      if (viewType === "dayGridMonth") {
        info.el.style.display = "none";
      }
    }
  };

  const handleViewDidMount = (arg) => {
    if (allEvents.length > 0) {
      applyEventsToCalendar(allEvents);
    }
  };

  const handleDatesSet = (arg) => {
    if (allEvents.length > 0) {
      const calendarApi = calendarRef.current?.getApi();
      if (calendarApi) {
        setTimeout(() => {
          applyEventsToCalendar(allEvents);
        }, 50);
      }
    }
  };

  const handleDayHeaderContent = (args) => {
    const weekday = args.date.toLocaleDateString("en-US", { weekday: "short" });
    return <span>{weekday}</span>;
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
      <div style={{ position: 'relative' }}>
        <h1 className="calendar-title">나만의 시간표 캘린더</h1>
        <LoadingSpinner isLoading={isLoading} progress={loadingProgress} />
      </div>
      
      <Calendar
        ref={calendarRef}
        events={allEvents}
        onEventMount={handleEventMount}
        onViewDidMount={handleViewDidMount}
        onDatesSet={handleDatesSet}
        onDayHeaderContent={handleDayHeaderContent}
        onEventContent={handleEventContent}
      />

      <button className="reset-button" onClick={handleResetCalendar}>
        캘린더 초기화
      </button>

      <FloatingButtons
        onClickPlus={() => {
          setTaskInputMode(UI_CONSTANTS.TASK_INPUT_MODES.CHATBOT);
          setShowTaskModal(true);
        }}
        onClickPencil={() => setShowLifestyleModal(true)}
        onClickAdvice={fetchAIAdvice}
      />

      <Chatbot
        isOpen={showTaskModal && taskInputMode === UI_CONSTANTS.TASK_INPUT_MODES.CHATBOT}
        onClose={() => setShowTaskModal(false)}
        messages={messages}
        currentMessage={currentMessage}
        setCurrentMessage={setCurrentMessage}
        attachments={attachments}
        onRemoveAttachment={handleRemoveAttachment}
        onSubmitMessage={handleSubmitMessage}
        onImageUpload={handleImageUpload}
        onVoiceRecording={startVoiceRecording}
        isRecording={isRecording}
        isConverting={isConverting}
        isLoading={isLoading}
        chatbotMode={chatbotMode}
        onModeChange={setChatbotMode}
      />

      <TaskFormModal
        isOpen={showTaskModal && taskInputMode === UI_CONSTANTS.TASK_INPUT_MODES.FORM}
        onClose={() => setShowTaskModal(false)}
        onBackToChatbot={() => setTaskInputMode(UI_CONSTANTS.TASK_INPUT_MODES.CHATBOT)}
        taskForm={taskForm}
        onTaskFormChange={handleTaskFormChange}
        onLevelSelect={handleLevelSelect}
        onSubmit={handleTaskFormSubmit}
      />

      <LifestyleModal
        isOpen={showLifestyleModal}
        onClose={() => setShowLifestyleModal(false)}
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
