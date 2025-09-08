// /routes/CalendarPage.jsx
import React, { useRef, useState, useCallback, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import FloatingButtons from "../components/FloatingButtons.jsx";
import "../styles/calendar.css"; 
import "../styles/modal.css"; 
import "../styles/fullcalendar-custom.css";
import "../styles/chatbot.css";
import {buildShedAIPrompt, buildFeedbackPrompt, convertScheduleToEvents, resetToStartOfDay, parseDateString, convertToRelativeDay} from "../utils/scheduleUtils";
import arrowBackIcon from "../assets/arrow-small-left-light.svg";
import ToggleSwitch from '../components/ToggleSwitch';

function CalendarPage() {
  const calendarRef = useRef(null);
  const today = resetToStartOfDay(new Date());
  const fileInputRef = useRef(null);
  const chatContainerRef = useRef(null);
  // 일관된 세션 ID 관리
  const getOrCreateSessionId = () => {
    let sessionId = localStorage.getItem('userSessionId');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('userSessionId', sessionId);
    }
    return sessionId;
  };
  
  const sessionIdRef = useRef(getOrCreateSessionId());

  // 세션 ID 업데이트 함수
  const updateSessionId = () => {
    const newSessionId = getOrCreateSessionId();
    sessionIdRef.current = newSessionId;
    return newSessionId;
  };

  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showLifestyleModal, setShowLifestyleModal] = useState(false);
  const [lifestyleInput, setLifestyleInput] = useState("");
  const [lifestyleList, setLifestyleList] = useState([]);     // 사용자가 생활 패턴을 입력하거나 수정할 때
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [allEvents, setAllEvents] = useState([]);
  const [isConverting, setIsConverting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [lastSchedule, setLastSchedule] = useState(() => {
    try {
      const stored = localStorage.getItem("lastSchedule");
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.error("Error parsing lastSchedule from localStorage:", error);
      return null;
    }
  });    // 	AI가 스케줄을 생성한 직후
  const [messages, setMessages] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [conversationContext, setConversationContext] = useState([]);
  
  // 할 일 입력 폼 상태
  const [taskForm, setTaskForm] = useState({
    title: "",
    deadline: "",
    importance: "", // 기본값: 선택 안 함
    difficulty: "", // 기본값: 선택 안 함
    description: ""
  });
  
  // 인터페이스 모드 (챗봇 또는 폼)
  const [taskInputMode, setTaskInputMode] = useState("chatbot"); // "chatbot" 또는 "form"

  // 피드백 시스템 상태
  const [currentScheduleSessionId, setCurrentScheduleSessionId] = useState(null);



  // 챗봇 입력 모드 (할 일 또는 피드백)
  const [chatbotMode, setChatbotMode] = useState("task"); // "task" 또는 "feedback"

  const isFirstMount = useRef(true);

  // 모달이 닫힐 때 폼 초기화
  useEffect(() => {
    if (!showTaskModal) {
      setTaskForm({
        title: "",
        deadline: "",
        importance: "",
        difficulty: "",
        description: ""
      });
    }
  }, [showTaskModal]);

  // 초기 로딩 시 생활패턴 불러오기 및 scheduleSessionId 복원
  useEffect(() => {
    try {
      const savedLifestyle = localStorage.getItem("lifestyleList");
      if (savedLifestyle) {
        const parsedLifestyle = JSON.parse(savedLifestyle);
        setLifestyleList(parsedLifestyle);
      }
    } catch (error) {
      console.error("Error parsing lifestyleList from localStorage:", error);
    }

    try {
      const savedSchedule = localStorage.getItem("lastSchedule");
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
    
    // === scheduleSessionId 복원 ===
    const savedSessionId = localStorage.getItem("lastScheduleSessionId");
    if (savedSessionId) setCurrentScheduleSessionId(savedSessionId);
  }, []);

  // 대화 기록 저장 (대화가 바뀔 때마다)
  useEffect(() => {
    localStorage.setItem("chatMessages", JSON.stringify(messages));   // 사용자가 메시지를 입력하거나, GPT 응답이 올 때
    localStorage.setItem("chatContext", JSON.stringify(conversationContext));   // 새로운 메시지에 따라 context가 갱신될 때
  }, [messages, conversationContext]);


  // 로딩 페이지- 타이머
  useEffect(() => {
    let timer;
    if (isLoading) {
      // 로딩 시작 시 진행률 초기화
      setLoadingProgress(0);
      
      // 즉시 1%로 시작하여 가시적인 변화 표시
      setTimeout(() => {
        setLoadingProgress(1);
      }, 50);
      
      // 주기적으로 진행률 업데이트
      timer = setInterval(() => {
        setLoadingProgress((prev) => (prev < 90 ? prev + 1 : prev));
      }, 300);
    } else if (loadingProgress > 0 && loadingProgress < 100) {
      // 로딩이 끝났고 진행 중이었다면 100%로 완료
      setLoadingProgress(100);
    }
    return () => timer && clearInterval(timer);
  }, [isLoading]);

  // 채팅창이 열릴 때마다 스크롤 아래로 이동
  useEffect(() => {
    if (chatContainerRef.current && showTaskModal) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, showTaskModal]);

  // 생활패턴 서버 동기화 및 스케줄 재생성 통합 함수
  const syncLifestyleAndRegenerate = useCallback((newList) => {
    setLifestyleList(newList);
  }, []);


  // 이미지 압축 함수
  const compressImage = (file, maxWidth = 1920, quality = 0.8) => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        // 이미지 크기 계산
        let { width, height } = img;
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // 이미지 그리기
        ctx.drawImage(img, 0, 0, width, height);
        
        // 압축된 이미지를 Base64로 변환
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  // 이미지를 Base64로 변환하는 함수 (크기 제한 및 압축 포함)
  const convertImageToBase64 = async (file) => {
    try {
      // 이미지 크기 제한 (5MB)
      const maxSize = 5 * 1024 * 1024; // 5MB
      
      if (file.size > maxSize) {
        console.log('이미지가 너무 커서 압축합니다...');
        // 이미지 압축 시도
        const compressedImage = await compressImage(file, 1920, 0.7);
        
        // 압축된 이미지 크기 확인
        const base64Data = compressedImage.split(',')[1];
        const sizeInBytes = (base64Data.length * 3) / 4;
        
        if (sizeInBytes > maxSize) {
          throw new Error('이미지 파일이 너무 큽니다. 더 작은 이미지를 선택해주세요.');
        }
        
        return compressedImage;
      } else {
        // 원본 이미지 사용
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

  // GPT-4o를 사용한 이미지 처리 함수
  const convertImageToText = async (imageFile) => {
    try {
      setIsConverting(true);
      
      // 이미지를 Base64로 변환
      const base64Image = await convertImageToBase64(imageFile);
      
      // GPT-4o API 호출
      const response = await fetch('http://localhost:3001/api/gpt4o-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: base64Image,
          prompt: "이 이미지에서 시간표나 일정 정보를 텍스트로 추출해주세요. 요일, 시간, 과목명 등을 정확히 인식하여 정리해주세요."
        })
      });

      if (!response.ok) {
        throw new Error(`GPT-4o API 오류: ${response.status}`);
      }

      const result = await response.json();
      const processedText = result.text || result;
      
      console.log('GPT-4o 이미지 처리 결과:', processedText);
      
      return processedText;
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


  // GPT-4o Whisper API를 사용한 음성 인식 함수
  const startVoiceRecording = () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('이 브라우저는 음성 녹음을 지원하지 않습니다.');
      return;
    }

    // 마이크 권한 요청 및 녹음 시작
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
        
        // 5초 후 자동으로 녹음 중지
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
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.wav');
      
      const response = await fetch('http://localhost:3001/api/whisper-transcribe', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Whisper API 오류: ${response.status}`);
      }

      const result = await response.json();
      const transcript = result.text || result;
      
      console.log('Whisper 음성 인식 결과:', transcript);
      
      setCurrentMessage(transcript);
    } catch (error) {
      console.error('Whisper 음성 인식 실패:', error);
      alert('음성 인식에 실패했습니다. 다시 시도해주세요.');
      setIsRecording(false);
    }
  };



  // 파일 변환 처리 함수
  const handleFileConversion = async (file) => {
    try {
      if (file.type.startsWith('audio/')) {
        // 음성 파일은 직접 변환하지 않고 사용자가 수동으로 녹음하도록 안내
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

  // lifestyleList 변경 시 서버 동기화 및 스케줄 자동 생성
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    // 서버 동기화
    (async () => {
      try {
        await fetch("http://localhost:3001/api/lifestyle-patterns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            sessionId: sessionIdRef.current,
            patterns: lifestyleList
          })
        });
      } catch (error) {
        console.error("생활 패턴 저장 오류:", error);
      }
    })();
    // 스케줄 자동 생성
    if (lifestyleList.length === 0) return;
    const lifestyleText = lifestyleList.join("\n");
    const today = resetToStartOfDay(new Date());
    const prompt = lastSchedule
      ? buildFeedbackPrompt(lifestyleText, "", lastSchedule)
      : buildShedAIPrompt(lifestyleText, "", today);
    (async () => {
      setIsLoading(true);
      setShowTaskModal(false);
      setShowLifestyleModal(false);
      addAIMessage("생활패턴이 변경되어 스케줄을 다시 생성합니다...");
      try {
        const response = await fetch("http://localhost:3001/api/generate-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            sessionId: sessionIdRef.current
          })
        });
        const newSchedule = await response.json();
        setLastSchedule(newSchedule.schedule);
        localStorage.setItem("lastSchedule", JSON.stringify(newSchedule.schedule));
        if (newSchedule.scheduleSessionId) {
          setCurrentScheduleSessionId(newSchedule.scheduleSessionId);
          localStorage.setItem("lastScheduleSessionId", newSchedule.scheduleSessionId);
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
    // eslint-disable-next-line
  }, [lifestyleList]);

  // localStorage에 lifestyleList 저장은 useEffect에서만 처리
  useEffect(() => {
    localStorage.setItem("lifestyleList", JSON.stringify(lifestyleList));
  }, [lifestyleList]);

  // 생활패턴 추가/삭제/전체삭제 핸들러 단순화
  const handleAddLifestyle = useCallback(() => {
    if (!lifestyleInput.trim()) return;
    // 여러 줄 입력 시 줄마다 하나의 패턴으로 추가
    const newPatterns = lifestyleInput.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    setLifestyleList(prev => [...prev, ...newPatterns]);
    setLifestyleInput("");
  }, [lifestyleInput]);
  const handleDeleteLifestyle = (index) => {
    syncLifestyleAndRegenerate(lifestyleList.filter((_, i) => i !== index));
  };
  const handleClearAllLifestyles = () => {
    if (window.confirm("모든 생활 패턴을 삭제하시겠습니까?")) {
      syncLifestyleAndRegenerate([]);
    }
  };

  // 캘린더에 이벤트 처리: 모두 제거 후 다시 렌더링 
  // 일반 이벤트 스타일 설정  / 월간, 주간 뷰 처리  / 생활패턴 이벤트 처리 
  const applyEventsToCalendar = (events) => {
    const calendarApi = calendarRef.current?.getApi();
    if (!calendarApi) return;
    
    calendarApi.removeAllEvents();
    calendarApi.removeAllEvents();
    const viewType = calendarApi.view.type;
    
    const processedEvents = events.map(event => {
      const newEvent = { ...event };      
      if (event.extendedProps?.type === "lifestyle") {
          if (viewType === "dayGridMonth") {
          newEvent.display = "none"; // 아예 렌더링에서 제외 (fullcalendar 공식 속성)
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

  // 사진 업로드 핸들러 (OCR 자동 변환)
  const handleImageUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // 이미지를 첨부파일로 추가
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

    // OCR로 텍스트 변환
    try {
      const text = await convertImageToText(file);
      if (text) {
        setCurrentMessage(text);
        addUserMessage(text);
      }
    } catch (error) {
      console.error('이미지 OCR 실패:', error);
    }

    event.target.value = null; // 같은 파일 다시 선택 가능하도록
  };


  // 첨부파일 제거 핸들러
  const handleRemoveAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
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

    // 마감일에서 day 인덱스 계산
    const deadlineDate = new Date(taskForm.deadline);
    const relativeDay = convertToRelativeDay(deadlineDate, today);
    
    // 할 일 메시지 형식 생성
    const formattedMessage = `${taskForm.title} (${taskForm.importance}중요도, ${taskForm.difficulty}난이도, 마감일: ${taskForm.deadline} day:${relativeDay})${taskForm.description ? '\n' + taskForm.description : ''}`;
    
    // 메시지 UI에 추가
    addUserMessage(formattedMessage, []);
    
    // 메시지 처리 함수 직접 호출 (챗봇 인터페이스 거치지 않고)
    handleProcessMessageWithAI(formattedMessage);
    
    // 폼 초기화
    setTaskForm({
      title: "",
      deadline: "",
      importance: "",
      difficulty: "",
      description: ""
    });
    
    // 모달 닫기
    setShowTaskModal(false);
  };

  // 메시지 제출 핸들러 수정
  const handleSubmitMessage = () => {
    if (currentMessage.trim() === "" && attachments.length === 0) return;
    if (isLoading) return;

    addUserMessage(currentMessage, [...attachments]);
    setAttachments([]);
    
    // 입력 모드에 따라 다른 처리
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
      // 로딩 시작
      setIsLoading(true);
      setShowTaskModal(false);
      setShowLifestyleModal(false);
      addAIMessage("피드백을 분석하고 스케줄을 조정하는 중입니다...");

      const response = await fetch("http://localhost:3001/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          scheduleSessionId: currentScheduleSessionId,
          feedbackText: messageText.trim()
        })
      });

      const result = await response.json();
      
      if (result.success) {
        // 피드백 분석 결과를 대화창에 표시
        if (result.analysis) {
          addAIMessage(`📊 피드백 분석: ${result.analysis}`);
        }
        
        // AI 조언을 대화창에 표시 (모달 대신)
        if (result.advice && result.advice.length > 0) {
          const adviceText = result.advice.map(item => 
            `💡 ${item.title || '조언'}: ${item.content}`
          ).join('\n');
          addAIMessage(adviceText);
        }
        
        // 피드백을 반영하여 스케줄 재생성
        addAIMessage("피드백을 반영하여 스케줄을 조정합니다...");
        
        const lifestyleText = lifestyleList.join("\n");
        const feedbackPrompt = buildFeedbackPrompt(lifestyleText, messageText, lastSchedule);
        
        const scheduleResponse = await fetch("http://localhost:3001/api/generate-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            prompt: feedbackPrompt,
            conversationContext: conversationContext.slice(-12),
            sessionId: sessionIdRef.current
          })
        });

        const newSchedule = await scheduleResponse.json();
        
        if (newSchedule.schedule) {
          setLastSchedule(newSchedule.schedule);
          localStorage.setItem("lastSchedule", JSON.stringify(newSchedule.schedule));

          // 새로운 스케줄 세션 ID 저장
          if (newSchedule.scheduleSessionId) {
            setCurrentScheduleSessionId(newSchedule.scheduleSessionId);
            localStorage.setItem("lastScheduleSessionId", newSchedule.scheduleSessionId);
          }

          // 이벤트 객체 생성 및 적용
          const events = convertScheduleToEvents(newSchedule.schedule, today).map(event => ({
            ...event,
            extendedProps: {
              ...event.extendedProps,
              isDone: false,
            }
          }));

          setAllEvents(events);
          applyEventsToCalendar(events);

          // AI 응답 추가
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
    // 날짜 인식 전처리(예: 이번주 토요일, 다음주 월요일)
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
    
    // 메시지 전처리
    const processedMessage = preprocessMessage(messageText);
    
    // 로딩 시작
    setIsLoading(true);
    setShowTaskModal(false);
    setShowLifestyleModal(false);
    addAIMessage("스케줄을 생성하는 중입니다...");
    
    const lifestyleText = lifestyleList.join("\n");
    
    // 최종 프롬프트 생성 (전처리된 메시지 사용)
    const prompt = lastSchedule 
      ? buildFeedbackPrompt(lifestyleText, processedMessage, lastSchedule)
      : buildShedAIPrompt(lifestyleText, processedMessage, today);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);  // 60초 타임아웃
      
      // 대화 컨텍스트를 포함하여 서버에 전송
      const response = await fetch("http://localhost:3001/api/generate-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          prompt,
          conversationContext: conversationContext.slice(-12), // 최근 12개 메시지만 전송
          sessionId: sessionIdRef.current // 세션 ID 전송
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      // 스케줄 생성 결과 Json 형식으로 받아옴 -> localstorage에 저장 
      const newSchedule = await response.json();
      setLastSchedule(newSchedule.schedule);
      localStorage.setItem("lastSchedule", JSON.stringify(newSchedule.schedule));

      // 스케줄 세션 ID 저장 (피드백용)
      if (newSchedule.scheduleSessionId) {
        setCurrentScheduleSessionId(newSchedule.scheduleSessionId);
        localStorage.setItem("lastScheduleSessionId", newSchedule.scheduleSessionId);
      }

      // 이벤트 객체 생성
      const events = convertScheduleToEvents(newSchedule.schedule, today).map(event => ({
        ...event,
        extendedProps: {
          ...event.extendedProps,
          isDone: false,
        }
      }));

      setAllEvents(events);           // 모든 이벤트 상태 저장
      applyEventsToCalendar(events);  // 캘린더에 이벤트 적용

      const calendarApi = calendarRef.current?.getApi();
      if (calendarApi) {
        const currentView = calendarApi.view.type;
        calendarApi.changeView(currentView);
      }

      // AI 응답 추가
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
      localStorage.removeItem("lastSchedule");
      localStorage.removeItem("lastScheduleSessionId");
      localStorage.removeItem("userSessionId");
      setLastSchedule(null);
      setAllEvents([]);
      calendarRef.current?.getApi().removeAllEvents();
      setMessages([]);
      setConversationContext([]);
      setCurrentScheduleSessionId(null);
      
      // 새 세션 ID 생성
      updateSessionId();
      addAIMessage("캘린더가 초기화되었습니다. 새로운 일정을 추가해주세요.");
    }
  };

  // AI 조언 조회 (대화창에 표시)
  const fetchAIAdvice = async () => {
    try {
      const response = await fetch(`http://localhost:3001/api/advice/${sessionIdRef.current}`);
      const result = await response.json();
      
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

  return (
    <div className="calendar-page">
      <div style={{ position: 'relative' }}>
        <h1 className="calendar-title">나만의 시간표 캘린더</h1>
        {/* 로딩 프로그레스 바 */}
        {isLoading && (
          <div className="loading-container">
            <div className="circular-spinner">
              <div className="spinner-ring">
                <div className="spinner-background"></div>
                <div className="spinner-progress"></div>
              </div>
            </div>
          </div>
        )}
      </div>
      
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
          height="auto"
          aspectRatio={1.35}
          contentHeight="auto"
          dayMaxEventRows={3} 
          allDaySlot={true}
          navLinks={true}
          nowIndicator={true}
          eventDidMount={(info) => {
            // 이벤트 마운트될 때 생활패턴 타입에 따른 스타일 적용
            if (info.event.extendedProps?.type === "lifestyle") {
              // DOM 직접 스타일링 (CSS 속성 오버라이드 가능성 있는 경우 대비)
              info.el.style.backgroundColor = "#CFCFCF";
              info.el.style.borderColor = "#AAAAAA";
              info.el.style.color = "#333333";
              info.el.style.fontWeight = "normal";
              
              // 월간 뷰에서는 표시하지 않음
              const viewType = calendarRef.current?.getApi().view.type;
              if (viewType === "dayGridMonth") {
                info.el.style.display = "none";
              }
            }
          }}
          viewClassNames={(arg) => {
            // 뷰 클래스 이름만 반환하고 이벤트 호출하지 않음
            return [`view-${arg.view.type}`];
          }}
          viewDidMount={(arg) => {
            // 뷰가 마운트될 때마다 이벤트 다시 적용
            if (allEvents.length > 0) {
              applyEventsToCalendar(allEvents);
            }
          }}
          datesSet={(arg) => {
            // 날짜 범위가 변경될 때마다 이벤트 다시 적용
            if (allEvents.length > 0) {
              const calendarApi = calendarRef.current?.getApi();
              if (calendarApi) {
                setTimeout(() => {
                  applyEventsToCalendar(allEvents);
                }, 50);
              }
            }
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
              checkbox.checked = isDone ?? false;
              checkbox.style.marginRight = "5px";
              checkbox.addEventListener("change", () => {
                // 현재 표시되는 이벤트의 속성 변경
                arg.event.setExtendedProp("isDone", checkbox.checked);    
                // allEvents 상태도 업데이트하여 뷰 간 동일화
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

      {/* 초기화 버튼 (좌측 하단) */}
      <button className="reset-button" onClick={handleResetCalendar}>
        캘린더 초기화
      </button>

      {/* 플로팅 버튼 (오른쪽 하단) */}
      <FloatingButtons
        onClickPlus={() => {
          setTaskInputMode("chatbot"); // 항상 챗봇 모드로 초기화
          setShowTaskModal(true);
        }}
        onClickPencil={() => setShowLifestyleModal(true)}
        onClickAdvice={fetchAIAdvice}
      />


      {/* 할 일 입력 모달 */}
      {showTaskModal && (
        <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
          {taskInputMode === "chatbot" ? (
            <div className="modal chatbot-modal" onClick={(e) => e.stopPropagation()}>
              <div style={{ position: 'absolute', top: 24, left: 24, zIndex: 2 }}>
                <ToggleSwitch
                  checked={chatbotMode === 'task'}
                  onChange={() => setChatbotMode(chatbotMode === 'task' ? 'feedback' : 'task')}
                  leftLabel="할 일"
                  rightLabel="피드백"
                />
              </div>
              <h2 className="chatbot-title" style={{ textAlign: 'center', paddingLeft: 0 }}>
                ShedAI 챗봇
              </h2>
              
              {/* 메시지 표시 영역 */}
              <div className="chat-container" ref={chatContainerRef}>
                {messages.length === 0 && (
                  <div className="chat-welcome">
                    {chatbotMode === "task" ? (
                      <>
                        <p>안녕하세요! 오늘의 할 일을 알려주세요.</p>
                        <p>시간표를 생성하거나 업데이트해 드릴게요!</p>
                      </>
                    ) : (
                      <>
                        <p>현재 스케줄에 대한 피드백을 남겨주세요.</p>
                        <p>AI가 이를 분석하여 더 나은 스케줄을 만들어드립니다.</p>
                      </>
                    )}
                  </div>
                )}
                
                {messages.map((msg, idx) => (
                  <div key={idx} className={`chat-message ${msg.type}-message`}>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="message-attachments">
                        {msg.attachments.map((attachment, attIdx) => (
                          <div key={attIdx} className="attachment-preview">
                            {attachment.type === 'image' && (
                              <img src={attachment.data} alt="첨부 이미지" />
                            )}
                            {attachment.type === 'audio' && (
                              <audio controls src={attachment.data}></audio>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="message-text" dangerouslySetInnerHTML={{ __html: msg.text.replace(/\n/g, '<br>') }}></div>
                    <div className="message-time">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
              
              {/* 첨부파일 미리보기 */}
              {attachments.length > 0 && (
                <div className="attachments-preview">
                  {attachments.map((attachment, idx) => (
                    <div key={idx} className="attachment-item">
                      {attachment.type === 'image' && (
                        <img src={attachment.data} alt="첨부 이미지" />
                      )}
                      {attachment.type === 'audio' && (
                        <audio controls src={attachment.data}></audio>
                      )}
                      <button className="remove-attachment" onClick={() => handleRemoveAttachment(idx)}>×</button>
                    </div>
                  ))}
                </div>
              )}
              
              {/* 메시지 입력 영역 */}
              <div className="chat-input-container">
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleImageUpload}
                />
                
                <button className="chat-attach-btn" onClick={() => fileInputRef.current?.click()}>
                  <span role="img" aria-label="이미지 첨부">🖼️</span>
                </button>
                <button 
                  className="chat-attach-btn" 
                  onClick={startVoiceRecording}
                  disabled={isRecording || isConverting}
                  style={{ 
                    backgroundColor: isRecording ? '#ff6b6b' : '#4CAF50',
                    opacity: isRecording || isConverting ? 0.7 : 1
                  }}
                  title="음성 녹음 (5초간 녹음 후 Whisper API로 변환)"
                >
                  <span role="img" aria-label="음성 녹음">
                    {isRecording ? '🔴' : '🎤'}
                  </span>
                </button>
                
                <div style={{ width: '8px' }}></div>
                
                {/* 변환 상태 표시 */}
                {(isConverting || isRecording) && (
                  <div className="conversion-status">
                    {isConverting && 'GPT-4o 이미지 처리 중...'}
                    {isRecording && '음성 녹음 중 (5초)...'}
                  </div>
                )}
                
                <input
                  type="text"
                  className="chat-input"
                  value={currentMessage}
                  onChange={(e) => setCurrentMessage(e.target.value)}
                  placeholder={
                    chatbotMode === "task"
                      ? "할 일을 입력하세요...(마감일, 중요도, 난이도 필수 입력)"
                      : "피드백을 입력하세요...(ex. 오전 시간이 너무 빡빡해요)"
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSubmitMessage();
                    }
                  }}
                />
                
                <button 
                  className="chat-send-button"
                  onClick={handleSubmitMessage}
                  disabled={isLoading}
                >
                  전송
                </button>
              </div>
              
              <div className="chatbot-buttons-row">
                <button className="chatbot-close-btn" onClick={() => setShowTaskModal(false)}>닫기</button>
                <button className="chatbot-mode-btn" onClick={() => setTaskInputMode("form")}>
                  간단히 입력
                </button>
              </div>
            </div>
          ) : (
            <div className="modal task-form-modal" onClick={(e) => e.stopPropagation()}>
              <div className="task-form-header">
                <button className="back-to-chatbot-btn" onClick={() => setTaskInputMode("chatbot")}>
                  <img src={arrowBackIcon} alt="뒤로가기" width="20" height="20" />
                </button>
                <h2 className="task-form-title">할 일 입력</h2>
              </div>
              
              <div className="task-form-container">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="task-title">제목 <span className="required">*</span></label>
                    <input 
                      type="text" 
                      id="task-title" 
                      className="task-input task-title-input" 
                      placeholder="예: 중간고사 준비"
                      value={taskForm.title}
                      onChange={handleTaskFormChange}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="task-deadline">마감일 <span className="required">*</span></label>
                    <div className="date-input-container">
                      <input 
                        type="date" 
                        id="task-deadline" 
                        className="task-input task-date-input"
                        value={taskForm.deadline}
                        onChange={handleTaskFormChange}
                      />
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group half-width">
                    <label>중요도 <span className="required">*</span></label>
                    <div className="button-group">
                      <button 
                        type="button"
                        className={`level-button ${taskForm.importance === "상" ? "active" : ""}`}
                        onClick={(e) => {
                          e.preventDefault();
                          handleLevelSelect("importance", "상");
                        }}
                      >
                        상
                      </button>
                      <button 
                        type="button"
                        className={`level-button middle ${taskForm.importance === "중" ? "active" : ""}`}
                        onClick={(e) => {
                          e.preventDefault();
                          handleLevelSelect("importance", "중");
                        }}
                      >
                        중
                      </button>
                      <button 
                        type="button"
                        className={`level-button ${taskForm.importance === "하" ? "active" : ""}`}
                        onClick={(e) => {
                          e.preventDefault();
                          handleLevelSelect("importance", "하");
                        }}
                      >
                        하
                      </button>
                    </div>
                  </div>
                  
                  <div className="form-group half-width">
                    <label>난이도 <span className="required">*</span></label>
                    <div className="button-group">
                      <button 
                        type="button"
                        className={`level-button ${taskForm.difficulty === "상" ? "active" : ""}`}
                        onClick={(e) => {
                          e.preventDefault();
                          handleLevelSelect("difficulty", "상");
                        }}
                      >
                        상
                      </button>
                      <button 
                        type="button"
                        className={`level-button middle ${taskForm.difficulty === "중" ? "active" : ""}`}
                        onClick={(e) => {
                          e.preventDefault();
                          handleLevelSelect("difficulty", "중");
                        }}
                      >
                        중
                      </button>
                      <button 
                        type="button"
                        className={`level-button ${taskForm.difficulty === "하" ? "active" : ""}`}
                        onClick={(e) => {
                          e.preventDefault();
                          handleLevelSelect("difficulty", "하");
                        }}
                      >
                        하
                      </button>
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="task-description">설명(선택)</label>
                  <textarea 
                    id="task-description" 
                    className="task-input task-textarea" 
                    placeholder="예: 요약 정리 → 문제 풀이 → 복습 순서로 진행"
                    value={taskForm.description}
                    onChange={handleTaskFormChange}
                  ></textarea>
                </div>

                {/* 버튼 그룹을 하단에 배치 */}
                <div className="task-form-buttons">
                  <button 
                    type="button"
                    className="task-submit-button"
                    onClick={(e) => {
                      e.preventDefault(); 
                      handleTaskFormSubmit();
                    }}
                  >
                    추가
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 생활 패턴 입력 모달 */}
      {showLifestyleModal && (
        <div className="modal-overlay" onClick={() => setShowLifestyleModal(false)}>
          <div className="modal lifestyle-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="lifestyle-title">생활 패턴 입력</h2>
            <p className="modal-description">일상적인 생활 패턴을 입력하면 AI가 이를 고려하여 시간표를 생성합니다.</p>
            
            <div className="lifestyle-grid">
              {lifestyleList.map((item, index) => (
                <div key={index} className="lifestyle-item">
                  <pre style={{whiteSpace: 'pre-line', overflow: 'auto', maxHeight: '5em', margin: 0}} title={item}>{item}</pre>
                  <button className="lifestyle-delete-btn" onClick={() => handleDeleteLifestyle(index)}>삭제</button>
                </div>
              ))}
              {lifestyleList.length === 0 && (
                <div className="empty-message">등록된 생활 패턴이 없습니다. 아래에서 추가해주세요.</div>
              )}
            </div>
            
            <div className="lifestyle-actions">
              <div className="lifestyle-input-row">
                <textarea
                  className="lifestyle-input"
                  value={lifestyleInput}
                  onChange={(e) => setLifestyleInput(e.target.value)}
                  placeholder="예: 평일 00시~08시 수면"
                  rows={2}
                  style={{resize: 'none'}}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAddLifestyle();
                    }
                  }}
                />
                <button className="lifestyle-add-btn" onClick={handleAddLifestyle}>추가</button>
              </div>
              <div className="lifestyle-buttons">
                <button className="lifestyle-clear-btn" onClick={handleClearAllLifestyles}>전체 삭제</button>
              </div>
            </div>
           </div>
        </div>
      )}


    </div>
  );
} 

export default CalendarPage;
