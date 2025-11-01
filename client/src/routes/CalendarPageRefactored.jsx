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
  buildScheduleMessages,
  buildTasksForAI,
  parseTaskFromFreeText,
  postprocessSchedule,
  placeAppointmentsPass,
  placeTasksPass,
  dedupeActivitiesByTitleTime
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
import app from '../config/firebase';
import { getAuth } from 'firebase/auth';
import { serverTimestamp, Timestamp } from 'firebase/firestore';
import '../styles/calendar.css';
import '../styles/floating.css';

// 공용 알림 헬퍼 (중복 방지)
const notify = (() => {
  let last = 0;
  return (msg, gap = 2000) => {
    const now = Date.now();
    if (now - last < gap) return;
    alert(msg);
    last = now;
  };
})();

// === 공통 스케줄 생성 파이프라인(단일화) ==========================
async function generateAndApplySchedule({
  generateScheduleAPI,
  calendarApi,
  userId,
  today,
  conversationContext,
  parsedLifestylePatterns,
  messagesBasePrompt,
  tasksForAI,
  updateSchedule,
  whitelistMode = 'off',
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
    { userId, sessionId: `sess_${userId || 'anon'}` }
  );
  
  const normalized = apiResp?.schedule ? apiResp : { schedule: apiResp };
  const baseProcessed = postprocessSchedule({
    raw: normalized.schedule,
    parsedPatterns: parsedLifestylePatterns,
    existingTasksForAI: tasksForAI.existingTasksForAI,
    today,
    whitelistPolicy: whitelistMode,
  });

  const withAppts = placeAppointmentsPass(baseProcessed, tasksForAI.existingTasksForAI, today);
  const schedule = placeTasksPass(withAppts, tasksForAI.existingTasksForAI, today);

  calendarApi?.removeAllEvents();
  updateSchedule({ schedule });

  // 세션 저장은 호출하는 쪽에서 처리
  return schedule;
}
// ================================================================

// 세션 저장 헬퍼 (기존 saveScheduleSessionUnified 유지)
const saveScheduleSessionUnified = async ({
  uid,
  schedule,
  lifestyleList,
  aiPrompt,
  conversationContext
}) => {
  const lifestyleContextForSave = Array.isArray(lifestyleList) 
    ? lifestyleList.flatMap(pattern => {
        if (typeof pattern === 'string') {
          const parsed = parseLifestyleLines(pattern);
          return parsed.map(p => {
            const days = Array.isArray(p.days) ? p.days.join(',') : '';
            const s = p.start || '09:00';
            const e = p.end || '10:00';
            return `${days} ${s}-${e} ${p.title}`;
          });
        } else if (pattern && typeof pattern === 'object') {
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

  // 활동 비중 계산 (스케줄이 배열인 경우)
  let activityAnalysis = {};
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
    activityAnalysis = mixResult.byCategory;
    
    // 디버깅 로그 (개발 모드에서만)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[saveScheduleSessionUnified] 활동 비중 계산 완료:', activityAnalysis);
    }
  }

  const data = {
    scheduleData: schedule,
    hasSchedule: true,
    isActive: true,
    lifestyleContext: lifestyleContextForSave,
    aiPromptPreview: promptPreview,
    conversationContext: Array.isArray(conversationContext) ? conversationContext.slice(-8) : [],
    activityAnalysis, // 활동 비중 추가
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  return await firestoreService.saveScheduleSession(uid, data);
};

// 프롬프트에 강제 규칙 주입 (scheduleUtils에서 사용하지만 여기서도 필요)
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
  let best = null;

  for (const [fs, fe] of freeBlocks) {
    if (fe - fs < durationMin) continue;
    const earliest = fs;
    const latest = fe - durationMin;
    const target = preferred - durationMin / 2;
    const start = Math.min(Math.max(target, earliest), latest);
    const mid = start + durationMin / 2;
      const distance = Math.abs(mid - preferred);
    if (!best || distance < best.distance || (distance === best.distance && start < best.start)) {
      best = { start, end: start + durationMin, distance };
    }
  }
  if (best) return { start: best.start, end: best.end };

  // 폴백: 가장 큰 블록
  let longest = null, len = -1;
  for (const [fs, fe] of freeBlocks) {
    if (fe - fs > len) { len = fe - fs; longest = [fs, fe]; }
  }
  return longest ? { start: longest[0], end: longest[0] + Math.min(len, durationMin) } : null;
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
    // 마지막 조각은 remain 이하로만 사용 (총합 초과 방지)
    const want = segments.length === 0 ? Math.max(MIN_SPLIT_CHUNK, remain) : remain;
    const use = Math.min(len, want, remain);
    segments.push({ start: fs, end: fs + use });
    remain -= use;
  }
  return remain <= 0 ? segments : null;
};

