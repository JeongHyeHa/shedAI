// CalendarPageRefactored.jsx
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
import { useScheduleData } from '../hooks/useScheduleData';
import { useLifestyleManagement } from '../hooks/useLifestyleManagement';
import { useTaskManagement } from '../hooks/useTaskManagement';
import { useFeedbackManagement } from '../hooks/useFeedbackManagement';
import { useAuth } from '../contexts/AuthContext';

// 서비스 & 유틸리티
import apiService from '../services/apiService';
import firestoreService from '../services/firestoreService';
import { UI_CONSTANTS } from '../constants/ui';
import { 
  buildShedAIPrompt,
  buildFeedbackPrompt,
  convertScheduleToEvents,
  preprocessMessage
} from '../utils/scheduleUtils';
import { 
  resetToStartOfDay,
  parseDateString,
  convertToRelativeDay
} from '../utils/dateUtils';
import { toISODateLocal, toKoreanDate, toLocalMidnightDate } from '../utils/dateNormalize';
import { serverTimestamp, Timestamp } from 'firebase/firestore';
import '../styles/calendar.css';
import '../styles/floating.css';

// 할 일을 existingTasks와 사람이 읽는 taskText로 동시에 만들기
const buildTasksForAI = async (uid) => {
  const all = await firestoreService.getAllTasks(uid);
  console.log('[buildTasksForAI] 전체 할 일:', all.length, '개');
  const active = (all || []).filter(t => t && (t.isActive === undefined || t.isActive === true));
  console.log('[buildTasksForAI] 활성 할 일:', active.length, '개');
  
  // 할 일이 0개인 경우 경고 로그
  if (active.length === 0) {
    console.warn('[buildTasksForAI] ⚠️ 활성 할 일이 0개입니다. Firestore 반영이 늦을 수 있습니다.');
  }

  const existingTasksForAI = active.map(t => ({
    title: t.title || '제목없음',
    deadline: toISODateLocal(t.deadline),   // ✅ 통일
    importance: t.importance || '중',
    difficulty: t.difficulty || '중',
    description: t.description || ''
  }));

  const taskText = active.map(t => {
    const dd = toKoreanDate(toISODateLocal(t.deadline));
    return `${t.title || '제목없음'} (마감일: ${dd}, 중요도: ${t.importance || '중'}, 난이도: ${t.difficulty || '중'})`;
  }).join('\n');

  return { existingTasksForAI, taskText };
};


// 세션 ID 헬퍼 (사용자별 세션 분리)
const getOrCreateSessionId = (userId) => {
  const sidKey = `shedai_session_id_${userId ?? 'anon'}`;
  let sid = null;
  try { sid = localStorage.getItem(sidKey); } catch {}
  if (!sid) {
    sid = `sess_${Date.now()}`;
    try { localStorage.setItem(sidKey, sid); } catch {}
  }
  return sid;
};

