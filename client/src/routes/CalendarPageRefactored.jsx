// CalendarPageRefactored.jsx
// 앱의 메인 페이지
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
  convertScheduleToEvents
} from '../utils/scheduleUtils';
import { detectComprehensiveFallback } from '../utils/fallbackTaskGenerator';
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
  console.log('[buildTasksForAI] 전체 할 일:', (all || []).length, '개');
  const active = (all || []).filter(t => t && (t.isActive === undefined || t.isActive === true));
  console.log('[buildTasksForAI] 활성 할 일:', active.length, '개');
  
  // 할 일이 0개인 경우 경고 로그
  if (active.length === 0) {
    console.warn('[buildTasksForAI] ⚠️ 활성 할 일이 0개입니다. Firestore 반영이 늦을 수 있습니다.');
  }

  const existingTasksForAI = active.map(t => ({
    title: t.title || '제목없음',
    deadline: toISODateLocal(t.deadline?.toDate ? t.deadline.toDate() : t.deadline),
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


// 프롬프트에 강제 규칙 주입
const enforceScheduleRules = (basePrompt) => `${basePrompt}

[반드시 지켜야 할 규칙]
- [현재 할 일 목록]에 있는 모든 항목은 반드시 스케줄 JSON의 activities에 'type': 'task' 로 포함할 것.
- lifestyle 항목과 병합/대체 금지. task는 task로 남길 것.
- 모든 task는 start, end, title, type 필드를 포함해야 한다. (예: {"start":"19:00","end":"21:00","title":"오픽 시험 준비","type":"task"})
- lifestyle과 task의 시간은 절대 겹치지 않도록 조정할 것. 겹친다면 task를 가장 가까운 빈 시간대로 이동하라.
- 출력은 day별 객체 배열(JSON 하나)만 반환하라. 불필요한 텍스트 금지.
`;

// Conflict Resolver - 겹치면 자동 재배치
const hhmmToMin = (s) => {
  const [h,m] = String(s||'').split(':').map(n=>parseInt(n||'0',10));
  return (isNaN(h)?0:h)*60 + (isNaN(m)?0:m);
};
const minToHHMM = (min) => {
  const h = Math.floor(min/60)%24;
  const m = min%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
};
const overlap = (aStart, aEnd, bStart, bEnd) => Math.max(aStart,bStart) < Math.min(aEnd,bEnd);

// 상수 정의 (가독성 + 향후 설정화)
const PREFERRED_MIN = 19 * 60;    // TODO: 사용자 설정화
const MIN_SPLIT_CHUNK = 30;       // 최소 분할 단위(분)
const FALLBACK_BLOCK = [21*60, 23*60]; // 최후 fallback

// 시험/평가류 제목 판별 (함수 선언문으로 호이스팅 보장)
function isExamTitle(t='') {
  return /시험|테스트|평가|자격증|오픽|토익|토플|텝스|면접/i.test(String(t));
}

// day별 lifestyle 블록에서 빈 시간대 계산
const buildFreeBlocks = (activities) => {
  const dayStart = 0;       // 00:00
  const dayEnd   = 24*60;   // 24:00
  
  // 자정 넘김 처리: 23:00~05:00 → [0,05:00] + [23:00,24:00]
  const rawLifestyle = (activities||[])
    .filter(a => (a.type||'').toLowerCase()==='lifestyle' && a.start && a.end)
    .map(a => [hhmmToMin(a.start), hhmmToMin(a.end)]);

  const lifestyle = [];
  for (const [s,e] of rawLifestyle) {
    if (e >= s) {
      // 일반적인 경우: 09:00~17:00
      lifestyle.push([s,e]);
    } else {
      // 자정 래핑: 23:00~05:00 → [0,05:00] + [23:00,24:00]
      lifestyle.push([0, e]);
      lifestyle.push([s, dayEnd]);
    }
  }
  lifestyle.sort((x,y)=>x[0]-y[0]);

  const merged = [];
  for (const [s,e] of lifestyle) {
    if (!merged.length || s>merged[merged.length-1][1]) merged.push([s,e]);
    else merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], e);
  }

  const free = [];
  let cursor = dayStart;
  for (const [s,e] of merged) {
    if (cursor < s) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < dayEnd) free.push([cursor, dayEnd]);
  return free;
};

// 19:00 근접도 가중치 기반 배치 (기본 120분). 맞는 블록 없으면 가장 큰 블록에 잘라 넣음.
const placeIntoFree = (freeBlocks, durationMin) => {
  const preferred = PREFERRED_MIN;
  
  // 19:00 근접도 기반으로 후보 정렬
  const candidates = freeBlocks
    .filter(([fs,fe]) => fe - fs >= durationMin)
    .map(([fs,fe]) => {
      const mid = fs + durationMin/2;
      const distance = Math.abs(mid - preferred);
      return { fs, fe, distance };
    })
    .sort((a,b) => a.distance - b.distance || a.fs - b.fs);
  
  if (candidates.length > 0) {
    const { fs } = candidates[0];
    return { start: fs, end: fs + durationMin };
  }
  
  // 19:00 근접도로 찾을 수 없으면 가장 큰 블록에 우선 배치
  let best = null, bestLen = -1;
  for (const [fs,fe] of freeBlocks) {
    const len = fe - fs;
    if (len > bestLen) { bestLen = len; best = [fs,fe]; }
  }
  if (best) return { start: best[0], end: best[0] + Math.min(bestLen, durationMin) };
  return null;
};

// 분할 배치 함수 (긴 작업을 여러 블록으로 나누어 배치)
const splitPlaceIntoFree = (freeBlocks, durationMin) => {
  // 긴 블록 순 정렬
  const sorted = [...freeBlocks].sort((a,b)=> (b[1]-b[0]) - (a[1]-a[0]));
  const segments = [];
  let remain = durationMin;

  for (const [fs, fe] of sorted) {
    if (remain <= 0) break;
    const len = fe - fs;
    if (len <= MIN_SPLIT_CHUNK) continue;
    const use = Math.min(len, remain);
    segments.push({ start: fs, end: fs + use });
    remain -= use;
  }
  return remain <= 0 ? segments : null;
};

// 스케줄 전역에서 lifestyle과 task 충돌 제거 + 누락 task에 시간 채움
const fixOverlaps = (schedule) => {
  const copy = (schedule||[]).map(day => ({
    ...day,
    activities: (day.activities||[]).map(a=>({...a}))
  }));

              // 🔍 시험/중요 작업 식별 (매일 반복 배치 대상)
              const examTasks = [];
              for (const day of copy) {
                for (const a of day.activities || []) {
                  if ((a.type||'').toLowerCase() === 'task' && 
                      (a.importance === '상' || a.difficulty === '상' || a.isRepeating || isExamTitle(a.title))) {
                    examTasks.push({
                      title: a.title,
                      importance: a.importance || (isExamTitle(a.title) ? '상' : '중'),
                      difficulty: a.difficulty || (isExamTitle(a.title) ? '상' : '중'),
                      duration: a.duration || 150,
                      isRepeating: a.isRepeating ?? (isExamTitle(a.title) || false)
                    });
                  }
                }
              }

  for (const day of copy) {
    // free 블록 구해서 task 배치
    const freeBlocks = buildFreeBlocks(day.activities);

    for (const a of day.activities) {
      const isLifestyle = (a.type||'').toLowerCase()==='lifestyle';
      if (isLifestyle) continue;

      // 기본 지속시간 (몰입 2시간 원칙) - 난이도/중요도 기반 조정
      let dur = 120;
      if (a.importance === '상' || a.difficulty === '상') {
        dur = 150; // 집중 우선 배치형: 2.5시간
      } else if (a.difficulty === '하') {
        dur = 90; // 유동형: 1.5시간
      }
      
      if (a.start && a.end) {
        const s = hhmmToMin(a.start), e = hhmmToMin(a.end);
        // lifestyle과 겹치면 무효 처리하여 재배치
        const ls = day.activities.filter(x => (x.type||'').toLowerCase()==='lifestyle' && x.start && x.end);
        const hasOverlap = ls.some(x => overlap(s,e, hhmmToMin(x.start), hhmmToMin(x.end)));
        if (!hasOverlap && e>s) {
          dur = e - s;
          continue; // 그대로 둔다
        }
      }
      // 시간 정보가 없거나 겹침 → 재배치
      let placed = placeIntoFree(freeBlocks, dur);
      if (placed) {
        a.start = minToHHMM(placed.start);
        a.end   = minToHHMM(placed.end);
      } else {
        // 분할 배치 시도
        const parts = splitPlaceIntoFree(freeBlocks, dur);
        if (parts && parts.length) {
          // 첫 조각을 현재 activity로 사용
          a.start = minToHHMM(parts[0].start);
          a.end   = minToHHMM(parts[0].end);
          // 나머지 조각은 동일 제목의 연속 task로 추가
          for (let i=1;i<parts.length;i++) {
            day.activities.push({
              title: a.title,
              start: minToHHMM(parts[i].start),
              end: minToHHMM(parts[i].end),
              type: a.type || 'task',
              importance: a.importance,
              difficulty: a.difficulty,
              isRepeating: a.isRepeating
            });
          }
        } else {
          // 빈 블록 전혀 없으면, 밤 21:00~23:00 시도 (수면 23:00 고정 가정)
          a.start = minToHHMM(FALLBACK_BLOCK[0]);
          a.end   = minToHHMM(Math.min(FALLBACK_BLOCK[0] + dur, FALLBACK_BLOCK[1]));
        }
      }
      // type 누락 방지
      if (!a.type) a.type = 'task';
    }

    // 🔍 시험/중요 작업이 없는 날에 매일 반복 배치 추가
    const hasExamTask = day.activities.some(a => 
      (a.type||'').toLowerCase() === 'task' && 
      (a.importance === '상' || a.difficulty === '상' || a.isRepeating)
    );
    
    if (!hasExamTask && examTasks.length > 0) {
      // 라운드 로빈을 위해 day.day 기준 선택
      const examTask = examTasks[(day.day - (copy[0]?.day ?? day.day)) % examTasks.length];
      
      // 같은 제목의 task가 이미 있으면 skip
      const hasSameTitle = day.activities.some(a =>
        (a.type||'').toLowerCase() === 'task' && a.title === examTask.title
      );
      
      if (!hasSameTitle) {
        const freeBlocks = buildFreeBlocks(day.activities);
        const placed = placeIntoFree(freeBlocks, examTask.duration);
        
        if (placed) {
          const repeatedTask = {
            title: examTask.title,
            start: minToHHMM(placed.start),
            end: minToHHMM(placed.end),
            type: 'task',
            importance: examTask.importance,
            difficulty: examTask.difficulty,
            isRepeating: true,
            source: 'auto_repeat'
          };
          
          day.activities.push(repeatedTask);
          
          // 🔄 반복 힌트를 실제 배치에 반영 (3일 연속 배치)
          if (examTask.isRepeating) {
            console.info('[Auto Repeat] 반복 배치 추가:', examTask.title, `(${minToHHMM(placed.start)}-${minToHHMM(placed.end)})`);
          }
        }
      } else {
        console.log('[Auto Repeat] 중복 제목으로 인해 스킵:', examTask.title);
      }
    }

    // 마지막으로 활동을 시작시간 기준 정렬(가독성)
    day.activities.sort((x,y)=>hhmmToMin(x.start||'00:00')-hhmmToMin(y.start||'00:00'));
  }
  return copy;
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

// 요일 정규화 함수
const getKoreanWeekday = (day) => {
  const weekdays = ['', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
  return weekdays[day] || '알 수 없음';
};

// 상대 day 정규화 (랩핑 금지: 단조 증가 보장). 요일 텍스트는 1~7 순환
const normalizeRelativeDays = (schedule, baseDay) => {
  const arr = Array.isArray(schedule) ? schedule : [];
  let current = baseDay;
  return arr.map((dayObj, idx) => {
    let dayNum = Number.isInteger(dayObj?.day) ? dayObj.day : (baseDay + idx);
    // 첫날은 항상 baseDay로 리셋 (예측 가능성)
    if (idx === 0 && dayNum !== baseDay) dayNum = baseDay;
    // 오늘 이전 금지 + 단조 증가 보장
    if (dayNum < current) dayNum = current;
    if (idx > 0 && dayNum <= current) dayNum = current + 1;
    current = dayNum;
    const weekdayNum = ((dayNum - 1) % 7) + 1; // 1~7
    return {
      ...dayObj,
      day: dayNum,
      weekday: getKoreanWeekday(weekdayNum)
    };
  });
};

// 도우미: 각 제목의 마감 day 계산
const buildDeadlineDayMap = (existingTasks = [], todayDate) => {
  const map = new Map();
  const base = todayDate.getDay() === 0 ? 7 : todayDate.getDay(); // 오늘의 day 값
  const toMid = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()); // 로컬 자정
  for (const t of (existingTasks || [])) {
    const iso = toISODateLocal(t.deadline);
    if (!iso) continue;
    const d = new Date(iso);
    const diffDays = Math.floor((toMid(d) - toMid(todayDate)) / (24*60*60*1000));
    const deadlineDay = base + Math.max(0, diffDays);
    map.set((t.title || '').trim(), deadlineDay);
  }
  return map;
};

// 후처리: 마감일 이후의 task 제거
const capTasksByDeadline = (schedule, deadlineMap) => {
  return (schedule || []).map(day => ({
    ...day,
    activities: (day.activities || []).filter(a => {
      if ((a.type || 'task').toLowerCase() !== 'task') return true;
      const dl = deadlineMap.get((a.title || '').trim());
      return !dl || day.day <= dl;
    })
  }));
};

// (선택) 주말 업무 방지 하드가드
const stripWeekendWork = (schedule) => {
  return (schedule || []).map(day => ({
    ...day,
    activities: (day.activities || []).filter(a => {
      const isWeekend = (day.day % 7 === 6) || (day.day % 7 === 0); // day:6,7
      const isWorkLike = /업무|근무|회사|프로젝트|개발|리뷰|배포|코드|미팅|회의/.test(a.title || '');
      return !(isWeekend && isWorkLike);
    })
  }));
};

// === NEW: task 메타 보강 유틸 ===
const enrichTaskMeta = (schedule, existingTasks=[]) => {
  if (!Array.isArray(schedule)) return schedule;
  // existingTasks를 title 매칭용 맵으로
  const byTitle = new Map();
  (existingTasks||[]).forEach(t => byTitle.set((t.title||'').trim(), t));

  for (const day of schedule) {
    for (const a of (day.activities||[])) {
      if ((a.type||'').toLowerCase() !== 'task') continue;

      // 1) 기존 태스크 테이블에서 메타 가져오기 (title 기준)
      const base = byTitle.get((a.title||'').trim());

      // 2) 제목이 시험류면 상/상 + 반복
      if (isExamTitle(a.title)) {
        a.importance  = a.importance  || '상';
        a.difficulty  = a.difficulty  || '상';
        a.isRepeating = a.isRepeating ?? true;
      }

      // 3) 기존 태스크가 상/상이면 그대로 반영 (없으면 유지)
      if (base) {
        if (!a.importance)  a.importance  = base.importance || '중';
        if (!a.difficulty)  a.difficulty  = base.difficulty || '중';
        if (isExamTitle(a.title) || a.importance === '상' || a.difficulty === '상') {
          a.isRepeating = a.isRepeating ?? true;
        }
      }

      // 4) duration 보강 (fixOverlaps가 참고)
      if (!a.duration && a.start && a.end) {
        a.duration = hhmmToMin(a.end) - hhmmToMin(a.start);
      }
    }
  }
  return schedule;
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
  const navigate = useNavigate();
  
  // 인증 및 Firebase 훅
  const { user } = useAuth();
  
  // 새로운 분리된 훅들
  const { 
    allEvents, 
    setAllEvents, 
    lastSchedule, 
    setLastSchedule
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
  const [showLifestyleInMonth, setShowLifestyleInMonth] = useState(true); // 월간 뷰에서 lifestyle 표시 여부

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
      const enforced = enforceScheduleRules(prompt);
      const scheduleMessages = [
        ...conversationContext.slice(-8),  // 12개 → 8개로 축소
        { 
          role: 'user', 
          content: `${enforced}\n\n[현재 할 일 목록]\n${taskText || '할 일 없음'}`  // ✅ taskText 포함
        }
      ].filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
      
      // 디버깅을 위한 로그 추가
      console.log('[handleScheduleGeneration] 전달 프롬프트 미리보기:\n', scheduleMessages[scheduleMessages.length - 1].content.slice(0, 500));
      
      const sessionId = getOrCreateSessionId(user.uid);
      const result = await generateSchedule(
        scheduleMessages,
        patternsForAI, // ✅ 객체 패턴 보장
        existingTasksForAI,                    // ✅ 할 일 테이블 반영
        { userId: user.uid, sessionId } // opts
      );
      
      // 방탄 로직: task가 비어 있을 때 보정 (강화된 체크)
      let finalSchedule = result.schedule;
      
      // ▼▼ 추가: 메타 보강
      finalSchedule = enrichTaskMeta(finalSchedule, existingTasksForAI);
      
      // 스케줄이 비어있거나 유효하지 않은 경우도 포함
      const hasValidSchedule = Array.isArray(finalSchedule) && finalSchedule.length > 0;
      const hasTask = hasValidSchedule && finalSchedule.some(d =>
        d.activities?.some(a => a.type && a.type.toLowerCase() !== 'lifestyle')
      );

      // ✅ 자동 태스크 감지 - 유연한 키워드 기반 (빈 스케줄에도 작동)
      if (!hasTask) {
        console.warn('[AI Schedule] task가 없거나 스케줄이 비어있음, fallback 감지 시작');
        
        const fallback = detectComprehensiveFallback({
          text: enforced,
          aiResponse: result,
          existingTasks: existingTasksForAI
        });
        
        if (fallback) {
          console.warn('[AI Schedule] 자동 감지 fallback 추가:', fallback.title, `(${fallback.detectedType || fallback.source})`);
          
          // 시험/프로젝트 계열이면 isRepeating 기본 true 보강
          const mustRepeat = /시험|테스트|평가|자격증|면접|프로젝트/i.test(fallback.title || '');
          if (fallback.type?.toLowerCase?.() !== 'lifestyle' && fallback.isRepeating == null && mustRepeat) {
            fallback.isRepeating = true;
          }
          
          // 빈 스케줄일 때 안전 가드 (더 강화)
          if (!hasValidSchedule) {
            const todayDay = today.getDay() === 0 ? 7 : today.getDay();
            finalSchedule = [{ 
              day: todayDay, 
              weekday: getKoreanWeekday(todayDay), 
              activities: [] 
            }];
          }
          (finalSchedule[0].activities ||= []).push(fallback);
          // fallback 추가 후 시간순 정렬
          finalSchedule[0].activities.sort((a,b)=>hhmmToMin(a.start||'00:00')-hhmmToMin(b.start||'00:00'));
        } else {
          console.warn('[AI Schedule] fallback 감지 실패 - 키워드나 기존 할 일이 없음');
        }
      }

      // day 정규화 (랩핑 금지: 연속 증가)
      const baseDay = today.getDay() === 0 ? 7 : today.getDay();
      const normalized = normalizeRelativeDays(finalSchedule, baseDay);
      let fixed = fixOverlaps(normalized);
      const deadlineMap = buildDeadlineDayMap(existingTasksForAI, today);
      fixed = capTasksByDeadline(fixed, deadlineMap);
      fixed = stripWeekendWork(fixed); // (선택) 주말에 업무류 제거
      setLastSchedule(fixed);
      
      const scheduleSessionId = await saveScheduleSessionUnified({
        uid: user.uid,
        schedule: fixed,
        lifestyleList: patternsForAI,
        aiPrompt: enforced,                     // ✅ 강화된 프롬프트 DB 저장
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
      const promptBase = lastSchedule 
        ? buildFeedbackPrompt(lifestyleText, taskText, lastSchedule)
        : buildShedAIPrompt(lifestyleText, taskText, today);
      const prompt = enforceScheduleRules(promptBase);
      
      const scheduleMessages = [
        ...conversationContext.slice(-8),  // 12개 → 8개로 축소
        { role: 'user', content: prompt }
      ].filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
      
      const sessionId = getOrCreateSessionId(user.uid);
      const result = await generateSchedule(
        scheduleMessages,
        savedLifestylePatterns, // ✅ DB 객체 패턴 사용
        existingTasksForAI,
        { userId: user.uid, sessionId }
      );
      
      const baseDay = today.getDay() === 0 ? 7 : today.getDay();
      const normalized = normalizeRelativeDays(result.schedule, baseDay);
      let fixed = fixOverlaps(normalized);
      const deadlineMap = buildDeadlineDayMap(existingTasksForAI, today);
      fixed = capTasksByDeadline(fixed, deadlineMap);
      fixed = stripWeekendWork(fixed); // (선택) 주말에 업무류 제거
      setLastSchedule(fixed);
      addAIMessage("스케줄이 생성되었습니다!");

      const scheduleSessionId = await saveScheduleSessionUnified({
        uid: user.uid,
        schedule: fixed,
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
  }, [lifestyleList, lastSchedule, today, handleSaveAndGenerateSchedule, setIsLoading, user?.uid, generateSchedule, addAIMessage]);

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
      
      const promptBase = lastSchedule 
        ? buildFeedbackPrompt(lifestyleText, taskText, lastSchedule)
        : buildShedAIPrompt(lifestyleText, taskText, today);
      const prompt = enforceScheduleRules(promptBase);
      
      addAIMessage("DB 데이터를 기반으로 스케줄을 재생성합니다...");
      
      try {
        // 서버 시그니처에 맞게 호출: generateSchedule(messages, lifestylePatterns, existingTasks, opts)
        const scheduleMessages = [
          ...conversationContext.slice(-8),  // 12개 → 8개로 축소
          { role: 'user', content: prompt }
        ].filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0);
        
        const result = await generateSchedule(
          scheduleMessages,
          savedLifestylePatterns, // DB에서 가져온 생활패턴 배열
          existingTasksForAI,                       // ✅ 반영
          {
            nowOverride: today.toISOString().split('T')[0] + 'T00:00:00',
            anchorDay: today.getDay() === 0 ? 7 : today.getDay()
          }
        );
        
        const baseDay = today.getDay() === 0 ? 7 : today.getDay();
        const normalized = normalizeRelativeDays(result.schedule, baseDay);
        let fixed = fixOverlaps(normalized);
        const deadlineMap = buildDeadlineDayMap(existingTasksForAI, today);
        fixed = capTasksByDeadline(fixed, deadlineMap);
        fixed = stripWeekendWork(fixed); // (선택) 주말에 업무류 제거
        setLastSchedule(fixed);
        
        // 통일된 저장 사용
        const scheduleSessionId = await saveScheduleSessionUnified({
          uid: user.uid,
          schedule: fixed,
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
  }, [lastSchedule, today, setIsLoading, user?.uid, generateSchedule, addAIMessage]);

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
    
    if (Array.isArray(lifestyleList) && typeof lifestyleList[0] === 'string') {
      // 문자열 배열이면 그대로 사용 (aiService.js에서 파싱)
      lifestyleText = lifestyleList.join('\n');
    } else {
      // 객체 배열이면 Firestore에서 다시 로드
      const lifestylePatternsForAI = await firestoreService.getLifestylePatterns(user.uid);
      lifestyleText = lifestylePatternsForAI.map(p => 
        typeof p === 'string' ? p : `${p.title} (${p.start}-${p.end}, 요일: ${p.days?.join(', ') || '미정'})`
      ).join('\n');
    }
    
    const promptBase = lastSchedule 
      ? buildFeedbackPrompt(lifestyleText, processedMessage, lastSchedule)
      : buildShedAIPrompt(lifestyleText, processedMessage, today);
    const prompt = enforceScheduleRules(promptBase);

    let timeoutId;
    let controller;
    try {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 60000);
      
      // 서버 시그니처에 맞게 호출: generateSchedule(messages, lifestylePatterns, existingTasks, opts)
      const messagesForAPI = [
        ...conversationContext.slice(-8),  // 12개 → 8개로 축소
        { role: 'user', content: prompt }
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
          promptContext: prompt,  // 4) 강화된 프롬프트를 promptContext로 전달
          signal: controller.signal  // 5) AbortController signal 전달
        }
      );
      const newSchedule = apiResp?.schedule ? apiResp : { schedule: apiResp };
      
      clearTimeout(timeoutId);

      // ▼▼ 추가: 메타 보강
      newSchedule.schedule = enrichTaskMeta(newSchedule.schedule, existingTasksForAI);

      // day 정규화 (랩핑 금지: 연속 증가)
      const baseDay = today.getDay() === 0 ? 7 : today.getDay();
      const normalized = normalizeRelativeDays(newSchedule.schedule, baseDay);
      
      // 🔒 AI가 겹치게 줘도 여기서 전부 무충돌로 보정
      let fixed = fixOverlaps(normalized);
      const deadlineMap = buildDeadlineDayMap(existingTasksForAI, today);
      fixed = capTasksByDeadline(fixed, deadlineMap);
      fixed = stripWeekendWork(fixed); // (선택) 주말에 업무류 제거
      newSchedule.schedule = fixed;

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
        id: `${event.title}__${new Date(event.start).getTime()}__${new Date(event.end).getTime()}`,
        extendedProps: {
          ...event.extendedProps,
          type: (event.extendedProps?.type || 'task'), // 기본 task
          isDone: false,
        }
      }));

      // 방탄 로직: task가 비어 있을 때 보정 (강화된 체크)
      const hasValidSchedule = Array.isArray(newSchedule.schedule) && newSchedule.schedule.length > 0;
      const hasTask = hasValidSchedule && newSchedule.schedule.some(d =>
        d.activities?.some(a => a.type && a.type.toLowerCase() !== 'lifestyle')
      );

      // ✅ 자동 태스크 감지 - 유연한 키워드 기반 (빈 스케줄에도 작동)
      if (!hasTask) {
        console.warn('[AI Schedule] task가 없거나 스케줄이 비어있음, fallback 감지 시작');
        
        const fallback = detectComprehensiveFallback({
          text: prompt,
          aiResponse: newSchedule,
          existingTasks: existingTasksForAI
        });
        
        if (fallback) {
          console.warn('[AI Schedule] 자동 감지 fallback 추가:', fallback.title, `(${fallback.detectedType || fallback.source})`);
          
          // 시험/프로젝트 계열이면 isRepeating 기본 true 보강
          const mustRepeat = /시험|테스트|평가|자격증|면접|프로젝트/i.test(fallback.title || '');
          if (fallback.type?.toLowerCase?.() !== 'lifestyle' && fallback.isRepeating == null && mustRepeat) {
            fallback.isRepeating = true;
          }
          
          // 빈 스케줄일 때 안전 가드 (더 강화)
          if (!hasValidSchedule) {
            const todayDay = today.getDay() === 0 ? 7 : today.getDay();
            newSchedule.schedule = [{ 
              day: todayDay, 
              weekday: getKoreanWeekday(todayDay), 
              activities: [] 
            }];
          }
          (newSchedule.schedule[0].activities ||= []).push(fallback);
          // fallback 추가 후 시간순 정렬
          newSchedule.schedule[0].activities.sort((a,b)=>hhmmToMin(a.start||'00:00')-hhmmToMin(b.start||'00:00'));
        } else {
          console.warn('[AI Schedule] fallback 감지 실패 - 키워드나 기존 할 일이 없음');
        }
          
        // 활동 유효성 필터 (start/end 없는 task 제거)
        const safeSchedule = (newSchedule.schedule || []).map(d => ({
          ...d,
          activities: (d.activities || []).filter(a => {
            const t = (a.type||'task').toLowerCase();
            if (t === 'lifestyle') return a.start && a.end;
            return a.title && a.start && a.end; // task는 필수 3종
          })
        }));
        
        // fallback task를 포함한 이벤트 재생성
        const updatedEvents = convertScheduleToEvents(safeSchedule, today).map(event => ({
            ...event,
            id: `${event.title}__${new Date(event.start).getTime()}__${new Date(event.end).getTime()}`,
            extendedProps: {
              ...event.extendedProps,
              type: (event.extendedProps?.type || 'task'), // 기본 task
              isDone: false,
            }
          }));
        setAllEvents(updatedEvents);
      } else {
        setAllEvents(events);
      }
      // 이벤트는 Calendar 컴포넌트에서 자동으로 처리됨

      // ✅ 기존 하드코딩된 키워드 매칭 제거 - 이제 detectComprehensiveFallback에서 처리

      // 스케줄에서 할 일 추출하여 Firestore에 저장 (중복 방지)
      try {
        // 필터 완화: lifestyle만 제외하고, 날짜가 있는 모든 AI 이벤트를 저장 대상으로 간주
        const taskEvents = events.filter(event => {
          const t = (event.extendedProps?.type || '').toLowerCase();
          return event.start && t !== 'lifestyle'; // lifestyle만 제외, 나머지는 저장
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
        
        // 새 할 일들을 일괄 저장 (로컬 날짜+시간 조합으로 중복 방지)
        const newTasks = taskEvents
          .filter(event => {
            const startIso = toISODateLocal(event.start);
            if (!startIso) return false;
            
            // 로컬 날짜/시간 기반 키 생성 (타임존 흔들림 방지)
            const start = new Date(event.start);
            const localDate = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
            const localTime = `${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}`;
            const key = `${event.title}__${localDate}T${localTime}`;
            
            return !existingTasks.some(t => {
              const existingDate = toISODateLocal(t.deadline);
              const timePart = (t.deadlineTime ? t.deadlineTime.slice(0,5) : '00:00');
              const existingTimeKey = `${existingDate}T${timePart}`;
              const existingKey = `${t.title}__${existingTimeKey}`;
              return existingKey === key;
            });
          })
          .map(event => ({
            title: event.title,
            deadline: toISODateLocal(event.start),  // ✅ 통일
            deadlineTime: new Date(event.start).toTimeString().slice(0,5), // HH:MM 형식
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
      try { controller?.abort(); } catch {}
      console.error('스케줄 생성 요청 실패:', e);
      addAIMessage("요청 실패: 다시 시도해주세요.");
    } finally {
      clearTimeout?.(timeoutId);
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
    if (!user?.uid) { addAIMessage("로그인이 필요합니다."); return; }
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
    const viewType = calendarRef.current?.getApi().view.type;

    // 월간 뷰에서 lifestyle 토글로 제어 (기본값: 보임)
    if (viewType === "dayGridMonth" && 
        (info.event.extendedProps?.type === "lifestyle") && 
        !showLifestyleInMonth) {
      // 1) 공식 속성 우선
      try {
        info.event.setProp('display', 'none');
        // 2) 폴백: CSS로 강제 숨김
        const prev = info.event.getProp('classNames') || [];
        if (!prev.includes('fc-hidden-lifestyle')) {
          info.event.setProp('classNames', [...prev, 'fc-hidden-lifestyle']);
        }
      } catch {}
      return;
    }

    // 주/일간 뷰 스타일링만 유지
    if ((info.event.extendedProps?.type === "lifestyle") && viewType !== "dayGridMonth") {
      info.el.style.backgroundColor = "#CFCFCF";
      info.el.style.borderColor = "#AAAAAA";
      info.el.style.color = "#333333";
      info.el.style.fontWeight = "normal";
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

    // FullCalendar 기본 +more 기능 사용 (커스텀 로직 제거)
    if (viewType === "dayGridMonth") {
      return { domNodes: [span] };
    }

    if (viewType !== "dayGridMonth" && arg.event.extendedProps?.type === "task") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isDone ?? false;
      checkbox.style.marginRight = "5px";
      const onChange = () => {
        arg.event.setExtendedProp("isDone", checkbox.checked);    
        setAllEvents(prevEvents => {
          return prevEvents.map(event => {
            if (event.id === arg.event.id) {
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
      };
      checkbox.onchange = onChange;

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
        onReportClick={() => navigate('/report')}
        onResetClick={handleResetCalendar}
        showLifestyleInMonth={showLifestyleInMonth}
        onToggleLifestyle={() => setShowLifestyleInMonth(v => !v)}
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