// 생활패턴 제목 정리 함수
const cleanLifestyleTitle = (title, start, end) => {
  if (!title) return '';
  
  // 0) 앞뒤 구분자/틸다/공백 제거
  const strip = (s='') => s
    .replace(/^[~\-–—|·•,:;\s]+/, '')
    .replace(/[~\-–—|·•,:;\s]+$/, '')
    .replace(/\s{2,}/g,' ')
    .trim();
  let cleaned = strip(title);

  // 1) 접두 키워드 제거 (한글 경계 기반)
  cleaned = cleaned
    .replace(/(?:^|[\s,·•])(매일|평일|주말)(?=$|[\s,·•])/gi,' ')
    .replace(/(?:^|[\s,·•])(매|평)(?=$|[\s,·•])/g,' ')
    .replace(/\bevery\s*day\b/gi,' ');
  cleaned = strip(cleaned);

  // 🔧 "40" 같은 숫자만 남은 경우 (GPT 잔여) 보정
  if (/^([0-9]{2})$/.test(cleaned)) {
    const n = parseInt(cleaned, 10);
    if (n === 40) cleaned = '점심식사';
    else if (n < 10) cleaned = '아침식사';
    else cleaned = '활동';
  }
  
  // 완전히 비어있거나 숫자만 남은 경우 시간 기반으로 추론
  if (!cleaned || /^[0-9]+$/.test(cleaned)) {
    const startHour = parseInt(start?.split(':')[0] || '0', 10);
    const endHour = parseInt(end?.split(':')[0] || '0', 10);
    const wrapsMidnight = (end && start) ? (endHour < startHour) : false;

    if (wrapsMidnight || startHour < 6) {
      cleaned = '수면';
    } else if (startHour >= 6 && startHour < 9) {
      cleaned = '아침식사';
    } else if (startHour >= 12 && startHour < 14) {
      cleaned = '점심식사';
    } else if (startHour >= 9 && startHour < 18) {
      cleaned = '출근';
    } else if (startHour >= 18 && startHour < 22) {
      cleaned = '저녁식사';
    } else if (startHour >= 20 && startHour < 22) {
      cleaned = '헬스';
    } else {
      cleaned = '활동';
    }
  }
  
  return cleaned;
};

