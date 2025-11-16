// CalendarPageRefactored.jsx :: 앱의 메인 페이지
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useScheduleData } from '../hooks/useScheduleData';
import { useLifestyleManagement } from '../hooks/useLifestyleManagement';
import { useTaskManagement } from '../hooks/useTaskManagement';
import { useFeedbackManagement } from '../hooks/useFeedbackManagement';
import { useAuth } from '../contexts/AuthContext';

// 서비스 & 유틸리티
import apiService from '../services/apiService';
import firestoreService from '../services/firestoreService';
import FriendsTab from '../components/Friends/FriendsTab';
import FriendScheduleModal from '../components/Friends/FriendScheduleModal';
import { UI_CONSTANTS } from '../constants/ui';
import { 
  buildShedAIPrompt,
  buildFeedbackPrompt,
  buildScheduleMessages,
  buildTasksForAI,
  parseTaskFromFreeText,
  postprocessSchedule,
  dedupeActivitiesByTitleTime,
  convertScheduleToEvents,
  getGptDayIndex,
  convertToRelativeDay as convertToRelativeDayFromScheduleUtils
} from '../utils/scheduleUtils';
import { endsWithAppointmentCommand, extractAppointmentTitle } from '../utils/appointmentRules';
import { parseLifestyleLines } from '../utils/lifestyleParse';
import { 
  resetToStartOfDay,
  parseDateString,
  convertToRelativeDay,
  toYMDLocal
} from '../utils/dateUtils';
import { toISODateLocal, toKoreanDate, toLocalMidnightDate } from '../utils/dateNormalize';
import { serverTimestamp } from 'firebase/firestore';
import '../styles/calendar.css';
import '../styles/floating.css';

// === 공통 스케줄 생성 파이프라인(단일화) ==========================
async function generateAndApplySchedule({
  generateScheduleAPI,
  calendarApi,
  userId,
  today,
  conversationContext,
  parsedLifestylePatterns,
  lifestylePatternsOriginal,  // 원본 텍스트 배열 추가
  messagesBasePrompt,
  tasksForAI,
  updateSchedule,
  setAllEvents,  // ✅ 추가: FullCalendar 이벤트 업데이트용
}) {
  const messages = buildScheduleMessages({
    basePrompt: messagesBasePrompt,
    conversationContext,
    existingTasksForAI: tasksForAI.existingTasksForAI,
    taskText: tasksForAI.taskText,
  });

  const apiResp = await generateScheduleAPI(
    messages,
    parsedLifestylePatterns,
    tasksForAI.existingTasksForAI,
    { 
      userId, 
      sessionId: `sess_${userId || 'anon'}`,
      ...(lifestylePatternsOriginal ? { lifestylePatternsOriginal } : {})  // 원본 텍스트 배열 전달
    }
  );
  
  const normalized = apiResp?.schedule ? apiResp : { schedule: apiResp };
  const baseProcessed = postprocessSchedule({
    raw: normalized.schedule,
    existingTasksForAI: tasksForAI.existingTasksForAI,
    today,
  });

  const schedule = baseProcessed; // AI가 생성한 스케줄 그대로 사용

  // 🔥 실제 캘린더 반영
  calendarApi?.removeAllEvents();
  updateSchedule({ schedule });

  // ✅ FullCalendar 이벤트 업데이트 (runSchedule 경로에서도 캘린더 UI가 갱신되도록)
  if (setAllEvents) {
    const events = convertScheduleToEvents(schedule, today);
    setAllEvents(events);
  }

  // 세션 저장은 호출하는 쪽에서 처리
  // AI 응답 전체를 반환하여 activityAnalysis도 함께 전달
  return { schedule, apiResp };
}
// ================================================================