// 스케줄 세션 저장(형식 통일) — 프롬프트는 미리보기로 제한 저장
const saveScheduleSessionUnified = async ({
  uid,
  schedule,
  lifestyleList,
  aiPrompt,
  conversationContext
}) => {
  // lifestyleContext를 문자열 배열로 변환
  const lifestyleContextForSave = Array.isArray(lifestyleList) 
    ? lifestyleList.map(pattern => {
        if (typeof pattern === 'string') {
          return pattern; // 이미 문자열인 경우
        } else if (pattern && typeof pattern === 'object' && pattern.patternText) {
          return pattern.patternText; // patternText 사용
        } else if (pattern && typeof pattern === 'object') {
          // 객체인 경우 문자열로 변환
          const days = Array.isArray(pattern.days) ? pattern.days.join(',') : '';
          const title = pattern.title || '활동';
          const start = pattern.start || '09:00';
          const end = pattern.end || '10:00';
          return `${days} ${start}-${end} ${title}`;
        }
        return '';
      }).filter(p => p)
    : [];

  const promptPreview = typeof aiPrompt === 'string' ? aiPrompt.slice(0, 10000) : '';

  const data = {
    scheduleData: schedule,
    hasSchedule: true,
    isActive: true,
    lifestyleContext: lifestyleContextForSave, // 문자열 배열로 저장
    aiPromptPreview: promptPreview,          // 대용량 방지: 미리보기만 저장
    conversationContext: conversationContext.slice(-8),  // 8로 통일
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  return await firestoreService.saveScheduleSession(uid, data);
};

function CalendarPage() {
  const calendarRef = useRef(null);
  const sessionIdRef = useRef(null);
  const today = resetToStartOfDay(new Date());
  
  // 인증 및 Firebase 훅
  const { user } = useAuth();
  const { userInsights, generatePersonalizedSchedule } = usePersonalizedAI();
  
  // 새로운 분리된 훅들
  const { 
    allEvents, 
    setAllEvents, 
    loading, 
    lastSchedule, 
    setLastSchedule,
    loadUserData,
    updateSchedule 
  } = useScheduleData();
  const { 
    lifestyleList, 
    setLifestyleList, 
    lifestyleInput, 
    setLifestyleInput,
    isClearing,
    handleAddLifestyle,
    handleDeleteLifestyle,
    handleClearAllLifestyles,
    handleSaveAndGenerateSchedule
  } = useLifestyleManagement();
  const { taskForm, setTaskForm, handleTaskFormSubmit } = useTaskManagement();
  const { feedbackInput, setFeedbackInput, handleSubmitFeedbackMessage } = useFeedbackManagement();

  // sessionIdRef 설정
  useEffect(() => {
    if (user?.uid) {
      sessionIdRef.current = getOrCreateSessionId(user.uid);
    }
  }, [user?.uid]);
  
  // 커스텀 훅들
  const { 
    isLoading, 
    setIsLoading, 
    loadingProgress, 
    generateSchedule 
  } = useScheduleManagement(setAllEvents);
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
  const [showTaskManagementModal, setShowTaskManagementModal] = useState(false);
  const [currentScheduleSessionId, setCurrentScheduleSessionId] = useState(null);
  const [chatbotMode, setChatbotMode] = useState(UI_CONSTANTS.CHATBOT_MODES.TASK);
  const [taskInputMode, setTaskInputMode] = useState(UI_CONSTANTS.TASK_INPUT_MODES.CHATBOT);
  const [editingTaskId, setEditingTaskId] = useState(null); // 수정 중인 할 일 ID

  // 스케줄 생성 콜백 - 서버 시그니처에 맞게 수정
  const handleScheduleGeneration = useCallback(async (prompt, message) => {
    if (!user?.uid) { addAIMessage("로그인이 필요합니다."); return; }
    addAIMessage(message);
    
    try {
      // 문자열 배열이면 그대로, 아니면 Firestore에서 객체 패턴 로드
      const patternsForAI = (Array.isArray(lifestyleList) && typeof lifestyleList[0] === 'string')
        ? lifestyleList
        : await firestoreService.getLifestylePatterns(user.uid);
      
      const { existingTasksForAI, taskText } = await buildTasksForAI(user.uid);

      // 서버 시그니처에 맞게 호출: generateSchedule(messages, lifestylePatterns, existingTasks, opts)
      const messages = [
        ...conversationContext.slice(-8),  // 12개 → 8개로 축소
        { 
          role: 'user', 
          content: `${prompt}\n\n[현재 할 일 목록]\n${taskText || '할 일 없음'}`  // ✅ taskText 포함
        }
      ].filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
      
      // 디버깅을 위한 로그 추가
      console.log('[handleScheduleGeneration] 전달 프롬프트 미리보기:\n', messages[messages.length - 1].content.slice(0, 500));
      
      const sessionId = getOrCreateSessionId(user.uid);
      const result = await generateSchedule(
        messages,
        patternsForAI, // ✅ 객체 패턴 보장
        existingTasksForAI,                    // ✅ 할 일 테이블 반영
        { userId: user.uid, sessionId } // opts
      );
      
      // 방탄 로직: task가 비어 있을 때 보정
      let finalSchedule = result.schedule;
      const hasTask = Array.isArray(result.schedule) &&
        result.schedule.some(d =>
          d.activities?.some(a => a.type && a.type.toLowerCase() !== 'lifestyle')
        );

      if (!hasTask && /오픽|시험/.test(message)) {
        const backupTask = {
          title: '오픽 시험 준비',
          start: '19:00',
          end: '21:00',
          type: 'task'
        };
        (finalSchedule[0].activities ||= []).push(backupTask);
        console.warn('[handleScheduleGeneration Fallback] 오픽 task 자동 추가');
      }

      setLastSchedule(finalSchedule);
      
      const scheduleSessionId = await saveScheduleSessionUnified({
        uid: user.uid,
        schedule: finalSchedule,
        lifestyleList: patternsForAI,
        aiPrompt: prompt,                      // ✅ 프롬프트 DB 저장
        conversationContext
      });
      setCurrentScheduleSessionId(scheduleSessionId);
      
      // 이벤트는 Calendar 컴포넌트에서 자동으로 처리됨
      addAIMessage("스케줄이 생성되었습니다!");
      
      // 스케줄 생성 완료 후 모달 닫기
      setShowLifestyleModal(false);
    } catch (error) {
      console.error('스케줄 생성 실패:', error);
      addAIMessage("스케줄 생성에 실패했습니다. 다시 시도해주세요.");
    }
  }, [generateSchedule, conversationContext, lifestyleList, today, addAIMessage, user?.uid]);

  // 생활패턴 동기화
  useLifestyleSync(
    lifestyleList, 
    lastSchedule, 
    today, 
    user?.uid, 
    handleScheduleGeneration,
    { autoGenerate: false, autoSync: false }
  );


  // 새로운 저장 + 스케줄 생성 함수 (DB에서 모든 데이터 가져와서 생성)
  const handleSaveAndGenerate = useCallback(async () => {
    if (!user?.uid) { addAIMessage("로그인이 필요합니다."); return; }
    if (lifestyleList.length === 0) {
      addAIMessage('저장할 생활패턴이 없습니다.');
      return;
    }
    
    // 스피너 시작
    setIsLoading(true);
    
    try {
      // 1. 생활패턴 저장
      await handleSaveAndGenerateSchedule();
      
      // 2. DB에서 모든 데이터 가져오기
      const [savedLifestylePatterns] = await Promise.all([
        firestoreService.getLifestylePatterns(user.uid)
      ]);
      const { existingTasksForAI, taskText } = await buildTasksForAI(user.uid);
      
      // 3. 생활패턴을 텍스트로 변환
      const lifestyleText = savedLifestylePatterns
        .filter(pattern => pattern && pattern.days && Array.isArray(pattern.days))
        .map(pattern => 
          `${pattern.days.join(',')} ${pattern.start || '00'}:00-${pattern.end || '00'}:00 ${pattern.title || '제목없음'}`
        ).join("\n");
      
      
      // 5. 스케줄 생성 (직접 호출로 변경)
      const prompt = lastSchedule 
        ? buildFeedbackPrompt(lifestyleText, taskText, lastSchedule)
        : buildShedAIPrompt(lifestyleText, taskText, today);
      
      const messages = [
        ...conversationContext.slice(-8),  // 12개 → 8개로 축소
        { role: 'user', content: prompt }
      ].filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
      
      const sessionId = getOrCreateSessionId(user.uid);
      const result = await generateSchedule(
        messages,
        savedLifestylePatterns, // ✅ DB 객체 패턴 사용
        existingTasksForAI,
        { userId: user.uid, sessionId }
      );
      
      setLastSchedule(result.schedule);
      addAIMessage("스케줄이 생성되었습니다!");

      const scheduleSessionId = await saveScheduleSessionUnified({
        uid: user.uid,
        schedule: result.schedule,
        lifestyleList: savedLifestylePatterns,
        aiPrompt: prompt,
        conversationContext
      });
      setCurrentScheduleSessionId(scheduleSessionId);
      
    } catch (error) {
      console.error('저장 및 스케줄 생성 실패:', error);
      const errorMessage = error.response?.data?.message || error.message || '알 수 없는 오류가 발생했습니다.';
      addAIMessage('저장 및 스케줄 생성에 실패했습니다: ' + errorMessage);
    } finally {
      // 스피너 종료
      setIsLoading(false);
    }
  }, [lifestyleList, lastSchedule, today, handleScheduleGeneration, handleSaveAndGenerateSchedule, setIsLoading, user]);

  // 할 일 관리창 저장 함수 (DB에서 모든 데이터 가져와서 스케줄 재생성)
  const handleTaskManagementSave = useCallback(async () => {
    if (!user?.uid) { addAIMessage("로그인이 필요합니다."); return; }
    // 스피너 시작
    setIsLoading(true);
    
    try {
      // 1. DB에서 모든 데이터 가져오기
      const [savedLifestylePatterns] = await Promise.all([
        firestoreService.getLifestylePatterns(user.uid)
      ]);
      const { existingTasksForAI, taskText } = await buildTasksForAI(user.uid);
      
      // 2. 생활패턴을 텍스트로 변환 (원래 형식으로)
      const lifestyleText = savedLifestylePatterns
        .filter(pattern => pattern && pattern.days && Array.isArray(pattern.days))
        .map(pattern => {
          // days 배열을 주말/평일/매일 키워드로 변환
          let dayKeyword = '';
          if (pattern.days.length === 7) {
            dayKeyword = '매일';
          } else if (pattern.days.length === 2 && pattern.days.includes(6) && pattern.days.includes(7)) {
            dayKeyword = '주말';
          } else if (pattern.days.length === 5 && pattern.days.every(day => day >= 1 && day <= 5)) {
            dayKeyword = '평일';
          } else {
            // 구체적인 요일들
            const dayNames = ['', '월', '화', '수', '목', '금', '토', '일'];
            dayKeyword = pattern.days.map(day => dayNames[day] + '요일').join(' ');
          }
          
          // 시간 형식 변환 (24시간 → 12시간)
          const formatTime = (time) => {
            // time이 "HH:MM" or number(시) 모두 지원
            let hour = time;
            if (typeof time === 'string') {
              const m = time.match(/^(\d{1,2})(?::\d{1,2})?$/);
              hour = m ? parseInt(m[1], 10) : 0;
            }
            if (hour === 0) return '자정';
            if (hour === 12) return '정오';
            if (hour < 12) return `오전 ${hour}시`;
            return `오후 ${hour - 12}시`;
          };
          
          const startTime = formatTime(pattern.start ?? '0:00');
          const endTime = formatTime(pattern.end ?? '0:00');
          
          return `${dayKeyword} ${startTime}~ ${endTime} ${pattern.title || '제목없음'}`;
        }).join("\n");
      
      
      // 4. 스케줄 생성 (직접 API 호출)
      // 스케줄 재생성 시작
      
      const prompt = lastSchedule 
        ? buildFeedbackPrompt(lifestyleText, taskText, lastSchedule)
        : buildShedAIPrompt(lifestyleText, taskText, today);
      
      addAIMessage("DB 데이터를 기반으로 스케줄을 재생성합니다...");
      
      try {
        // 서버 시그니처에 맞게 호출: generateSchedule(messages, lifestylePatterns, existingTasks, opts)
        const messages = [
          ...conversationContext.slice(-8),  // 12개 → 8개로 축소
          { role: 'user', content: prompt }
        ].filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
        
        const result = await generateSchedule(
          messages,
          savedLifestylePatterns, // DB에서 가져온 생활패턴 배열
          existingTasksForAI,                       // ✅ 반영
          {
            nowOverride: today.toISOString().split('T')[0] + 'T00:00:00',
            anchorDay: today.getDay() === 0 ? 7 : today.getDay()
          }
        );
        
        setLastSchedule(result.schedule);
        
        // 통일된 저장 사용
        const scheduleSessionId = await saveScheduleSessionUnified({
          uid: user.uid,
          schedule: result.schedule,
          lifestyleList: savedLifestylePatterns,
          aiPrompt: prompt,                          // ✅ 프롬프트 저장
          conversationContext
        });
        setCurrentScheduleSessionId(scheduleSessionId);
        
        addAIMessage("스케줄이 생성되었습니다!");
        
      } catch (error) {
        console.error('스케줄 생성 실패:', error);
        addAIMessage("스케줄 생성에 실패했습니다. 다시 시도해주세요.");
      }
      
    } catch (error) {
      console.error('스케줄 재생성 실패:', error);
      const errorMessage = error.response?.data?.message || error.message || '알 수 없는 오류가 발생했습니다.';
      addAIMessage('스케줄 재생성에 실패했습니다: ' + errorMessage);
    } finally {
      // 스피너 종료
      setIsLoading(false);
    }
  }, [lastSchedule, today, handleScheduleGeneration, setIsLoading, user]);

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

  // 할 일 제출 핸들러 (새로운 훅 사용)
  const handleTaskSubmit = async () => {
    // 수정 모드인 경우 기존 할 일 업데이트
    if (editingTaskId && user) {
      try {
        const taskData = {
          title: taskForm.title,
          deadline: Timestamp.fromDate(toLocalMidnightDate(taskForm.deadline)), // ✔️ 로컬 자정
          importance: taskForm.importance,
          difficulty: taskForm.difficulty,
          description: taskForm.description || ''
        };
        
        await firestoreService.updateTask(user.uid, editingTaskId, taskData);
        // 할 일 수정 완료
        
        // 수정 완료 후 모달 닫기
        setShowTaskModal(false);
        setEditingTaskId(null);
        
        // 성공 메시지 표시
        addAIMessage('할 일이 수정되었습니다. 스케줄을 다시 생성합니다.');
        
        // 수정된 할 일로 스케줄 재생성
        const deadlineDateKR = toKoreanDate(toISODateLocal(taskForm.deadline)); // ✔️ 사람이 읽는 용도
        const updatedTaskMessage = `할 일이 수정되었습니다: ${taskData.title} (마감일: ${deadlineDateKR}, 중요도: ${taskData.importance}, 난이도: ${taskData.difficulty})`;
        addUserMessage(updatedTaskMessage, []);
        
        // 바로 호출해도 됩니다 (Firestore는 강한 일관성)
        await handleTaskManagementSave();
        
        // 관리창을 다시 열어서 수정된 내용 확인
        setTimeout(() => {
          setShowTaskManagementModal(true);
        }, 100);
        return;
      } catch (error) {
        console.error('할 일 수정 실패:', error);
        addAIMessage('할 일 수정에 실패했습니다.');
        return;
      }
    }

    // 새 할 일 추가 모드
    handleTaskFormSubmit(
      (formattedMessage) => {
        addUserMessage(formattedMessage, []);
        handleProcessMessageWithAI(formattedMessage);
        setShowTaskModal(false);
        setEditingTaskId(null);
      },
      // 스케줄 재생성 콜백
      () => {
        handleTaskManagementSave();
      },
      // 할 일 저장 완료 콜백
      () => {
        // TaskManagementModal이 열려있다면 새로고침하도록 이벤트 발생
        if (showTaskManagementModal) {
          window.dispatchEvent(new CustomEvent('taskSaved'));
        }
      }
    );
  };

  // 할 일 수정 핸들러
  const handleEditTask = (task) => {
    // 수정 중인 할 일 ID 저장
    setEditingTaskId(task.id);
    
    // 기존 할 일 데이터를 폼에 로드
    const taskData = {
      title: task.title,
      deadline: task.deadline ? (task.deadline.toDate ? task.deadline.toDate() : new Date(task.deadline)) : new Date(),
      importance: task.importance || '중',
      difficulty: task.difficulty || '중',
      description: task.description || ''
    };
    
    // 폼 데이터 설정
    setTaskForm(taskData);
    
    // 간단 입력 모드로 전환
    setTaskInputMode(UI_CONSTANTS.TASK_INPUT_MODES.FORM);
    setShowTaskModal(true);
  };

  // 할 일 모달 닫기 핸들러
  const handleCloseTaskModal = () => {
    setShowTaskModal(false);
    setEditingTaskId(null); // 수정 모드 초기화
  };

  // 메시지 제출 핸들러
  const handleSubmitMessage = () => {
    if (currentMessage.trim() === "" && attachments.length === 0) return;
    if (isLoading) return;

    addUserMessage(currentMessage, [...attachments]);
    setAttachments([]);
    
    if (chatbotMode === "feedback") {
      handleFeedbackSubmit();
    } else {
      handleProcessMessageWithAI(currentMessage);
    }
    
    setCurrentMessage("");
  };

  // 피드백 제출 핸들러 (새로운 훅 사용)
  const handleFeedbackSubmit = () => {
    handleSubmitFeedbackMessage(currentMessage, (messageText, analysis, advice) => {
      if (analysis) {
        addAIMessage(`📊 피드백 분석: ${analysis}`);
      }
      
      if (advice && advice.length > 0) {
        const adviceText = advice.map(item => 
          `💡 ${item.title || '조언'}: ${item.content}`
        ).join('\n');
        addAIMessage(adviceText);
      }
      
      addAIMessage("피드백을 반영하여 스케줄을 조정합니다...");
      
      const lifestyleText = lifestyleList.join("\n");
      const feedbackPrompt = buildFeedbackPrompt(lifestyleText, messageText, lastSchedule);
      handleScheduleGeneration(feedbackPrompt, "피드백을 반영하여 스케줄을 조정합니다...");
    });
  };
  
  // 메시지를 AI로 처리하는 함수
  const handleProcessMessageWithAI = async (messageText) => {
    const preprocessKoreanRelativeDates = (text) => {
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
    
    const processedMessage = preprocessKoreanRelativeDates(messageText);
    
    setIsLoading(true);
    setShowTaskModal(false);
    setShowLifestyleModal(false);
    addAIMessage("스케줄을 생성하는 중입니다...");
    
    // 생활패턴을 객체로 가져와서 텍스트로 변환
    let lifestyleText = '';
    let lifestylePatternsForAI = [];
    
    if (Array.isArray(lifestyleList) && typeof lifestyleList[0] === 'string') {
      // 문자열 배열이면 그대로 사용 (aiService.js에서 파싱)
      lifestylePatternsForAI = lifestyleList;
      lifestyleText = lifestyleList.join('\n');
    } else {
      // 객체 배열이면 Firestore에서 다시 로드
      lifestylePatternsForAI = await firestoreService.getLifestylePatterns(user.uid);
      lifestyleText = lifestylePatternsForAI.map(p => 
        typeof p === 'string' ? p : `${p.title} (${p.start}-${p.end}, 요일: ${p.days?.join(', ') || '미정'})`
      ).join('\n');
    }
    
    const prompt = lastSchedule 
      ? buildFeedbackPrompt(lifestyleText, processedMessage, lastSchedule)
      : buildShedAIPrompt(lifestyleText, processedMessage, today);

    // 프롬프트 강화 - 할 일을 반드시 일정에 포함하도록 명령
    const enforcedPrompt = `${prompt}

[반드시 지켜야 할 규칙]
- 위 [현재 할 일 목록]에 있는 모든 할 일은 반드시 'type': 'task' 형태로 스케줄 JSON에 포함할 것.
- 'lifestyle'에 포함된 항목으로 대체하거나 병합하지 말 것.
- 각 task의 시간대(start~end)는 lifestyle과 겹치지 않게 배치할 것.
- task에는 title, start, end, type='task' 필드가 반드시 있어야 함.
- 예시:
  { "title": "오픽 시험 준비", "start": "19:00", "end": "21:00", "type": "task" }
`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      
      // 서버 시그니처에 맞게 호출: generateSchedule(messages, lifestylePatterns, existingTasks, opts)
      const messagesForAPI = [
        ...conversationContext.slice(-8),  // 12개 → 8개로 축소
        { role: 'user', content: enforcedPrompt }
      ].filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
      
      const patternsForAI = (Array.isArray(lifestyleList) && typeof lifestyleList[0] === 'string')
        ? lifestyleList  // 문자열 배열이면 그대로 사용
        : (await firestoreService.getLifestylePatterns(user.uid)); // 객체 배열이면 Firestore에서 로드
      const { existingTasksForAI } = await buildTasksForAI(user.uid);

      const sessionId = getOrCreateSessionId(user.uid);
      const apiResp = await apiService.generateSchedule(
        messagesForAPI,           // 1) messages
        patternsForAI,            // 2) lifestylePatterns (객체 배열)
        existingTasksForAI,       // 3) existingTasks ✅ 할 일 반영
        { 
          userId: user.uid, 
          sessionId,
          promptContext: prompt  // 4) 사용자 자연어 입력을 promptContext로 전달
        }
      );
      const newSchedule = apiResp?.schedule ? apiResp : { schedule: apiResp };
      
      clearTimeout(timeoutId);


      setLastSchedule(newSchedule.schedule);

      // 통일된 저장 사용
      const scheduleSessionId = await saveScheduleSessionUnified({
        uid: user.uid,
        schedule: newSchedule.schedule,
        lifestyleList: patternsForAI,
        aiPrompt: prompt,                          // ✅ 프롬프트 별도 저장
        conversationContext
      });
        setCurrentScheduleSessionId(scheduleSessionId);

      const events = convertScheduleToEvents(newSchedule.schedule, today).map(event => ({
        ...event,
        extendedProps: {
          ...event.extendedProps,
          isDone: false,
        }
      }));

      // 방탄 로직: task가 비어 있을 때 보정
      const hasTask = Array.isArray(newSchedule.schedule) &&
        newSchedule.schedule.some(d =>
          d.activities?.some(a => a.type && a.type.toLowerCase() !== 'lifestyle')
        );

      if (!hasTask && /오픽|시험/.test(processedMessage)) {
        const backupTask = {
          title: '오픽 시험 준비',
          start: '19:00',
          end: '21:00',
          type: 'task'
        };
        (newSchedule.schedule[0].activities ||= []).push(backupTask);
        console.warn('[Fallback] 오픽 task 자동 추가');
        
        // fallback task를 포함한 이벤트 재생성
        const updatedEvents = convertScheduleToEvents(newSchedule.schedule, today).map(event => ({
          ...event,
          extendedProps: {
            ...event.extendedProps,
            isDone: false,
          }
        }));
        setAllEvents(updatedEvents);
      } else {
        setAllEvents(events);
      }
      // 이벤트는 Calendar 컴포넌트에서 자동으로 처리됨

      // 오픽 시험 키워드 매칭으로 즉시 할 일 생성
      try {
        if (/오픽/.test(processedMessage) || /시험/.test(processedMessage)) {
          const today = new Date();
          const nextThu = new Date(today);
          const daysUntilThu = (4 - today.getDay() + 7) % 7; // 목요일까지의 일수
          nextThu.setDate(today.getDate() + daysUntilThu + 7); // 다음주 목요일
          
          const opicTask = {
            title: '오픽 시험 준비',
            deadline: toISODateLocal(nextThu),
            importance: '상',
            difficulty: '상',
            description: '오픽 시험을 위한 체계적인 공부 계획',
            relativeDay: daysUntilThu + 7,
            isActive: true,
            createdAt: serverTimestamp()
          };
          
          console.log('[CalendarPage] 오픽 시험 키워드 감지 - 즉시 할 일 생성:', opicTask);
          await firestoreService.saveTask(user.uid, opicTask);
        }
      } catch (error) {
        console.error('[CalendarPage] 오픽 시험 할 일 생성 실패:', error);
      }

      // 스케줄에서 할 일 추출하여 Firestore에 저장 (중복 방지)
      try {
        // 필터 완화: lifestyle만 제외하고, 날짜가 있는 모든 AI 이벤트를 저장 대상으로 간주
        const taskEvents = events.filter(event => {
          const t = event.extendedProps?.type;
          // type이 없거나 lifestyle이 아닌 이벤트는 모두 저장
          return event.start && (!t || t.toLowerCase() !== 'lifestyle');
        });
        
        // 디버깅을 위한 로그 추가
        console.log('[CalendarPage] 이벤트 타입 분포:', {
          totalEvents: events.length,
          taskEvents: taskEvents.length,
          lifestyleEvents: events.filter(e => e.extendedProps?.type === 'lifestyle').length,
          otherEvents: events.filter(e => !e.extendedProps?.type).length,
          taskEventTypes: taskEvents.map(e => e.extendedProps?.type)
        });
        
        if (taskEvents.length > 0) {
          console.log('[CalendarPage] task 이벤트들:', taskEvents.map(t => ({
            title: t.title,
            start: t.start,
            end: t.end,
            type: t.extendedProps?.type
          })));
        }
        
        // 기존 할 일 목록 가져오기
        const existingTasks = await firestoreService.getAllTasks(user.uid);
        
        // 새 할 일들을 일괄 저장 (제목+날짜 조합으로 중복 방지)
        const newTasks = taskEvents
          .filter(event => {
            const startIso = toISODateLocal(event.start);
            if (!startIso) return false;
            const key = `${event.title}__${startIso}`;
            return !existingTasks.some(t => {
              const existingDate = toISODateLocal(t.deadline);
              const existingKey = `${t.title}__${existingDate}`;
              return existingKey === key;
            });
          })
          .map(event => ({
            title: event.title,
            deadline: toISODateLocal(event.start),  // ✅ 통일
            importance: event.extendedProps?.importance ?? '중',
            difficulty: event.extendedProps?.difficulty ?? '중',
            description: event.extendedProps?.description ?? '',
            relativeDay: 0,
            isActive: true,               // ✅ 빠지면 추후 필터에서 제외됨
            createdAt: serverTimestamp()  // ✅ 권장
          }))
          .filter(t => t.deadline); // 유효한 날짜만
        
        if (newTasks.length > 0) {
          console.log('[CalendarPage] 새 할 일 저장 시작:', newTasks.length, '개');
          await Promise.all(newTasks.map(task => firestoreService.saveTask(user.uid, task)));
          console.log('[CalendarPage] 새 할 일 저장 완료');
        } else {
          console.log('[CalendarPage] 저장할 새 할 일이 없음');
        }
      } catch (error) {
        // 할 일 저장 실패 - 조용히 처리
      }

      const calendarApi = calendarRef.current?.getApi();
      if (calendarApi) {
        const currentView = calendarApi.view.type;
        calendarApi.changeView(currentView);
      }

      const aiResponse = typeof newSchedule.notes === "string"
        ? newSchedule.notes.replace(/\n/g, "<br>")
        : (newSchedule.notes || []).join("<br>");
      
      addAIMessage("스케줄을 생성했습니다!");
      
      // AI의 설계 이유 설명 추가
      if (newSchedule.explanation) {
        const explanationText = newSchedule.explanation.replace(/\n/g, "<br>");
        addAIMessage(`📋 스케줄 설계 이유:<br>${explanationText}`);
      }
      
      addAIMessage(aiResponse);
    } catch (e) {
      console.error('스케줄 생성 요청 실패:', e);
      addAIMessage("요청 실패: 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  };

  // 캘린더 초기화 함수
  const handleResetCalendar = async () => {
    if (!user?.uid) return;
    if (window.confirm("모든 일정을 초기화하시겠습니까?")) {
      try {
        // Firestore에서 최신 스케줄 비활성화/삭제 처리
        await firestoreService.deleteLatestSchedule(user.uid);
        // 로컬 백업 제거
        try { localStorage.removeItem('shedAI:lastSchedule'); } catch {}
      } catch (e) {
        console.error('스케줄 삭제 처리 실패:', e);
      }

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
      const result = await apiService.getAdvice({
        userId: user.uid,
        sessionId: sessionIdRef.current
      });
      
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

  // 생활패턴 이미지 업로드 (OCR 결과를 생활패턴 입력창에 반영)
  const handleLifestyleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await convertImageToText(file);
      if (text) {
        setLifestyleInput(prev => (prev ? prev + "\n" : "") + text);
      }
    } catch (error) {
      console.error('생활패턴 이미지 OCR 실패:', error);
    }

    event.target.value = null;
  };

  // 생활패턴 음성 입력 (인식 텍스트를 생활패턴 입력창에 반영)
  const handleLifestyleVoiceRecording = async () => {
    try {
      const text = await startVoiceRecording();
      if (text) {
        setLifestyleInput(prev => (prev ? prev + "\n" : "") + text);
      }
    } catch (error) {
      console.error('생활패턴 음성 녹음 실패:', error);
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
      // 월간 뷰에서 일정 개수 제한 로직
      if (arg.el && arg.el.closest) {
        const dayElement = arg.el.closest('.fc-daygrid-day');
        if (dayElement) {
          const existingEvents = dayElement.querySelectorAll('.fc-event');
          const currentEventIndex = Array.from(existingEvents).indexOf(arg.el);
          
          // 최대 3개까지만 표시, 나머지는 "more" 표시
          const MAX = 3;
          if (currentEventIndex >= MAX) {
            const moreSpan = document.createElement("span");
            const hidden = Math.max(0, existingEvents.length - MAX);
            moreSpan.textContent = `+${hidden} more`;
            moreSpan.style.color = "#666";
            moreSpan.style.fontSize = "11px";
            moreSpan.style.fontStyle = "italic";
            return { domNodes: [moreSpan] };
          }
        }
      }
      
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
          // 다른 모달이 열려있으면 먼저 닫기
          setShowLifestyleModal(false);
          setTaskInputMode(UI_CONSTANTS.TASK_INPUT_MODES.CHATBOT);
          setShowTaskModal(true);
        }}
        onPencilClick={() => {
          // 다른 모달이 열려있으면 먼저 닫기
          setShowTaskModal(false);
          setShowLifestyleModal(true);
        }}
        onAdviceClick={fetchAIAdvice}
        onReportClick={() => window.location.href = '/report'}
        onResetClick={handleResetCalendar}
      />

      <Modals
        // Task Modal Props
        showTaskModal={showTaskModal}
        setShowTaskModal={handleCloseTaskModal}
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
        onTaskFormSubmit={handleTaskSubmit}
        isEditing={editingTaskId !== null}
        
        // Lifestyle Modal Props
        showLifestyleModal={showLifestyleModal}
        setShowLifestyleModal={setShowLifestyleModal}
        lifestyleList={lifestyleList}
        lifestyleInput={lifestyleInput}
        setLifestyleInput={setLifestyleInput}
        isClearing={isClearing}
        onAddLifestyle={handleAddLifestyle}
        onDeleteLifestyle={handleDeleteLifestyle}
        onClearAllLifestyles={handleClearAllLifestyles}
        onLifestyleImageUpload={handleLifestyleImageUpload}
        onLifestyleVoiceRecording={handleLifestyleVoiceRecording}
        onSaveLifestyleAndRegenerate={handleSaveAndGenerate}
        
        // Task Management Modal Props
        showTaskManagementModal={showTaskManagementModal}
        setShowTaskManagementModal={setShowTaskManagementModal}
        onEditTask={handleEditTask}
        onSaveAndRegenerate={handleTaskManagementSave}
        onTaskRefresh={() => {
          // 할 일 새로고침 로직은 TaskManagementModal 내부에서 처리
        }}
      />
    </div>
  );
}

export default CalendarPage;