// 스케줄 전역에서 lifestyle과 task 충돌 제거 + 누락 task에 시간 채움
const fixOverlaps = (schedule, opts = {}) => {
  const allowed = opts.allowedTitles || new Set();
  const allowAutoRepeat = !!opts.allowAutoRepeat;
  const deadlineMap = opts.deadlineMap || new Map();
  const copy = (schedule||[]).map(day => ({
    ...day,
    activities: (day.activities||[]).map(a=>({...a}))
  }));

  // 🔍 시험/중요 작업 식별 (매일 반복 배치 대상) - 한 번만 계산
              const examTasks = [];
              for (const day of copy) {
                for (const a of day.activities || []) {
                  // ✅ 하루 단위 선제 컷: 마감 지난 task는 즉시 제거
                  if ((a.type||'').toLowerCase() === 'task') {
                    const dl = deadlineMap.get(normTitle(a.title||''));
                    if (dl && day.day > dl) {
                      console.info('[Deadline Cut] day>', dl, '→ drop:', a.title, '(day=', day.day, ')');
                      a.__drop__ = true;
                      continue;
                    }
                  }
                  if ((a.type||'').toLowerCase() === 'task' && 
                      (a.importance === '상' || a.difficulty === '상' || a.isRepeating || isExamTitle(a.title))) {
        // 🔒 사용자 제공 제목만 후보로 인정
        if (!allowed.has((a.title||'').trim())) continue;
                    examTasks.push({
                      title: a.title,
                      importance: a.importance || (isExamTitle(a.title) ? '상' : '중'),
                      difficulty: a.difficulty || (isExamTitle(a.title) ? '상' : '중'),
                      duration: a.duration || 150,
                      isRepeating: a.isRepeating ?? (isExamTitle(a.title) || false)
                    });
                  }
                }
                // 위에서 표시한 것 제거
                day.activities = day.activities.filter(a => !a.__drop__);
              }

  // 🔧 성능 최적화: lifestyle 블록을 미리 계산하여 캐싱
  const lifestyleBlocksCache = new Map();

  for (const day of copy) {
    // free 블록 구해서 task 배치 (캐싱된 결과 사용)
    const dayKey = `${day.day}-${day.weekday}`;
    let freeBlocks = lifestyleBlocksCache.get(dayKey);
    
    if (!freeBlocks) {
      freeBlocks = buildFreeBlocks(day.activities);
      lifestyleBlocksCache.set(dayKey, freeBlocks);
    }

    for (const a of day.activities) {
      const isLifestyle = (a.type||'').toLowerCase()==='lifestyle';
      
      // 생활패턴 제목 정리
      if (isLifestyle) {
        a.title = cleanLifestyleTitle(a.title, a.start, a.end);
      }
      
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

    // 🔁 자동 반복: 허용된 경우에만, 그리고 화이트리스트 내 제목만
    if (allowAutoRepeat && examTasks.length > 0) {
    const hasExamTask = day.activities.some(a => 
      (a.type||'').toLowerCase() === 'task' && 
      (a.importance === '상' || a.difficulty === '상' || a.isRepeating)
    );
      if (!hasExamTask) {
      // 라운드 로빈을 위해 day.day 기준 선택 (안전한 인덱싱)
      const base = copy[0]?.day ?? day.day;
      const offset = (day.day - base) % examTasks.length;
      const safeIdx = offset < 0 ? offset + examTasks.length : offset;
      const examTask = examTasks[safeIdx];
      
      // ✅ 자동 반복도 데드라인 넘으면 아예 생성 금지
      const dl = deadlineMap.get(normTitle(examTask.title||''));
      if (dl && day.day > dl) {
        console.info('[Auto Repeat] 데드라인 초과로 생성 스킵:', examTask.title, 'day=', day.day, 'deadlineDay=', dl);
      } else {
        // 같은 제목의 task가 이미 있으면 skip (정규화 비교)
        const hasSameTitle = day.activities.some(a =>
          (a.type||'').toLowerCase() === 'task' && normTitle(a.title||'') === normTitle(examTask.title||'')
        );
        
        if (!hasSameTitle) {
          // 캐싱된 freeBlocks 재사용
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
            
            // 추가 시점에도 방어
            if (!allowed.has(normTitle(repeatedTask.title||''))) continue;
            
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
      }
    }

    // 마지막으로 활동을 시작시간 기준 정렬(가독성), 제거 표시된 것 필터링
    day.activities = day.activities.filter(a => !a.__drop__).sort((x,y)=>hhmmToMin(x.start||'00:00')-hhmmToMin(y.start||'00:00'));
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

// 요일 번호 1~7
const toWeekday1to7 = (dayNum) => ((dayNum - 1) % 7) + 1;

// 시간 문자열 정규화 (7:00 → 07:00)
const normHHMM = (t='00:00') => {
  const [h,m] = String(t).split(':').map(n=>parseInt(n||'0',10));
  const hh = isNaN(h)?0:h, mm = isNaN(m)?0:m;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
};

// AI 응답에 '생활패턴 강제 투영' (누락된 건 추가, 요일 안 맞는 건 제거)
const applyLifestyleHardOverlay = (schedule, parsedPatterns) => {
  if (!Array.isArray(schedule)) return schedule;
  const patterns = Array.isArray(parsedPatterns) ? parsedPatterns : [];

  const byDayNeed = (weekday) =>
    patterns.filter(p => (p.days || [1,2,3,4,5,6,7]).includes(weekday));

  return schedule.map(day => {
    const weekday = toWeekday1to7(day.day || 1);
    const need = byDayNeed(weekday);

    const acts = Array.isArray(day.activities) ? [...day.activities] : [];

    // 2-1) 요일 안 맞는 lifestyle 제거 (특히 헬스가 매일 생기는 문제 방지)
    const filtered = acts.filter(a => {
      if ((a.type || '').toLowerCase() !== 'lifestyle') return true;
      // title과 시간으로 매칭 가능한 패턴이 오늘 요일에 존재하는지 확인
      const start = normHHMM(a.start || '00:00');
      const end = normHHMM(a.end || '23:00');
      const titleNorm = cleanLifestyleTitle(a.title, start, end);
      const hasTodayPattern = need.some(p => {
        const pStart = normHHMM(p.start || '00:00');
        const pEnd = normHHMM(p.end || '23:00');
        const pTitle = cleanLifestyleTitle(p.title, pStart, pEnd);
        // 시간대가 같고(핵심), 제목이 유사하면 오늘 요일에 유효한 패턴으로 본다
        return pStart === start && pEnd === end && pTitle === titleNorm;
      });
      // 오늘 요일에 해당 패턴이 없으면 drop
      return hasTodayPattern;
    });

    // 2-2) 누락된 lifestyle 추가 (AI가 빼먹은 출근 같은 것)
    const existingKey = new Set(
      filtered
        .filter(a => (a.type || '').toLowerCase() === 'lifestyle')
        .map(a => `${normHHMM(a.start||'00:00')}-${normHHMM(a.end||'23:00')}::${cleanLifestyleTitle(a.title, a.start, a.end)}`)
    );

    for (const p of need) {
      const s = normHHMM(p.start || '00:00');
      const e = normHHMM(p.end || '23:00');
      const t = cleanLifestyleTitle(p.title, s, e);
      const key = `${s}-${e}::${t}`;
      if (!existingKey.has(key)) {
        filtered.push({
          title: t,
          start: s,
          end: e,
          type: 'lifestyle',
          __days: p.days || [1,2,3,4,5,6,7]
        });
      }
    }

    // 정렬
    filtered.sort((x,y) => hhmmToMin(x.start || '00:00') - hhmmToMin(y.start || '00:00'));

    return { ...day, activities: filtered };
  });
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

// 타이틀 정규화 헬퍼 (공백/대소문자 일관화)
const normTitle = (s='') => s.replace(/\s+/g, ' ').trim();

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
    map.set(normTitle(t.title || ''), deadlineDay);
  }
  return map;
};

// 후처리: 마감일 이후의 task 제거
const capTasksByDeadline = (schedule, deadlineMap) => {
  return (schedule || []).map(day => ({
    ...day,
    activities: (day.activities || []).filter(a => {
      if ((a.type || 'task').toLowerCase() !== 'task') return true;
      const dl = deadlineMap.get(normTitle(a.title || ''));
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
      const isWorkLike = /(회사|근무|업무|미팅|회의)(?!.*(스터디|공부|학습|개인|사이드))/.test(a.title || '');
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

// 중복된 saveScheduleSessionUnified 제거됨 (위쪽에 이미 정의됨)

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
    setLastSchedule,
    updateSchedule
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
        // ✅ 명시적으로 persistAsTask=true 인 것만 저장 (AI가 만든 임의 task 방지)
        const taskEvents = allEvents.filter(event => {
          const t = (event.extendedProps?.type || '').toLowerCase();
          return event.start && t !== 'lifestyle' && event.extendedProps?.persistAsTask === true;
        });
        
        if (taskEvents.length === 0) return;
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
              relativeDay: 0,
              isActive: true,
              persistAsTask: true,
              createdAt: serverTimestamp()
            };
          })
          .filter(t => t.deadline); // 유효한 날짜만
        
        if (newTasks.length > 0) {
          console.log('[CalendarPage] 새 할 일 저장 시작:', newTasks.length, '개');
          console.log('[CalendarPage] userId:', user.uid, 'tasks:', newTasks);
          try {
            await Promise.all(newTasks.map(task => firestoreService.saveTask(user.uid, task)));
            console.log('[CalendarPage] 새 할 일 저장 완료');
          } catch (err) {
            console.error('[CalendarPage] 할 일 저장 중 오류:', err);
          }
        }
      } catch (error) {
        console.error('[CalendarPage] 할 일 저장 실패:', error);
      }
    };

    // 디바운스 적용 (350ms)
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
  const [currentScheduleSessionId, setCurrentScheduleSessionId] = useState(null);
  const [chatbotMode, setChatbotMode] = useState(UI_CONSTANTS.CHATBOT_MODES.TASK);
  const [taskInputMode, setTaskInputMode] = useState(UI_CONSTANTS.TASK_INPUT_MODES.CHATBOT);
  const [editingTaskId, setEditingTaskId] = useState(null); // 수정 중인 할 일 ID
  const [currentView, setCurrentView] = useState('dayGridMonth'); // 현재 캘린더 뷰

  // 로딩 시작 시 공통 처리 함수
  const startLoading = useCallback(() => {
    // 모든 모달 닫기
    setShowTaskModal(false);
    setShowLifestyleModal(false);
    setShowTaskManagementModal(false);
    
    // 화면 맨 위로 스크롤
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // 로딩 상태 시작
    setIsLoading(true);
  }, [setIsLoading]);

  // === 단일 진입점: 스케줄 생성 =================================
  // ✅ 기본값을 'smart'로 변경: 중요 태스크의 반복 배치 보장 + 유연한 필터링
  const runSchedule = useCallback(async (promptBase, parsedLifestylePatterns, whitelistMode = 'smart') => {
    if (!user?.uid) { addAIMessage("로그인이 필요합니다."); return; }
    startLoading();
    try {
      const USE_FIRESTORE = String(process.env.REACT_APP_USE_FIRESTORE || 'true') === 'true';
      const tasksForAI = await buildTasksForAI(
        user.uid,
        USE_FIRESTORE ? firestoreService : null,
        { fetchLocalTasks: (window?.shedAI && window.shedAI.fetchLocalTasks) ? window.shedAI.fetchLocalTasks : null }
      );
      const schedule = await generateAndApplySchedule({
        generateScheduleAPI: generateSchedule,
        calendarApi: calendarRef.current?.getApi(),
        userId: user.uid,
        today,
        conversationContext,
        parsedLifestylePatterns,
        messagesBasePrompt: promptBase,
        tasksForAI,
        updateSchedule,
        whitelistMode,
      });
      
      await saveScheduleSessionUnified({
        uid: user.uid,
        schedule,
        lifestyleList: parsedLifestylePatterns,
        aiPrompt: promptBase,
        conversationContext
      });
      
      setShowLifestyleModal(false);
      addAIMessage("스케줄이 생성되었습니다!");
      return schedule;
    } catch (e) {
      console.error('스케줄 생성 실패:', e);
      addAIMessage("스케줄 생성에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
      notify('✅ 스케줄 설계가 완료되었습니다!');
    }
  }, [user?.uid, today, generateSchedule, updateSchedule, conversationContext, addAIMessage, startLoading, setIsLoading]);
  // ============================================================

  // 스케줄 생성 콜백 (runSchedule 사용)
  const handleScheduleGeneration = useCallback(async (prompt, message) => {
    if (!user?.uid) { addAIMessage("로그인이 필요합니다."); return; }
    addAIMessage(message);
    
    const patternsForAI = (Array.isArray(lifestyleList) && typeof lifestyleList[0] === 'string')
      ? lifestyleList
      : await firestoreService.getLifestylePatterns(user.uid);
    
    const parsedPatterns = Array.isArray(patternsForAI) && typeof patternsForAI[0] === 'string'
      ? parseLifestyleLines(patternsForAI.join('\n'))
      : patternsForAI;
    
    // 기본적으로 'smart' 모드 사용 (중요 태스크 반복 보장 + 유연한 필터링)
    await runSchedule(prompt, parsedPatterns, 'smart');
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
      
      const USE_FIRESTORE = String(process.env.REACT_APP_USE_FIRESTORE || 'true') === 'true';
      const { existingTasksForAI, taskText } = await buildTasksForAI(
        user.uid,
        USE_FIRESTORE ? firestoreService : null,
        { fetchLocalTasks: (window?.shedAI && window.shedAI.fetchLocalTasks) ? window.shedAI.fetchLocalTasks : null }
      );
      
      // 3. 생활패턴을 텍스트로 변환 (파싱된 패턴 사용)
      const lifestyleText = parsedPatterns
        .filter(pattern => pattern && pattern.days && Array.isArray(pattern.days))
        .map(pattern => 
          `${pattern.days.join(',')} ${pattern.start || '00:00'}-${pattern.end || '00:00'} ${pattern.title || '제목없음'}`
        ).join("\n");
      
      
      // 5. 스케줄 생성 (직접 호출로 변경)
      const promptBase = enforceScheduleRules(
        lastSchedule 
          ? buildFeedbackPrompt(lifestyleText, taskText, lastSchedule)
          : buildShedAIPrompt(lifestyleText, taskText, today)
      );
      
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
        parsedPatterns, // ✅ 파싱된 패턴 사용
        existingTasksForAI,
        { userId: user.uid, sessionId }
      );
      // 응답 통일: 배열/객체 모두 허용
      const normalized = apiResp?.schedule ? apiResp : { schedule: apiResp };
      
      // 공통 후처리 파이프라인 사용 (중요 태스크 반복 보장을 위해 'smart' 사용)
      const processedSchedule = postprocessSchedule({
        raw: normalized.schedule,
        parsedPatterns,
        existingTasksForAI,
        today,
        whitelistPolicy: 'smart'
      });
      const withAppts = placeAppointmentsPass(processedSchedule, existingTasksForAI, today);
      let withTasks = placeTasksPass(withAppts, existingTasksForAI, today);
      // 디듀프 안전망
      withTasks = withTasks.map(day => ({
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
      
      updateSchedule({ schedule: withTasks });
      addAIMessage("스케줄이 생성되었습니다!");

      const scheduleSessionId = await saveScheduleSessionUnified({
        uid: user.uid,
        schedule: withTasks,
        lifestyleList: parsedPatterns, // ✅ 파싱된 패턴 저장
        aiPrompt: promptBase,
        conversationContext
      });
      
      // 안전한 세션 ID 설정
      if (scheduleSessionId && typeof scheduleSessionId === 'string') {
      setCurrentScheduleSessionId(scheduleSessionId);
      } else {
        console.warn('[handleSaveAndGenerate] 세션 ID가 유효하지 않음:', scheduleSessionId);
      }
      
    } catch (error) {
      console.error('저장 및 스케줄 생성 실패:', error);
      const errorMessage = error.response?.data?.message || error.message || '알 수 없는 오류가 발생했습니다.';
      addAIMessage('저장 및 스케줄 생성에 실패했습니다: ' + errorMessage);
    } finally {
      setIsLoading(false);
      notify('스케줄 설계가 완료되었습니다!');
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
      
      const USE_FIRESTORE = String(process.env.REACT_APP_USE_FIRESTORE || 'true') === 'true';
      const { existingTasksForAI, taskText } = await buildTasksForAI(
        user.uid,
        USE_FIRESTORE ? firestoreService : null,
        { fetchLocalTasks: (window?.shedAI && window.shedAI.fetchLocalTasks) ? window.shedAI.fetchLocalTasks : null }
      );
      
      const lifestyleText = parsedPatterns
        .filter(pattern => pattern && pattern.days && Array.isArray(pattern.days))
        .map(pattern => {
          let dayKeyword = '';
          if (pattern.days.length === 7) {
            dayKeyword = '매일';
          } else if (pattern.days.length === 2 && pattern.days.includes(6) && pattern.days.includes(7)) {
            dayKeyword = '주말';
          } else if (pattern.days.length === 5 && pattern.days.every(day => day >= 1 && day <= 5)) {
            dayKeyword = '평일';
          } else {
            const dayNames = ['', '월', '화', '수', '목', '금', '토', '일'];
            dayKeyword = pattern.days.map(day => dayNames[day] + '요일').join(' ');
          }
          
          const formatTime = (time) => {
            const [hRaw,mRaw='0'] = String(time||'0:00').split(':');
            const h = parseInt(hRaw||'0',10) || 0;
            const mm = String(parseInt(mRaw||'0',10)||0).padStart(2,'0');
            if (h === 0)  return `자정 ${mm==='00'?'':mm+'분'}`.trim();
            if (h === 12) return `정오 ${mm==='00'?'':mm+'분'}`.trim();
            const ampm = h<12 ? '오전' : '오후';
            const hh12 = ((h+11)%12)+1;
            return `${ampm} ${hh12}시${mm==='00'?'':' '+mm+'분'}`;
          };
          
          const startTime = formatTime(pattern.start ?? '0:00');
          const endTime = formatTime(pattern.end ?? '0:00');
          
          return `${dayKeyword} ${startTime}~ ${endTime} ${pattern.title || '제목없음'}`;
        }).join("\n");
      
      const promptBase = lastSchedule 
        ? buildFeedbackPrompt(lifestyleText, taskText, lastSchedule)
        : buildShedAIPrompt(lifestyleText, taskText, today);
      
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
            nowOverride: toYMDLocal(new Date()) + 'T00:00:00',
            anchorDay: today.getDay() === 0 ? 7 : today.getDay()
          }
        );
        const normalized = apiResp?.schedule ? apiResp : { schedule: apiResp };
        const processedSchedule = postprocessSchedule({
          raw: normalized.schedule,
          parsedPatterns,
          existingTasksForAI,
          today,
          whitelistPolicy: 'smart'
        });
        
        const api = calendarRef.current?.getApi();
        api?.removeAllEvents();
        updateSchedule({ schedule: processedSchedule });
        
        const scheduleSessionId = await saveScheduleSessionUnified({
          uid: user.uid,
          schedule: processedSchedule,
          lifestyleList: parsedPatterns, 
          aiPrompt: promptBase,                          
          conversationContext
        });
        
        if (scheduleSessionId && typeof scheduleSessionId === 'string') {
        setCurrentScheduleSessionId(scheduleSessionId);
        } else {
          console.warn('[handleTaskManagementSave] 세션 ID가 유효하지 않음:', scheduleSessionId);
        }
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
      setIsLoading(false);
      notify('스케줄 설계가 완료되었습니다!');
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
      const feedbackPrompt = enforceScheduleRules(buildFeedbackPrompt(lifestyleText, messageText, lastSchedule));
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
    
    // NEW: 채팅에서 할 일 감지 → Firestore에 선 저장
    // parseTaskFromFreeText는 **원본 메시지**로 파싱
    console.log('[handleProcessMessageWithAI] 할 일 파싱 시도, messageText:', messageText);
    try {
      const parsed = parseTaskFromFreeText(messageText, today);
      console.log('[handleProcessMessageWithAI] parseTaskFromFreeText 결과:', parsed);
      if (parsed) {
        if (user?.uid) {
          console.log('[CalendarPage] 채팅에서 할 일 파싱 성공:', parsed);
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
    
    // 생활패턴을 객체로 가져와서 텍스트로 변환
    let lifestyleText = '';
    let patternsForAI = [];
    
    if (Array.isArray(lifestyleList) && typeof lifestyleList[0] === 'string') {
      // 문자열 배열이면 파싱해서 사용
      patternsForAI = parseLifestyleLines(lifestyleList.join('\n'));
      lifestyleText = lifestyleList.join('\n');
    } else {
      // 객체 배열이면 Firestore에서 다시 로드
      const lifestylePatternsForAI = await firestoreService.getLifestylePatterns(user.uid);
      
      patternsForAI = Array.isArray(lifestylePatternsForAI) && typeof lifestylePatternsForAI[0] === 'string'
        ? parseLifestyleLines(lifestylePatternsForAI.join('\n'))
        : lifestylePatternsForAI;
        
      lifestyleText = patternsForAI.map(p => 
        typeof p === 'string' ? p : `${p.title} (${p.start}-${p.end}, 요일: ${p.days?.join(', ') || '미정'})`
      ).join('\n');
    }
    
    const promptBase = enforceScheduleRules(
      lastSchedule 
        ? buildFeedbackPrompt(lifestyleText, processedMessage, lastSchedule)
        : buildShedAIPrompt(lifestyleText, processedMessage, today)
    );
    
    // 현재 할 일 목록을 프롬프트에 직접 주입
    const USE_FIRESTORE = String(process.env.REACT_APP_USE_FIRESTORE || 'true') === 'true';
    const { existingTasksForAI, taskText } = await buildTasksForAI(
      user?.uid,
      USE_FIRESTORE ? firestoreService : null,
      { fetchLocalTasks: (window?.shedAI && window.shedAI.fetchLocalTasks) ? window.shedAI.fetchLocalTasks : null }
    );

    let timeoutId;
    let controller;
    try {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 60000);
      
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
          promptContext: `${promptBase}\n\n[현재 할 일 목록]\n${taskText || '할 일 없음'}`,  
          signal: controller.signal  
        }
      );
      const newSchedule = apiResp?.schedule ? apiResp : { schedule: apiResp };
      
      clearTimeout(timeoutId);

      let finalSchedule = newSchedule.schedule;

      const nextBase = postprocessSchedule({
        raw: finalSchedule,
        parsedPatterns: patternsForAI,
        existingTasksForAI,
        today,
        whitelistPolicy: 'smart'
      });
      const nextAppts = placeAppointmentsPass(nextBase, existingTasksForAI, today);
      let next = placeTasksPass(nextAppts, existingTasksForAI, today);
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

      // 최종 스케줄로 한 번만 업데이트
      updateSchedule({ schedule: next });

      // 통일된 저장 사용
      const scheduleSessionId = await saveScheduleSessionUnified({
        uid: user.uid,
        schedule: next,
        lifestyleList: patternsForAI, 
        aiPrompt: promptBase,                     
        conversationContext
      });
      
      // 안전한 세션 ID 설정
      if (scheduleSessionId && typeof scheduleSessionId === 'string') {
        setCurrentScheduleSessionId(scheduleSessionId);
        } else {
        console.warn('[handleProcessMessageWithAI] 세션 ID가 유효하지 않음:', scheduleSessionId);
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
      const aborted = e?.name === 'AbortError' || /aborted|signal/i.test(String(e));
      console.error('스케줄 생성 요청 실패:', e);
      addAIMessage(aborted ? "요청이 시간 초과되었습니다. 잠시 후 다시 시도해주세요." 
                           : "요청 실패: 다시 시도해주세요.");
    } finally {
      clearTimeout?.(timeoutId);
      setIsLoading(false);
      controller = undefined;
      notify('스케줄 설계가 완료되었습니다!');
    }
  };

  // 캘린더 초기화 함수
  const handleResetCalendar = async () => {
    if (!user?.uid) return;
    if (window.confirm("모든 일정을 초기화하시겠습니까?")) {
      try {
        await firestoreService.deleteLatestSchedule(user.uid);
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
    const viewType = calendarRef.current?.getApi().view.type;
    if (viewType) {
      setCurrentView(viewType);
    }
  };

  const handleDatesSet = (arg) => {
    setCurrentView(arg.view.type); // 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' 등
  };

  const handleDayHeaderContent = (args) => {
    const weekday = args.date.toLocaleDateString("ko-KR", { weekday: "short" });
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
      
      // 기존 이벤트 리스너 제거 후 새로 추가 (누수 방지)
      checkbox.onchange = null;
      checkbox.addEventListener('change', onChange, { once: true });

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
        events={
          currentView === 'dayGridMonth'
            ? allEvents.filter(e => (e?.extendedProps?.type || '').toLowerCase() !== 'lifestyle')
            : allEvents
        }
        onEventMount={handleEventMount}
        onViewDidMount={handleViewDidMount}
        onDatesSet={handleDatesSet}
        onDayHeaderContent={handleDayHeaderContent}
        onEventContent={handleEventContent}
        eventClassNames={(arg) => {
          return (arg.event.extendedProps?.type === 'lifestyle') ? ['is-lifestyle'] : [];
        }}
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
        onTaskRefresh={() => {
        }}
      />
    </div>
  );
}

export default CalendarPage;