// 세션 저장 헬퍼 (기존 saveScheduleSessionUnified 유지)
const saveScheduleSessionUnified = async ({
  uid,
  schedule,
  lifestyleList,
  aiPrompt,
  conversationContext,
  activityAnalysis = {}, // AI가 생성한 activityAnalysis를 전달받음
  isManualEdit = false // 수동 수정 여부 플래그
}) => {
  // lifestyleList는 원본 텍스트 문자열 배열이어야 함 (AI가 직접 파싱하도록)
  // 파싱된 형식(예: "7 09:00-18:00 브런치")이 아닌 원본 텍스트(예: "일요일 오후 12시 브런치")를 저장해야 함
  const lifestyleContextForSave = Array.isArray(lifestyleList) 
    ? lifestyleList.map(pattern => {
        // 문자열이면 그대로 사용 (원본 텍스트여야 함)
        if (typeof pattern === 'string') {
          return pattern; 
        }
        // 객체인 경우는 원본 텍스트가 없으므로 변환 (하지만 이 경우는 피해야 함)
        if (pattern && typeof pattern === 'object') {
          // patternText가 있으면 원본 텍스트 사용
          if (pattern.patternText) {
            return pattern.patternText;
          }
          // 원본 텍스트가 없으면 경고하고 변환 (이 경우는 피해야 함)
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

  // AI가 생성한 activityAnalysis가 없으면 클라이언트에서 계산 (fallback)
  let finalActivityAnalysis = activityAnalysis;
  if (!activityAnalysis || Object.keys(activityAnalysis).length === 0) {
    if (Array.isArray(schedule) && schedule.length > 0) {
      const { computeActivityMix } = await import('../utils/activityMix');
      const { normalizeCategoryName } = await import('../utils/categoryAlias');
      const { inferCategory } = await import('../utils/categoryClassifier');
      
      // 카테고리 누락 시 제목/타입 기반으로 즉석 분류 → 정규화
      const normalizedSchedule = schedule.map(day => ({
        ...day,
        activities: (day.activities || []).map(activity => {
          const raw = activity.category || inferCategory(activity);
          return { ...activity, category: normalizeCategoryName(raw) };
        })
      }));
      
      const mixResult = computeActivityMix(normalizedSchedule);
      finalActivityAnalysis = mixResult.byCategory;
    }
  }

  const data = {
    scheduleData: schedule,
    hasSchedule: true,
    isActive: true,
    lifestyleContext: lifestyleContextForSave,
    aiPromptPreview: promptPreview,
    conversationContext: Array.isArray(conversationContext) ? conversationContext.slice(-8) : [],
    activityAnalysis: finalActivityAnalysis, // AI가 생성한 것 우선, 없으면 클라이언트 계산
    isManualEdit: isManualEdit, // 수동 수정 여부 저장
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  return await firestoreService.saveScheduleSession(uid, data);
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

const normTitle = (s='') => s.replace(/\s+/g, ' ').trim();

function CalendarPage() {
  const calendarRef = useRef(null);
  const sessionIdRef = useRef(null);
  const previousViewRef = useRef(null); // 이전 뷰를 기억하기 위한 ref
  const today = resetToStartOfDay(new Date());
  const navigate = useNavigate();
  const { user, googleCalendarAccessToken, getGoogleCalendarAccessToken } = useAuth();
  const { 
    allEvents, 
    setAllEvents, 
    lastSchedule, 
    setLastSchedule,
    updateSchedule,
    loadUserData
  } = useScheduleData();
  const { 
    lifestyleList, 
    lifestyleInput, 
    setLifestyleInput,
    isClearing,
    handleAddLifestyle,
    handleDeleteLifestyle,
    handleClearAllLifestyles,
    handleSaveAndGenerateSchedule
  } = useLifestyleManagement();
  const { taskForm, setTaskForm, handleTaskFormSubmit } = useTaskManagement();
  const { handleSubmitFeedbackMessage } = useFeedbackManagement();

  // sessionIdRef 설정
  useEffect(() => {
    if (user?.uid) {
      sessionIdRef.current = getOrCreateSessionId(user.uid);
    }
  }, [user?.uid]);


  // 할 일 자동 저장 (allEvents 변경 시) - 디바운스 적용
  useEffect(() => {
    const saveTasksFromEvents = async () => {
      if (!user?.uid || !allEvents || allEvents.length === 0) return;
      
      try {
        const taskEvents = allEvents.filter(event => {
          const t = (event.extendedProps?.type || '').toLowerCase();
          return event.start && t !== 'lifestyle' && event.extendedProps?.persistAsTask === true;
        });
        
        if (taskEvents.length === 0) return;
        const existingTasks = await firestoreService.getAllTasks(user.uid);
        
        const newTasks = taskEvents
          .filter(event => {
            const startIso = toISODateLocal(event.start);
            if (!startIso) return false;
            
            const start = new Date(event.start);
            const localDate = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
            const localTime = `${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}`;
            const key = `${normTitle(event.title)}__${localDate}T${localTime}`;
            
            return !existingTasks.some(t => {
              const existingDate = toISODateLocal(t.deadline);
              const timePart = (t.deadlineTime ? t.deadlineTime.slice(0,5) : '00:00');
              const existingTimeKey = `${existingDate}T${timePart}`;
              const existingKey = `${normTitle(t.title)}__${existingTimeKey}`;
              return existingKey === key;
            });
          })
          .map(event => {
            const startIso = toISODateLocal(event.start);
            const localMidnight = toLocalMidnightDate(new Date(startIso));
            return {
              title: event.title,
              deadline: toYMDLocal(localMidnight),
              importance: event.extendedProps?.importance ?? '중',
              difficulty: event.extendedProps?.difficulty ?? '중',
              description: event.extendedProps?.description ?? '',
              isActive: true,
              persistAsTask: true,
              createdAt: serverTimestamp()
            };
          })
          .filter(t => t.deadline);
        
        if (newTasks.length > 0) {
          try {
            await Promise.all(newTasks.map(task => firestoreService.saveTask(user.uid, task)));
          } catch (err) {
            console.error('[CalendarPage] 할 일 저장 중 오류:', err);
          }
        }
      } catch (error) {
        console.error('[CalendarPage] 할 일 저장 실패:', error);
      }
    };

    const id = setTimeout(saveTasksFromEvents, 350);
    return () => clearTimeout(id);
  }, [allEvents, user?.uid]);
  
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
  const [showFeedbackManagementModal, setShowFeedbackManagementModal] = useState(false);
  const [currentScheduleSessionId, setCurrentScheduleSessionId] = useState(null);
  const [chatbotMode, setChatbotMode] = useState(UI_CONSTANTS.CHATBOT_MODES.TASK);
  const [taskInputMode, setTaskInputMode] = useState(UI_CONSTANTS.TASK_INPUT_MODES.CHATBOT);
  const [editingTaskId, setEditingTaskId] = useState(null); // 수정 중인 할 일 ID
  const [currentView, setCurrentView] = useState('dayGridMonth'); // 현재 캘린더 뷰
  
  // 친구 관련 상태
  const [selectedFriend, setSelectedFriend] = useState(null); // 선택된 친구 정보
  const [friendEvents, setFriendEvents] = useState([]); // 친구 일정 이벤트
  const [loadingFriendSchedule, setLoadingFriendSchedule] = useState(false);
  const [friendModalOpen, setFriendModalOpen] = useState(false); // 친구 일정 모달 열림 상태
  const [friendsTabOpen, setFriendsTabOpen] = useState(false); // 친구 탭 열림/닫힘 상태

  // 로딩 시작 시 공통 처리 함수
  const startLoading = useCallback(() => {
    setShowTaskModal(false);            // 모든 모달 닫기
    setShowLifestyleModal(false);
    setShowTaskManagementModal(false);
    
    window.scrollTo({ top: 0, behavior: 'smooth' }); // 화면 맨 위로 스크롤    
    setIsLoading(true); // 로딩 상태 시작
  }, [setIsLoading]);

  // === 단일 진입점: 스케줄 생성 =================================
  const runSchedule = useCallback(async (promptBase, parsedLifestylePatterns) => {
    if (!user?.uid) { addAIMessage("로그인이 필요합니다."); return; }
    startLoading();
    try {
      // 원본 텍스트 가져오기 (lifestylePatterns 테이블에서)
      const savedLifestylePatterns = await firestoreService.getLifestylePatterns(user.uid);
      const lifestylePatternsOriginal = Array.isArray(savedLifestylePatterns) && typeof savedLifestylePatterns[0] === 'string'
        ? savedLifestylePatterns  // 원본 텍스트 배열
        : savedLifestylePatterns.map(p => 
            typeof p === 'string' ? p : `${p.title} (${p.start}-${p.end}, 요일: ${p.days?.join(', ') || '미정'})`
          );
      
      const USE_FIRESTORE = String(process.env.REACT_APP_USE_FIRESTORE || 'true') === 'true';
      const tasksForAI = await buildTasksForAI(
        user.uid,
        USE_FIRESTORE ? firestoreService : null,
        { fetchLocalTasks: (window?.shedAI && window.shedAI.fetchLocalTasks) ? window.shedAI.fetchLocalTasks : null }
      );
      const { schedule, apiResp } = await generateAndApplySchedule({
        generateScheduleAPI: generateSchedule,
        calendarApi: calendarRef.current?.getApi(),
        userId: user.uid,
        today,
        conversationContext,
        parsedLifestylePatterns,
        lifestylePatternsOriginal: lifestylePatternsOriginal,  // 원본 텍스트 배열 전달
        messagesBasePrompt: promptBase,
        tasksForAI,
        updateSchedule,
        setAllEvents,  // ✅ 추가: FullCalendar 이벤트 업데이트용
      });
      
      await saveScheduleSessionUnified({
        uid: user.uid,
        schedule,
        lifestyleList: lifestylePatternsOriginal,  // ✅ 수정: 원본 텍스트로 저장 (파싱된 형식이 아님)
        aiPrompt: promptBase,
        conversationContext,
        activityAnalysis: apiResp?.activityAnalysis || {} // AI가 생성한 activityAnalysis 전달
      });
      
      setShowLifestyleModal(false);
      return schedule;
    } catch (e) {
      addAIMessage("스케줄 생성에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid, today, generateSchedule, updateSchedule, conversationContext, addAIMessage, startLoading, setIsLoading]);
  // ============================================================

  const handleScheduleGeneration = useCallback(async (prompt, message) => {
    if (!user?.uid) { addAIMessage("로그인이 필요합니다."); return; }
    addAIMessage(message);
    
    const patternsForAI = (Array.isArray(lifestyleList) && typeof lifestyleList[0] === 'string')
      ? lifestyleList
      : await firestoreService.getLifestylePatterns(user.uid);
    
    const parsedPatterns = Array.isArray(patternsForAI) && typeof patternsForAI[0] === 'string'
      ? parseLifestyleLines(patternsForAI.join('\n'))
      : patternsForAI;
    
    // 원본 텍스트는 runSchedule 내부에서 가져오므로 여기서는 전달하지 않음
    await runSchedule(prompt, parsedPatterns);
  }, [lifestyleList, addAIMessage, user?.uid, runSchedule]);

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
    startLoading();
    
    try {
      // 1. 생활패턴 저장
      await handleSaveAndGenerateSchedule();
      
      // 2. DB에서 모든 데이터 가져오기
      const [savedLifestylePatterns] = await Promise.all([
        firestoreService.getLifestylePatterns(user.uid)
      ]);
      
      // 생활패턴 파싱 및 정리
      const parsedPatterns = Array.isArray(savedLifestylePatterns) && typeof savedLifestylePatterns[0] === 'string'
        ? parseLifestyleLines(savedLifestylePatterns.join('\n'))
        : savedLifestylePatterns;
      
      // 원본 텍스트 추출 (서버에 전달하기 위해)
      const lifestylePatternsOriginal = Array.isArray(savedLifestylePatterns) && typeof savedLifestylePatterns[0] === 'string'
        ? savedLifestylePatterns  // 원본 텍스트 배열
        : savedLifestylePatterns.map(p => 
            typeof p === 'string' ? p : `${p.title} (${p.start}-${p.end}, 요일: ${p.days?.join(', ') || '미정'})`
        );
      
      const USE_FIRESTORE = String(process.env.REACT_APP_USE_FIRESTORE || 'true') === 'true';
      const { existingTasksForAI, taskText } = await buildTasksForAI(
        user.uid,
        USE_FIRESTORE ? firestoreService : null,
        { fetchLocalTasks: (window?.shedAI && window.shedAI.fetchLocalTasks) ? window.shedAI.fetchLocalTasks : null }
      );
      
      // 3. 생활패턴을 원본 텍스트로 사용 (AI가 직접 파싱하도록)
      const lifestyleText = lifestylePatternsOriginal.join("\n");
      
      
      // 5. 스케줄 생성 (직접 호출로 변경)
      // 수동으로 수정한 스케줄(isManualEdit: true)은 무시하고 완전히 새로 생성
      // ⚠️ 방어적 처리: lastSchedule이 객체({ schedule, isManualEdit })일 수도 배열일 수도 있음
      const lastScheduleData = Array.isArray(lastSchedule) ? lastSchedule : (lastSchedule?.schedule || lastSchedule);
      const shouldUseLastSchedule = lastScheduleData && !(lastSchedule?.isManualEdit);
      const promptBase = shouldUseLastSchedule 
        ? buildFeedbackPrompt(lifestyleText, taskText, lastScheduleData, existingTasksForAI)
        : buildShedAIPrompt(lifestyleText, taskText, today, existingTasksForAI);
      
      // 공통 메시지 빌더 사용 (컨텍스트 초기화 모드)
      const scheduleMessages = buildScheduleMessages({
        basePrompt: promptBase,
        conversationContext: [], // 컨텍스트 초기화 모드
        existingTasksForAI,
        taskText
      });
      
      const sessionId = getOrCreateSessionId(user.uid);
      const apiResp = await generateSchedule(
        scheduleMessages,
        parsedPatterns, 
        existingTasksForAI,
        { 
          userId: user.uid, 
          sessionId,
          lifestylePatternsOriginal: lifestylePatternsOriginal  // 원본 텍스트 배열 전달
        }
      );
      
      // 응답 통일: 배열/객체 모두 허용 (notes, explanation 등도 함께 보존)
      const normalized = apiResp?.schedule 
        ? apiResp 
        : { 
            schedule: apiResp,
            notes: apiResp?.notes,
            explanation: apiResp?.explanation,
            taxonomy: apiResp?.taxonomy,
            activityAnalysis: apiResp?.activityAnalysis,
            unplaced: apiResp?.unplaced
          };
      
      const processedSchedule = postprocessSchedule({
        raw: normalized.schedule,
        existingTasksForAI,
        today,
      });
      
      let withTasks = processedSchedule;
      // 디듀프 안전망
      withTasks = withTasks.map(day => ({
        ...day,
        activities: dedupeActivitiesByTitleTime(day.activities)
          .sort((a,b)=>{
            const toMin=(s)=>{ const [h,m]=String(s||'0:0').split(':').map(x=>parseInt(x||'0',10)); return (isNaN(h)?0:h)*60+(isNaN(m)?0:m); };
            return toMin(a.start||'00:00')-toMin(b.start||'00:00');
          })
      }));
      
      const api = calendarRef.current?.getApi();
      api?.removeAllEvents();
      updateSchedule({ schedule: withTasks });
      
      // 스케줄을 캘린더 이벤트로 변환하여 렌더링
      const events = convertScheduleToEvents(withTasks, today);
      setAllEvents(events);
      
      addAIMessage("스케줄 생성이 완료되었습니다!");
      alert('스케줄이 생성되었습니다!');
      
      const hasExplanation = normalized?.explanation && String(normalized.explanation).trim();
      const hasNotes = normalized?.notes && (
        (Array.isArray(normalized.notes) && normalized.notes.length > 0) ||
        (typeof normalized.notes === 'string' && normalized.notes.trim())
      );
      
      if (hasExplanation) {
        const explanationText = String(normalized.explanation).replace(/\n/g, "<br>");
        addAIMessage(`스케줄 설계 이유:<br>${explanationText}`, null, true);
      } else if (hasNotes) {
        const notesText = Array.isArray(normalized.notes)
          ? normalized.notes.join("<br>")
          : String(normalized.notes).replace(/\n/g, "<br>");
        addAIMessage(`스케줄 설계 이유:<br>${notesText}`, null, true);
      }

      // lifestyleContext에 저장할 때는 원본 텍스트(savedLifestylePatterns)를 사용해야 함
      // parsedPatterns는 파싱된 형식이므로 사용하지 않음
      const scheduleSessionId = await saveScheduleSessionUnified({
        uid: user.uid,
        schedule: withTasks,
        lifestyleList: savedLifestylePatterns, // ✅ 원본 텍스트 저장 (파싱된 형식이 아님)
        aiPrompt: promptBase,
        conversationContext,
        activityAnalysis: apiResp?.activityAnalysis || {} // AI가 생성한 activityAnalysis 전달
      });
      
      // 안전한 세션 ID 설정
      if (scheduleSessionId && typeof scheduleSessionId === 'string') {
        setCurrentScheduleSessionId(scheduleSessionId);
      }
      
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || '알 수 없는 오류가 발생했습니다.';
      addAIMessage('저장 및 스케줄 생성에 실패했습니다: ' + errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [lifestyleList, lastSchedule, today, handleSaveAndGenerateSchedule, setIsLoading, user?.uid, generateSchedule, addAIMessage, startLoading]);

  // 할 일 관리창 저장 함수 (DB에서 모든 데이터 가져와서 스케줄 재생성)
  const handleTaskManagementSave = useCallback(async () => {
    if (!user?.uid) { addAIMessage("로그인이 필요합니다."); return; }
    startLoading();
    
    try {
      const [savedLifestylePatterns] = await Promise.all([
        firestoreService.getLifestylePatterns(user.uid)
      ]);
      
      const parsedPatterns = Array.isArray(savedLifestylePatterns) && typeof savedLifestylePatterns[0] === 'string'
        ? parseLifestyleLines(savedLifestylePatterns.join('\n'))
        : savedLifestylePatterns;
      
      // 원본 텍스트 추출 (서버에 전달하기 위해)
      const lifestylePatternsOriginal = Array.isArray(savedLifestylePatterns) && typeof savedLifestylePatterns[0] === 'string'
        ? savedLifestylePatterns  // 원본 텍스트 배열
        : savedLifestylePatterns.map(p => 
            typeof p === 'string' ? p : `${p.title} (${p.start}-${p.end}, 요일: ${p.days?.join(', ') || '미정'})`
        );
      
      const USE_FIRESTORE = String(process.env.REACT_APP_USE_FIRESTORE || 'true') === 'true';
      const { existingTasksForAI, taskText } = await buildTasksForAI(
        user.uid,
        USE_FIRESTORE ? firestoreService : null,
        { fetchLocalTasks: (window?.shedAI && window.shedAI.fetchLocalTasks) ? window.shedAI.fetchLocalTasks : null }
      );
      
      // 원본 텍스트를 그대로 사용하여 AI가 직접 파싱하도록 함
      const lifestyleText = lifestylePatternsOriginal.join("\n");
      
      // 수동으로 수정한 스케줄(isManualEdit: true)은 무시하고 완전히 새로 생성
      // ⚠️ 방어적 처리: lastSchedule이 객체({ schedule, isManualEdit })일 수도 배열일 수도 있음
      const lastScheduleData = Array.isArray(lastSchedule) ? lastSchedule : (lastSchedule?.schedule || lastSchedule);
      const shouldUseLastSchedule = lastScheduleData && !(lastSchedule?.isManualEdit);
      const promptBase = shouldUseLastSchedule 
        ? buildFeedbackPrompt(lifestyleText, taskText, lastScheduleData, existingTasksForAI)
        : buildShedAIPrompt(lifestyleText, taskText, today, existingTasksForAI);
      
      addAIMessage("DB 데이터를 기반으로 스케줄을 재생성합니다...");
      
      try {
        const scheduleMessages = buildScheduleMessages({
          basePrompt: promptBase,
          conversationContext: [], 
          existingTasksForAI,
          taskText
        });
        
        const apiResp = await generateSchedule(
          scheduleMessages,
          parsedPatterns, 
          existingTasksForAI,                       
          {
            userId: user.uid,
            sessionId: getOrCreateSessionId(user.uid),
            lifestylePatternsOriginal: lifestylePatternsOriginal,  // 원본 텍스트 배열 전달
            nowOverride: toYMDLocal(new Date()) + 'T00:00:00',
            anchorDay: today.getDay() === 0 ? 7 : today.getDay()
          }
        );
        const normalized = apiResp?.schedule ? apiResp : { schedule: apiResp };
        const processedSchedule = postprocessSchedule({
          raw: normalized.schedule,
          existingTasksForAI,
          today,
        });
        
        const api = calendarRef.current?.getApi();
        api?.removeAllEvents();
        updateSchedule({ schedule: processedSchedule });
        
        // 스케줄을 캘린더 이벤트로 변환하여 렌더링
        const events = convertScheduleToEvents(processedSchedule, today);
        setAllEvents(events);
        
        // ⚠️ 수정: lifestyleList는 원본 텍스트 배열로 저장 (파싱된 형식이 아님)
        const lifestylePatternsOriginalForSave = Array.isArray(savedLifestylePatterns) && typeof savedLifestylePatterns[0] === 'string'
          ? savedLifestylePatterns  // 원본 텍스트 배열
          : savedLifestylePatterns.map(p => 
              typeof p === 'string' ? p : `${p.title} (${p.start}-${p.end}, 요일: ${p.days?.join(', ') || '미정'})`
            );
        
        const scheduleSessionId = await saveScheduleSessionUnified({
          uid: user.uid,
          schedule: processedSchedule,
          lifestyleList: lifestylePatternsOriginalForSave, // ✅ 원본 텍스트 저장
          aiPrompt: promptBase,                          
          conversationContext,
          activityAnalysis: apiResp?.activityAnalysis || {} // AI가 생성한 activityAnalysis 전달
        });
        
        if (scheduleSessionId && typeof scheduleSessionId === 'string') {
          setCurrentScheduleSessionId(scheduleSessionId);
        }
      } catch (error) {
        addAIMessage("스케줄 생성에 실패했습니다. 다시 시도해주세요.");
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || '알 수 없는 오류가 발생했습니다.';
      addAIMessage('스케줄 재생성에 실패했습니다: ' + errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [lastSchedule, today, setIsLoading, user?.uid, generateSchedule, addAIMessage, startLoading]);

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
          deadline: toYMDLocal(toLocalMidnightDate(taskForm.deadline)), 
          importance: taskForm.importance,
          difficulty: taskForm.difficulty,
          description: taskForm.description || '',
          persistAsTask: true           
        };
        
        await firestoreService.updateTask(user.uid, editingTaskId, taskData);
        
        // 수정 완료 후 모달 닫기
        setShowTaskModal(false);
        setEditingTaskId(null);
        
        addAIMessage('할 일이 수정되었습니다. 스케줄을 다시 생성합니다.');
        
        // 수정된 할 일로 스케줄 재생성
        const deadlineDateKR = toKoreanDate(toISODateLocal(taskForm.deadline)); 
        const updatedTaskMessage = `할 일이 수정되었습니다: ${taskData.title} (마감일: ${deadlineDateKR}, 중요도: ${taskData.importance}, 난이도: ${taskData.difficulty})`;
        addUserMessage(updatedTaskMessage, []);
        
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
    handleSubmitFeedbackMessage(currentMessage, async (messageText, analysis, advice) => {
      if (analysis) {
        addAIMessage(`피드백 분석: ${analysis}`);
      }
      
      if (advice && advice.length > 0) {
        const adviceText = advice.map(item => 
          `${item.title || '조언'}: ${item.content}`
        ).join('\n');
        addAIMessage(adviceText);
      }
      
      addAIMessage("피드백을 반영하여 스케줄을 조정합니다...");
      
      try {
        // 1) 생활패턴 원본 텍스트
        const lifestyleText = lifestyleList.join("\n");
        
        // 2) 최신 할 일 목록 불러오기 (다른 경로와 동일하게)
        const USE_FIRESTORE = String(process.env.REACT_APP_USE_FIRESTORE || 'true') === 'true';
        const { existingTasksForAI, taskText } = await buildTasksForAI(
          user?.uid,
          USE_FIRESTORE ? firestoreService : null,
          { fetchLocalTasks: (window?.shedAI && window.shedAI.fetchLocalTasks) ? window.shedAI.fetchLocalTasks : null }
        );
        
        // 3) 직전 스케줄 (방어적 처리)
        const lastScheduleData = Array.isArray(lastSchedule) 
          ? lastSchedule 
          : (lastSchedule?.schedule || lastSchedule);
        const shouldUseLastSchedule = lastScheduleData && !(lastSchedule?.isManualEdit);
        
        // 4) 피드백 프롬프트 생성: taskText는 할 일 목록, messageText는 피드백으로 별도 전달
        const feedbackPrompt = shouldUseLastSchedule 
          ? buildFeedbackPrompt(
              lifestyleText,
              taskText,              // ✅ 할 일 목록 (피드백이 아님)
              lastScheduleData,
              existingTasksForAI,
              messageText            // ✅ 피드백 텍스트 (별도 인자)
            )
          : buildShedAIPrompt(
              lifestyleText,
              taskText,              // ✅ 할 일 목록
              today,
              existingTasksForAI,
              messageText            // ✅ 피드백 텍스트 (새로 생성할 때도 반영)
            );
        
        // 5) 스케줄 생성
        handleScheduleGeneration(feedbackPrompt, "피드백을 반영하여 스케줄을 조정합니다...");
      } catch (error) {
        console.error('[handleFeedbackSubmit] 피드백 처리 중 오류:', error);
        addAIMessage('피드백 반영 중 오류가 발생했습니다. 다시 시도해주세요.');
      }
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
          if (!parsed || !parsed.date) return match;
    
          const day = convertToRelativeDay(parsed.date, today);
          return `${match} (day:${day})`;
        });
      }
    
      return processed;
    };
    
    const processedMessage = preprocessKoreanRelativeDates(messageText);
    
    try {
      const parsed = parseTaskFromFreeText(messageText, today);
      if (parsed) {
        if (user?.uid) {
          // 제목 정리: 꼬리 제거 및 간단화
          const cleanTitle = (() => {
            let t = (parsed.title || messageText || '').trim();
            t = t
              .replace(/일정\s*(?:좀|좀만)?\s*추가해줘\.?$/i, '')
              .replace(/일정\s*(?:좀|좀만)?\s*넣어줘\.?$/i, '')
              .replace(/일정\s*잡아줘\.?$/i, '')
              .replace(/추가해줘\.?$/i, '')
              .replace(/해줘\.?$/i, '')
              .replace(/\s+/g, ' ')
              .trim();
            t = t.replace(/(일정)$/i, '').trim();
            if (t.length > 30) {
              const m = t.match(/([가-힣A-Za-z0-9]+)(?:\s|$)/);
              if (m) t = m[1];
            }
            return t || '회의';
          })();
          const isApptCmd = endsWithAppointmentCommand(messageText);
          if (isApptCmd) {
            parsed.type = 'appointment';
            parsed.title = extractAppointmentTitle(messageText);
            parsed.estimatedMinutes = parsed.estimatedMinutes ?? 60;
          } else {
            parsed.type = 'task';
          }
          await firestoreService.saveTask(user.uid, {
            title: cleanTitle,
            deadline: toYMDLocal(toLocalMidnightDate(parsed.deadlineAtMidnight)),
            importance: parsed.importance,
            difficulty: parsed.difficulty,
            description: parsed.description,
            isActive: true,
            persistAsTask: true,            
            deadlineTime: parsed.deadlineTime || null,
            type: parsed.type,
            estimatedMinutes: parsed.estimatedMinutes ?? 120,
            createdAt: serverTimestamp()
          });
          addAIMessage(`새 할 일을 저장했어요: ${cleanTitle} (마감일: ${parsed.deadlineAtMidnight.toLocaleDateString('ko-KR')}, 중요도 ${parsed.importance}, 난이도 ${parsed.difficulty})`);
        } else {
          const iso = toYMDLocal(parsed.deadlineAtMidnight);
          const isApptLocal = endsWithAppointmentCommand(messageText);
          const temp = {
            id: 'temp_' + Date.now(),
            title: (parsed.title || '').replace(/일정$/i,'').trim(),
            deadline: iso,
            deadlineTime: parsed.deadlineTime || null,
            type: isApptLocal ? 'appointment' : 'task',
            importance: parsed.importance,
            difficulty: parsed.difficulty,
            description: parsed.description,
            isActive: true,
            persistAsTask: true,            
            estimatedMinutes: parsed.estimatedMinutes ?? (isApptLocal ? 60 : 120),  
            createdAt: new Date().toISOString(),
            isLocal: true
          };
          const existing = JSON.parse(localStorage.getItem('shedAI:tempTasks') || '[]');
          existing.push(temp);
          localStorage.setItem('shedAI:tempTasks', JSON.stringify(existing));
          addAIMessage(`새 할 일을 임시 저장했어요: ${parsed.title} (마감일: ${parsed.deadlineAtMidnight.toLocaleDateString('ko-KR')}, 중요도 ${parsed.importance}, 난이도 ${parsed.difficulty})`);
        }
      }
    } catch (e) {
      console.error('[ChatTask] 채팅 태스크 파싱/저장 중 오류:', e?.message || e);
    }

    startLoading();
    addAIMessage("스케줄을 생성하는 중입니다...");
    
    // 생활패턴을 원본 텍스트로 사용 (AI가 직접 파싱하도록)
    let lifestyleText = '';
    let patternsForAI = [];
    let lifestylePatternsOriginal = [];
    
    if (Array.isArray(lifestyleList) && typeof lifestyleList[0] === 'string') {
      lifestyleText = lifestyleList.join('\n');
      lifestylePatternsOriginal = lifestyleList;  // 원본 텍스트 배열
      patternsForAI = parseLifestyleLines(lifestyleText);
    } else {
      const lifestylePatternsForAI = await firestoreService.getLifestylePatterns(user.uid);
      
      if (Array.isArray(lifestylePatternsForAI) && typeof lifestylePatternsForAI[0] === 'string') {
        lifestyleText = lifestylePatternsForAI.join('\n');
        lifestylePatternsOriginal = lifestylePatternsForAI;  // 원본 텍스트 배열
        patternsForAI = parseLifestyleLines(lifestyleText);
      } else {
        patternsForAI = lifestylePatternsForAI;
        lifestylePatternsOriginal = lifestylePatternsForAI.map(p => 
          typeof p === 'string' ? p : `${p.title} (${p.start}-${p.end}, 요일: ${p.days?.join(', ') || '미정'})`
        );
        lifestyleText = lifestylePatternsOriginal.join('\n');
      }
    }
    
    // 현재 할 일 목록을 프롬프트에 직접 주입
    const USE_FIRESTORE = String(process.env.REACT_APP_USE_FIRESTORE || 'true') === 'true';
    const { existingTasksForAI, taskText } = await buildTasksForAI(
      user?.uid,
      USE_FIRESTORE ? firestoreService : null,
      { fetchLocalTasks: (window?.shedAI && window.shedAI.fetchLocalTasks) ? window.shedAI.fetchLocalTasks : null }
    );

    // promptBase 생성 (lastSchedule이 있으면 피드백 프롬프트, 없으면 새 스케줄 프롬프트)
    // 단, 수동으로 수정한 스케줄(isManualEdit: true)은 무시하고 완전히 새로 생성
    const lastScheduleFromDB = user?.uid ? await firestoreService.getLastSchedule(user.uid) : null;
    // ⚠️ 방어적 처리: lastScheduleFromDB가 객체({ scheduleData, isManualEdit })일 수도 배열일 수도 있음
    const lastScheduleData = Array.isArray(lastScheduleFromDB) 
      ? lastScheduleFromDB 
      : (lastScheduleFromDB?.scheduleData || lastScheduleFromDB?.schedule || lastScheduleFromDB);
    const shouldUseLastSchedule = lastScheduleData && !(lastScheduleFromDB?.isManualEdit);
    const promptBase = shouldUseLastSchedule 
      ? buildFeedbackPrompt(lifestyleText, taskText, lastScheduleData, existingTasksForAI)
      : buildShedAIPrompt(lifestyleText, taskText, today, existingTasksForAI);

    let timeoutId;
    let controller;
    try {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 360000); // 360초 (6분) - 서버 타임아웃(5.5분)보다 여유있게 설정
      
      // 공통 메시지 빌더 사용
      const messagesForAPI = buildScheduleMessages({
        basePrompt: promptBase,
        conversationContext,
        existingTasksForAI,
        taskText
      });

      const sessionId = getOrCreateSessionId(user?.uid);
      const apiResp = await apiService.generateSchedule(
        messagesForAPI,          
        patternsForAI,            
        existingTasksForAI,       
        { 
          userId: user?.uid ?? 'anon', 
          sessionId,
          lifestylePatternsOriginal: lifestylePatternsOriginal,  // 원본 텍스트 배열 전달
          promptContext: `${promptBase}\n\n[현재 할 일 목록]\n${taskText || '할 일 없음'}`,  
          signal: controller.signal  
        }
      );
      
      // 응답 통일: 배열/객체 모두 허용 (notes, explanation 등도 함께 보존)
      const newSchedule = apiResp?.schedule 
        ? apiResp 
        : { 
            schedule: apiResp,
            notes: apiResp?.notes,
            explanation: apiResp?.explanation,
            taxonomy: apiResp?.taxonomy,
            activityAnalysis: apiResp?.activityAnalysis,
            unplaced: apiResp?.unplaced
          };
      
      clearTimeout(timeoutId);

      let finalSchedule = newSchedule.schedule;

      const nextBase = postprocessSchedule({
        raw: finalSchedule,
        existingTasksForAI,
        today,
      });

      let next = nextBase; // AI가 생성한 스케줄 그대로 사용
      next = next.map(day => ({
        ...day,
        activities: dedupeActivitiesByTitleTime(day.activities)
          .sort((a,b)=>{
            const toMin=(s)=>{ const [h,m]=String(s||'0:0').split(':').map(x=>parseInt(x||'0',10)); return (isNaN(h)?0:h)*60+(isNaN(m)?0:m); };
            return toMin(a.start||'00:00')-toMin(b.start||'00:00');
          })
      }));

      // 스케줄 갱신 전 기존 이벤트 완전 교체 (마감 초과 이벤트 제거)
      const api = calendarRef.current?.getApi();
      api?.removeAllEvents();
      updateSchedule({ schedule: next });
      
      // 스케줄을 캘린더 이벤트로 변환하여 렌더링
      const events = convertScheduleToEvents(next, today);
      setAllEvents(events);

      // ⚠️ 수정: lifestyleList는 원본 텍스트 배열로 저장 (파싱된 형식이 아님)
      // patternsForAI는 파싱된 형식이므로, 원본 텍스트를 다시 가져와야 함
      const lifestylePatternsOriginalForSave = Array.isArray(lifestylePatternsOriginal) && typeof lifestylePatternsOriginal[0] === 'string'
        ? lifestylePatternsOriginal  // 원본 텍스트 배열
        : lifestylePatternsOriginal.map(p => 
            typeof p === 'string' ? p : `${p.title} (${p.start}-${p.end}, 요일: ${p.days?.join(', ') || '미정'})`
          );
      
      const scheduleSessionId = await saveScheduleSessionUnified({
        uid: user.uid,
        schedule: next,
        lifestyleList: lifestylePatternsOriginalForSave, // ✅ 원본 텍스트 저장
        aiPrompt: promptBase,                     
        conversationContext,
        activityAnalysis: newSchedule?.activityAnalysis || {} // AI가 생성한 activityAnalysis 전달
      });
      
      if (scheduleSessionId && typeof scheduleSessionId === 'string') {
        setCurrentScheduleSessionId(scheduleSessionId);
      }

      const calendarApi = calendarRef.current?.getApi();
      if (calendarApi) {
        const currentView = calendarApi.view.type;
        calendarApi.changeView(currentView);
      }
      
      // explanation 또는 notes 중 하나라도 있으면 표시
      addAIMessage("스케줄 생성이 완료되었습니다!");
      alert('스케줄이 생성되었습니다!');
      const hasExplanation = newSchedule?.explanation && String(newSchedule.explanation).trim();
      const hasNotes = newSchedule?.notes && (
        (Array.isArray(newSchedule.notes) && newSchedule.notes.length > 0) ||
        (typeof newSchedule.notes === 'string' && newSchedule.notes.trim())
      );
      
      if (hasExplanation) {
        const explanationText = String(newSchedule.explanation).replace(/\n/g, "<br>");
        addAIMessage(`스케줄 설계 이유:<br>${explanationText}`, null, true);
      } else if (hasNotes) {
        const notesText = Array.isArray(newSchedule.notes)
          ? newSchedule.notes.join("<br>")
          : String(newSchedule.notes).replace(/\n/g, "<br>");
        addAIMessage(`스케줄 설계 이유:<br>${notesText}`, null, true);
      }
    } catch (e) {
      try { controller?.abort(); } catch {}
      const aborted = e?.name === 'AbortError' || /aborted|signal/i.test(String(e));
      console.error('스케줄 생성 요청 실패:', e);
      addAIMessage(aborted ? "요청이 시간 초과되었습니다. 잠시 후 다시 시도해주세요." 
                           : "요청 실패: 다시 시도해주세요.");
    } finally {
      clearTimeout?.(timeoutId);
      setIsLoading(false);
      controller = undefined;
    }
  };

  // 캘린더 초기화 함수
  const handleResetCalendar = async () => {
    if (!user?.uid) return;
    if (window.confirm("모든 일정을 초기화하시겠습니까?")) {
      try {
        await firestoreService.deleteLatestSchedule(user.uid);
        try { localStorage.removeItem('shedAI:lastSchedule'); } catch {}
        
        setLastSchedule(null);
        setAllEvents([]);
        calendarRef.current?.getApi().removeAllEvents();
        clearMessages();
        setCurrentScheduleSessionId(null);
        
        // Firestore에서 최신 상태를 다시 로드하여 초기화 확인
        if (loadUserData) {
          await loadUserData();
        }
        
        // 초기화 완료 알림
        alert('캘린더가 초기화되었습니다.');
        addAIMessage("캘린더가 초기화되었습니다. 새로운 일정을 추가해주세요.");
      } catch (e) {
        alert('캘린더 초기화에 실패했습니다. 다시 시도해주세요.');
      }
    }
  };

  // AI 조언 조회
  const fetchAIAdvice = async () => {
    if (!user?.uid) { addAIMessage("로그인이 필요합니다."); return; }
    try {
      const result = await apiService.getAdvice({
        userId: user.uid,
        sessionId: sessionIdRef.current
      });
      
      if (result.advice && result.advice.length > 0) {
        const adviceText = result.advice.map(item => 
          `${item.title || '조언'}: ${item.content}`
        ).join('\n');
        
        let timestampText = '';
        if (result.timestamp || result.generatedAt) {
          const timestamp = result.timestamp || result.generatedAt;
          const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
          timestampText = `\n\n마지막 생성: ${date.toLocaleString('ko-KR', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit', 
            hour: '2-digit', 
            minute: '2-digit' 
          })}`;
        }
        
        addAIMessage(adviceText + timestampText);
      } else {
        addAIMessage("현재 제공할 AI 조언이 없습니다.");
      }
    } catch (error) {
      const errorMessage = error?.response?.data?.message || error?.message || '알 수 없는 오류가 발생했습니다.';
      console.error("AI 조언 조회 실패:", errorMessage);
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
    // 안전망: 월간 뷰에서 lifestyle이면 즉시 숨김 (FullCalendar v6.x 호환)
    const viewType = calendarRef.current?.getApi()?.view?.type;
    const isMonthView = viewType === 'dayGridMonth';
    
    if (isMonthView && (info.event.extendedProps?.type || '').toLowerCase() === 'lifestyle') {
      info.el.style.display = 'none';
      return; // 더 이상 스타일 안 입혀도 됨
    }

    // 이벤트 스타일링
    if (info.event.extendedProps?.type === 'lifestyle') {
      info.el.style.backgroundColor = '#CFCFCF';  // 회색으로 되돌리기
      info.el.style.borderColor = '#AAAAAA';
      info.el.style.color = '#333333';
      info.el.style.fontWeight = 'normal';
    } else if (info.event.extendedProps?.type === 'task') {
      // 주간/일간 뷰에서 가독성 높은 색상으로
      if (viewType === 'timeGridWeek' || viewType === 'timeGridDay') {
        info.el.style.backgroundColor = '#1e88e5'; // blue 600
        info.el.style.borderColor = '#1565c0';
        info.el.style.color = '#ffffff';
        info.el.style.fontWeight = '600';
        info.el.style.borderWidth = '1px';
        info.el.style.borderStyle = 'solid';
        info.el.style.borderRadius = '6px';
      } else {
        // 기타 뷰는 기존보다 대비를 높인 팔레트
        info.el.style.backgroundColor = '#ffe0b2';
        info.el.style.borderColor = '#fb8c00';
        info.el.style.color = '#3e2723';
        info.el.style.fontWeight = '500';
      }
    } else {
      info.el.style.backgroundColor = '#f3e5f5';
      info.el.style.borderColor = '#9c27b0';
      info.el.style.color = '#333333';
      info.el.style.fontWeight = 'normal';
    }
  };

  const handleViewDidMount = (arg) => {
    // 현재 뷰 상태 업데이트
    const calendarApi = calendarRef.current?.getApi();
    if (!calendarApi) return;
    
    const viewType = calendarApi.view.type;
    if (viewType) {
      // 이전 뷰와 다르면 today로 초기화
      if (previousViewRef.current && previousViewRef.current !== viewType) {
        calendarApi.today(); // today로 이동
      }
      previousViewRef.current = viewType;
      setCurrentView(viewType);
    }
  };

  const handleDatesSet = (arg) => {
    const viewType = arg.view.type; // 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' 등
    
    // 이전 뷰와 다르면 today로 초기화
    if (previousViewRef.current && previousViewRef.current !== viewType) {
      const calendarApi = calendarRef.current?.getApi();
      if (calendarApi) {
        calendarApi.today(); // today로 이동
      }
    }
    previousViewRef.current = viewType;
    setCurrentView(viewType);
  };

  const handleDayHeaderContent = (args) => {
    const weekday = args.date.toLocaleDateString("ko-KR", { weekday: "short" });
    const span = document.createElement("span");
    span.textContent = weekday;
    return { domNodes: [span] };
  };

  // 월간 뷰에서 같은 날짜+제목의 할 일을 하나로 합치는 함수
  const dedupeEventsForMonthView = useCallback((events) => {
    const eventMap = new Map(); // key: "YYYY-MM-DD:제목" -> { event, duplicateIds: [], duplicates: [] }
    
    events.forEach(event => {
      const eventType = (event.extendedProps?.type || '').toLowerCase();
      if (eventType !== 'task') return; // task 타입만 처리
      
      const startDate = event.start;
      if (!startDate) return;
      
      const date = new Date(startDate);
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const title = (event.title || '').trim();
      const key = `${dateKey}:${title}`;
      
      if (eventMap.has(key)) {
        // 중복 항목 발견: 기존 항목에 추가
        const existing = eventMap.get(key);
        existing.duplicateIds.push(event.id);
        existing.duplicates.push(event);
      } else {
        // 새로운 항목
        eventMap.set(key, {
          event: { ...event },
          duplicateIds: [event.id],
          duplicates: [event]
        });
      }
    });
    
    // 합쳐진 이벤트 반환
    return Array.from(eventMap.values()).map(({ event, duplicateIds }) => {
      return {
        ...event,
        id: `merged_${duplicateIds.join('_')}`, // 고유 ID 생성
        extendedProps: {
          ...event.extendedProps,
          duplicateIds: duplicateIds, // 원본 이벤트 ID들 저장
          isMerged: true // 합쳐진 이벤트임을 표시
        }
      };
    });
  }, []);

  const handleEventContent = (arg) => {
    const titleText = arg.event.title;

    const span = document.createElement("span");
    span.textContent = titleText;
    span.title = titleText;
    
    return {domNodes:[span]}
  };

  // 이벤트 드롭 핸들러 (드래그 앤 드롭/리사이즈 허용만 - 저장은 버튼 클릭 시)
  const handleEventDrop = useCallback((dropInfo) => {
    // FullCalendar가 자동으로 처리하도록 허용 (revert 없음)
    // 저장은 "캘린더 수정" 버튼 클릭 시에만 수행
  }, []);

  // 이벤트를 스케줄 형식으로 변환하는 함수
  const convertEventsToSchedule = useCallback((events) => {
    const scheduleMap = new Map(); // day별로 그룹화
    
    events.forEach(event => {
      if (!event.start) return;
      
      // scheduleUtils의 convertToRelativeDay 사용 (올바른 day 인덱스 계산)
      const day = convertToRelativeDayFromScheduleUtils(event.start, today);
      if (!day || day <= 0) {
        console.warn('[convertEventsToSchedule] 유효하지 않은 day:', day, event);
        return;
      }
      
      // 로컬 시간대로 시간 추출 (FullCalendar는 로컬 시간을 사용)
      const startDate = new Date(event.start);
      const endDate = event.end ? new Date(event.end) : null;
      
      const startTime = `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`;
      const endTime = endDate 
        ? `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`
        : null;
      
      // duration 계산 (분 단위)
      let duration = null;
      if (startDate && endDate) {
        duration = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60));
      } else if (event.extendedProps?.duration) {
        duration = event.extendedProps.duration;
      }
      
      // undefined 값을 제거하여 Firestore 저장 오류 방지
      const activity = {
        title: event.title,
        start: startTime,
        end: endTime,
        type: event.extendedProps?.type || 'task'
      };
      
      // undefined가 아닌 값만 추가
      if (event.extendedProps?.importance) {
        activity.importance = event.extendedProps.importance;
      }
      if (event.extendedProps?.difficulty) {
        activity.difficulty = event.extendedProps.difficulty;
      }
      if (event.extendedProps?.description) {
        activity.description = event.extendedProps.description;
      }
      if (event.extendedProps?.category) {
        activity.category = event.extendedProps.category;
      }
      if (event.extendedProps?.taskId) {
        activity.taskId = event.extendedProps.taskId;
      }
      if (duration !== null && duration > 0) {
        activity.duration = duration;
      }
      if (event.extendedProps?.isRepeating !== undefined) {
        activity.isRepeating = event.extendedProps.isRepeating;
      }
      
      if (!scheduleMap.has(day)) {
        // GPT day 인덱스를 weekday로 변환 (1=월요일, 2=화요일, ..., 7=일요일)
        // day % 7을 계산하되, 0이면 7(일요일)로 처리
        const weekdayNum = day % 7 === 0 ? 7 : day % 7;
        const weekdays = ['', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
        const weekday = weekdays[weekdayNum] || '알 수 없음';
        
        scheduleMap.set(day, {
          day,
          weekday,
          activities: []
        });
      }
      
      scheduleMap.get(day).activities.push(activity);
    });
    
    // day별로 정렬하고 activities도 시간순으로 정렬
    // day가 0이거나 유효하지 않은 항목 제거
    const schedule = Array.from(scheduleMap.values())
      .filter(dayBlock => dayBlock.day > 0) // day가 0인 항목 제거
      .sort((a, b) => a.day - b.day)
      .map(dayBlock => ({
        ...dayBlock,
        activities: dayBlock.activities
          .filter(activity => activity.title && activity.start) // 필수 필드가 있는 활동만 유지
          .sort((a, b) => {
            const toMin = (s) => {
              const [h, m] = String(s || '0:0').split(':').map(x => parseInt(x || '0', 10));
              return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
            };
            return toMin(a.start || '00:00') - toMin(b.start || '00:00');
          })
      }))
      .filter(dayBlock => dayBlock.activities.length > 0); // 활동이 있는 날짜만 유지
    
    return schedule;
  }, [today]);

  // 스케줄 저장 핸들러 (저장 버튼 클릭 시)
  const handleSaveSchedule = useCallback(async () => {
    if (!user?.uid) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      console.log('[SaveSchedule] 저장 시작');
      
      // FullCalendar API에서 현재 이벤트 가져오기
      const calendarApi = calendarRef.current?.getApi();
      if (!calendarApi) {
        alert('캘린더를 불러올 수 없습니다.');
        return;
      }
      
      const events = calendarApi.getEvents();
      if (!events || events.length === 0) {
        alert('저장할 일정이 없습니다.');
        return;
      }
      
      // 이벤트를 스케줄 형식으로 변환
      const schedule = convertEventsToSchedule(events);
      
      if (!schedule || schedule.length === 0) {
        alert('저장할 스케줄이 없습니다.');
        return;
      }
      
      console.log('[SaveSchedule] 변환된 스케줄:', schedule);
      
      // Firestore에 저장
      const lifestyleList = await firestoreService.getLifestylePatterns(user.uid);
      const lifestyleListForSave = Array.isArray(lifestyleList) 
        ? lifestyleList.filter(p => typeof p === 'string')
        : [];

      const sessionId = await saveScheduleSessionUnified({
        uid: user.uid,
        schedule: schedule,
        lifestyleList: lifestyleListForSave,
        aiPrompt: '', // 수동 저장은 AI 프롬프트 없음
        conversationContext: [],
        activityAnalysis: {}, // 기존 activityAnalysis 유지 필요할 수 있음
        isManualEdit: true // 수동 수정 플래그 추가
      });

      if (sessionId) {
        console.log('[SaveSchedule] 저장 완료:', sessionId);
        alert('스케줄이 저장되었습니다.');
        
        // 저장 후 스케줄 업데이트
        // ⚠️ 수정: updateSchedule은 { schedule } 형태를 기대하며, lastSchedule에도 isManualEdit 플래그 포함
        const scheduleWithFlag = { schedule, isManualEdit: true };
        setLastSchedule(scheduleWithFlag);
        updateSchedule({ schedule });
      } else {
        console.warn('[SaveSchedule] 저장 실패: sessionId가 null입니다.');
        alert('스케줄 저장에 실패했습니다.');
      }
    } catch (error) {
      console.error('[SaveSchedule] 저장 실패:', error);
      alert('스케줄 저장 중 오류가 발생했습니다: ' + error.message);
    }
  }, [user?.uid, convertEventsToSchedule, saveScheduleSessionUnified, setLastSchedule, updateSchedule]);

  // Google Calendar로 내보내기 핸들러
  const handleExportToGoogleCalendar = useCallback(async () => {
    if (!user?.uid) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      // 1) accessToken 확인 및 가져오기
      let accessToken = googleCalendarAccessToken;
      if (!accessToken) {
        accessToken = await getGoogleCalendarAccessToken();
      }

      if (!accessToken) {
        alert('Google Calendar 연동을 위해 Google 계정으로 다시 로그인해주세요.');
        return;
      }

      // 2) 현재 캘린더 이벤트 가져오기
      const calendarApi = calendarRef.current?.getApi();
      if (!calendarApi) {
        alert('캘린더를 불러올 수 없습니다.');
        return;
      }

      const events = calendarApi.getEvents();
      if (!events || events.length === 0) {
        alert('내보낼 일정이 없습니다.');
        return;
      }

      // 3) FullCalendar 이벤트를 API 형식으로 변환
      const payloadEvents = events.map(e => ({
        title: e.title,
        start: e.start ? new Date(e.start).toISOString() : null,
        end: e.end ? new Date(e.end).toISOString() : null,
        extendedProps: e.extendedProps || {},
      })).filter(e => e.start && e.end); // 시작/종료 시간이 있는 이벤트만

      if (payloadEvents.length === 0) {
        alert('내보낼 수 있는 일정이 없습니다. (시작/종료 시간이 필요합니다)');
        return;
      }

      // 4) 로딩 메시지
      addAIMessage(`Google Calendar로 ${payloadEvents.length}개의 일정을 보내는 중...`);

      // 5) 백엔드 API 호출
      const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';
      const res = await fetch(`${API_BASE_URL}/api/google-calendar/sync-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          scheduleEvents: payloadEvents,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Google Calendar 동기화 실패');
      }

      // 6) 성공 메시지
      const successMessage = `✅ Google Calendar에 ${data.createdCount}개의 일정이 추가되었습니다!`;
      addAIMessage(successMessage);
      alert(successMessage);

      // 7) Google Calendar 링크가 있으면 제공
      if (data.created && data.created.length > 0 && data.created[0].htmlLink) {
        const openCalendar = window.confirm('Google Calendar에서 확인하시겠습니까?');
        if (openCalendar) {
          window.open(data.created[0].htmlLink, '_blank');
        }
      }
    } catch (error) {
      console.error('[handleExportToGoogleCalendar] 오류:', error);
      const errorMessage = error.message || 'Google Calendar 연동 중 오류가 발생했습니다.';
      addAIMessage(`❌ ${errorMessage}`);
      alert(errorMessage);
    }
  }, [user?.uid, googleCalendarAccessToken, getGoogleCalendarAccessToken, addAIMessage]);

  // 친구 선택 핸들러 (모달 열기)
  const handleSelectFriend = useCallback(async (friend) => {
    if (!friend) {
      setSelectedFriend(null);
      setFriendEvents([]);
      setFriendModalOpen(false);
      return;
    }

    setSelectedFriend(friend);
    setLoadingFriendSchedule(true);
    setFriendModalOpen(true); // 모달 먼저 열기

    try {
      // 친구 UID 확인 및 로깅
      const friendUid = friend.friendUid || friend.id;
      console.log('[handleSelectFriend] friend =', friend);
      console.log('[handleSelectFriend] friendUid =', friendUid);
      
      // ✅ 친구의 전체 일정 가져오기 (scheduleSessions에서 최신 세션의 scheduleData 사용)
      const scheduleArray = await firestoreService.getFriendSchedules(friendUid);
      console.log('[handleSelectFriend] scheduleArray =', scheduleArray, 'length =', scheduleArray.length);
      
      if (!scheduleArray || scheduleArray.length === 0) {
        console.log('[handleSelectFriend] 일정 데이터 없음');
        setFriendEvents([]);
        return;
      }

      // scheduleArray는 [{ day: 1, activities: [...] }, ...] 형태
      // postprocessSchedule로 후처리 (자기 일정과 동일한 방식)
      const processed = postprocessSchedule({
        raw: scheduleArray,
        existingTasksForAI: [], // 친구 일정은 task 메타 정보 없음
        today,
      });
      console.log('[handleSelectFriend] processed =', processed, 'length =', processed.length);

      // convertScheduleToEvents로 FullCalendar 이벤트 변환 (자기 일정과 동일한 방식)
      const events = convertScheduleToEvents(processed, today);
      console.log('[handleSelectFriend] events =', events, 'length =', events.length);

      // 친구 일정임을 표시하기 위해 색상 및 메타데이터 추가
      const friendEventsWithStyle = events.map(ev => ({
        ...ev,
        backgroundColor: '#FFE4CC',
        borderColor: '#FF9966',
        textColor: '#333',
        extendedProps: {
          ...ev.extendedProps,
          source: 'friend',
          friendUid: friendUid,
          friendName: friend.displayName || friend.email,
        },
      }));
      
      console.log('[handleSelectFriend] friendEventsWithStyle =', friendEventsWithStyle, 'length =', friendEventsWithStyle.length);

      setFriendEvents(friendEventsWithStyle);
    } catch (error) {
      console.error('[handleSelectFriend] 친구 일정 로드 실패:', error);
      setFriendEvents([]);
    } finally {
      setLoadingFriendSchedule(false);
    }
  }, [today]);

  // 모달 닫기 핸들러
  const handleCloseFriendModal = useCallback(() => {
    setFriendModalOpen(false);
    setSelectedFriend(null);
    setFriendEvents([]);
  }, []);

  return (
    <div className="calendar-page">
      <CalendarHeader isLoading={isLoading} loadingProgress={loadingProgress} />
      
      <Calendar
        ref={calendarRef}
        events={
          currentView === 'dayGridMonth'
            ? (() => {
                // lifestyle 제외하고 task 중복 제거 (내 일정만)
                const filtered = allEvents.filter(e => (e?.extendedProps?.type || '').toLowerCase() !== 'lifestyle');
                const tasks = filtered.filter(e => (e?.extendedProps?.type || '').toLowerCase() === 'task');
                const nonTasks = filtered.filter(e => (e?.extendedProps?.type || '').toLowerCase() !== 'task');
                const dedupedTasks = dedupeEventsForMonthView(tasks);
                return [...nonTasks, ...dedupedTasks];
              })()
            : allEvents // 내 일정만 표시 (친구 일정은 모달에서 별도 표시)
        }
        onEventMount={handleEventMount}
        onViewDidMount={handleViewDidMount}
        onDatesSet={handleDatesSet}
        onDayHeaderContent={handleDayHeaderContent}
        onEventContent={handleEventContent}
        onEventDrop={handleEventDrop}
        eventClassNames={(arg) => {
          return (arg.event.extendedProps?.type === 'lifestyle') ? ['is-lifestyle'] : [];
        }}
      />

      <CalendarControls
        onSaveClick={handleSaveSchedule}
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
        onReportClick={() => navigate('/report')}
        onResetClick={handleResetCalendar}
        onExportToGoogleCalendar={handleExportToGoogleCalendar}
      />

      {/* 친구 탭 토글 버튼 */}
      <button
        className="friends-toggle-button"
        onClick={() => setFriendsTabOpen(!friendsTabOpen)}
        title={friendsTabOpen ? '친구 탭 닫기' : '친구 탭 열기'}
        style={{
          left: friendsTabOpen ? '300px' : '0'
        }}
      >
        {friendsTabOpen ? '←' : '→'}
      </button>

      {/* 친구 탭 */}
      <div 
        className={`friends-panel ${friendsTabOpen ? 'open' : 'closed'}`}
        style={{
          position: 'fixed',
          left: friendsTabOpen ? 0 : '-300px',
          top: '60px',
          width: '300px',
          height: 'calc(100vh - 60px)',
          backgroundColor: 'white',
          borderRight: '1px solid #ddd',
          boxShadow: '2px 0 8px rgba(0,0,0,0.1)',
          zIndex: 1000,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          transition: 'left 0.3s ease'
        }}
      >
        <FriendsTab 
          onSelectFriend={handleSelectFriend}
          selectedFriendUid={selectedFriend?.friendUid || selectedFriend?.id}
        />
      </div>

      {/* 친구 일정 모달 */}
      <FriendScheduleModal
        visible={friendModalOpen}
        onClose={handleCloseFriendModal}
        events={friendEvents}
        friend={selectedFriend}
        loading={loadingFriendSchedule}
      />

      <Modals
        // Task Modal Props
        showTaskModal={showTaskModal}
        setShowTaskModal={setShowTaskModal}          
        onCloseTaskModal={handleCloseTaskModal}      
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
        
        // Feedback Management Modal Props
        showFeedbackManagementModal={showFeedbackManagementModal}
        setShowFeedbackManagementModal={setShowFeedbackManagementModal}
        onSelectFeedback={(feedbackText) => {
          setCurrentMessage(feedbackText);
          setShowTaskModal(true);
          setChatbotMode(UI_CONSTANTS.CHATBOT_MODES.FEEDBACK);
        }}
      />
    </div>
  );
}

export default CalendarPage;