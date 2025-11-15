// scheduleUtils.js: 스케줄과 관련된 모든 처리 로직을 담당하는 유틸리티
import { parseDateString } from './dateUtils';
import { toISODateLocal, toKoreanDate, toLocalMidnightDate } from './dateNormalize';
import { normalizeCategoryName } from './categoryAlias';
import { inferCategory } from './categoryClassifier';
import { extractTaskTitle } from './taskParse';

// 디버깅 유틸리티 (환경 독립형)
const isDev =
  (typeof import.meta !== 'undefined' && import.meta.env?.MODE !== 'production') ||
  (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production');

const debug = (...args) => {
  if (isDev) console.log(...args);
};

// 시간 리셋 함수: 하루의 시작 또는 끝으로 설정
export function resetToStartOfDay(date, isEnd = false) {
    const newDate = new Date(date);
    if (isEnd)
      newDate.setHours(23, 59, 59, 999);
    else
      newDate.setHours(0, 0, 0, 0);
    return newDate;
  }
  
  // 요일 변환 함수: JS 기준(일=0) → GPT 기준(월=1 ~ 일=7)
  export function getGptDayIndex(date) {
    const jsDay = date.getDay();
    return jsDay === 0 ? 7 : jsDay;
  }
  
  // 날짜 → ISO 문자열 포맷
  export function formatLocalISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  }

  
  // ⚠️ 간소화: 서버의 aiService.js가 자체 시스템 프롬프트를 생성하므로,
  // 클라이언트에서는 실제 사용자 입력(생활 패턴, 할 일 목록)만 포함합니다.
  // 이렇게 하면 사용자 프롬프트 길이가 크게 줄어듭니다.
export function buildShedAIPrompt(lifestyleText, taskText, nowLike, existingTasksForAI = [], feedbackText = '') {
  // 서버에서 이미 시스템 프롬프트를 생성하므로, 여기서는 사용자 데이터만 반환
  const parts = [];
  
  if (lifestyleText && lifestyleText.trim()) {
    parts.push(`[생활 패턴]\n${lifestyleText.trim()}`);
  }
  
  if (taskText && taskText.trim()) {
    parts.push(`[할 일 목록]\n${taskText.trim()}`);
  }
  
  // 피드백 텍스트가 있으면 별도 섹션으로 추가 (최우선 반영 강조)
  if (feedbackText && feedbackText.trim()) {
    parts.push(`[추가 피드백 - 최우선 반영]\n${feedbackText.trim()}\n\n⚠️ 위 피드백 조건을 기존 규칙보다 우선적으로 반영해주세요.`);
  }
  
  return parts.join('\n\n') || '스케줄을 생성해주세요.';
  }
  
  // ⚠️ 간소화: 서버의 aiService.js가 자체 시스템 프롬프트를 생성하므로,
  // 클라이언트에서는 기존 스케줄과 사용자 피드백만 포함합니다.
  export function buildFeedbackPrompt(lifestyleText, taskText, previousSchedule, existingTasksForAI = [], feedbackText = '') {
    const parts = [];
    
    if (previousSchedule && Array.isArray(previousSchedule) && previousSchedule.length > 0) {
      parts.push(`[기존 시간표]\n${JSON.stringify(previousSchedule, null, 2)}`);
    }
    
    if (lifestyleText && lifestyleText.trim()) {
      parts.push(`[생활 패턴]\n${lifestyleText.trim()}`);
    }
    
    if (taskText && taskText.trim()) {
      parts.push(`[할 일 목록]\n${taskText.trim()}`);
    }
    
    // 피드백 텍스트가 있으면 별도 섹션으로 추가 (최우선 반영 강조)
    if (feedbackText && feedbackText.trim()) {
      parts.push(`[피드백 - 최우선 반영]\n${feedbackText.trim()}\n\n⚠️ 위 피드백 조건을 기존 스케줄 수정 시 최우선으로 반영해주세요. 기존 스케줄에서 수정 요청이 없는 활동은 최대한 유지하되, 피드백 조건을 만족하도록 재배치해주세요.`);
    }
    
    return parts.join('\n\n') || '기존 스케줄을 수정해주세요.';
  }
  

  // GPT → FullCalendar 이벤트 변환기 (배열만 받음)
export function convertScheduleToEvents(scheduleArray, nowLike = new Date()) {
  const today = resolveNow(nowLike);
  const events = [];
  const ensureHms = (tRaw) => {
      const t = String(tRaw || '00:00');
      if (/^\d+$/.test(t.trim())) {
        const h = parseInt(t, 10) || 0;
        return `${String(h).padStart(2,'0')}:00:00`;
      }
      const [h='0', m='0', s] = t.split(':');
      const hh = String(parseInt(h,10)||0).padStart(2,'0');
      const mm = String(parseInt(m,10)||0).padStart(2,'0');
      const ss = s != null ? String(parseInt(s,10)||0).padStart(2,'0') : '00';
      return `${hh}:${mm}:${ss}`;
    };
    
    // scheduleArray는 이미 정규화된 배열이어야 함
    const scheduleData = scheduleArray;
    
    // 방어 코드: scheduleData가 유효하지 않으면 빈 배열 반환
    if (!scheduleData || !Array.isArray(scheduleData) || scheduleData.length === 0) {
      // 빈 스케줄은 정상적인 경우이므로 경고 대신 디버그 로그만 출력
      debug('convertScheduleToEvents: 빈 스케줄 데이터', {
        scheduleData,
        type: typeof scheduleData,
        isArray: Array.isArray(scheduleData),
        length: scheduleData?.length
      });
      return events;
    }
    
    // 오늘의 day 값 계산 (일요일=7, 월요일=1, ..., 토요일=6)
    const todayDayOfWeek = today.getDay();
    const baseDay  = todayDayOfWeek === 0 ? 7 : todayDayOfWeek;

    scheduleData.forEach(dayBlock => {
      if (!dayBlock || typeof dayBlock.day !== 'number') {
        return;
      }
      
      const dateOffset = dayBlock.day - baseDay;
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + dateOffset);
      const dateStr = formatLocalISO(targetDate).split('T')[0];

      if (!dayBlock.activities || !Array.isArray(dayBlock.activities)) {
        return;
      }

      dayBlock.activities.forEach(activity => {
        if (!activity || !activity.start || !activity.title) {
          return;
        }
        
        const start = new Date(`${dateStr}T${ensureHms(activity.start)}`);
        let end;
        
        // end가 없을 때만 fallback duration 적용 (task는 120분, lifestyle은 90분)
        if (!activity.end) {
          const isTask = (activity.type || '').toLowerCase() === 'task';
          const fallbackDuration = isTask ? 120 : 90; // task는 120분, lifestyle은 90분
          end = new Date(start.getTime() + fallbackDuration * 60 * 1000);
        } else {
          end = new Date(`${dateStr}T${ensureHms(activity.end)}`);
        }
        
        // 카테고리 자동 분류 및 정규화 적용
        const rawCategory = activity.category || inferCategory(activity);
        const normalizedCategory = normalizeCategoryName(rawCategory);
        
        const extendedProps = {
          type: activity.type || "task",
          importance: activity.importance,
          difficulty: activity.difficulty,
          isRepeating: !!activity.isRepeating,
          description: activity.description,
          category: normalizedCategory,
          confidence: activity.confidence ?? undefined,
          taskId: activity.taskId ?? null,  // taskId 포함
          originalDay: dayBlock.day,        // 원본 day 저장 (드래그 앤 드롭 매칭용)
          originalStart: activity.start,    // 원본 start 시간 저장 (드래그 앤 드롭 매칭용)
          originalEnd: activity.end         // 원본 end 시간 저장 (드래그 앤 드롭 매칭용)
        };
        

        if (end < start) {
          // 자정을 넘어가는 스케줄을 오늘 날짜에 두 개의 이벤트로 분할
          const endOfToday = resetToStartOfDay(start, true); // 당일 23:59:59.999
          const startOfToday = resetToStartOfDay(start); // 당일 00:00:00
          const endTime = new Date(startOfToday);
          endTime.setHours(end.getHours(), end.getMinutes(), end.getSeconds(), 0); // 원래 end 시각

          const eventIdPrefix = `${(activity.title||'').trim()}__${dateStr}`;
          const endOfTodayTimeStr = formatLocalISO(endOfToday).split('T')[1].slice(0, 8);
          const endTimeStr = formatLocalISO(endTime).split('T')[1].slice(0, 8);
          
          // 당일 뒷부분 (예: 21:00~24:00)
          events.push({
            id: `${eventIdPrefix}__${ensureHms(activity.start)}-${endOfTodayTimeStr}`,
            title: activity.title,
            start: formatLocalISO(start),
            end: formatLocalISO(endOfToday),
            extendedProps
          });
          
          // 당일 앞부분 (예: 00:00~07:00) - 같은 날짜에 표시
          events.push({
            id: `${eventIdPrefix}__00:00:00-${endTimeStr}`,
            title: activity.title,
            start: formatLocalISO(startOfToday),
            end: formatLocalISO(endTime),
            extendedProps
          });
          return;
        }

        const endTimeStr = formatLocalISO(end).split('T')[1].slice(0, 8);
        const eventId = `${(activity.title||'').trim()}__${dateStr}__${ensureHms(activity.start)}-${endTimeStr}`;
        
        events.push({
          id: eventId,
          title: activity.title,
          start: formatLocalISO(start),
          end: formatLocalISO(end),
          extendedProps
        });

      });
    });

    return events;
  }
  
// 날짜를 day 인덱스로 변환하는 함수 (오늘부터 상대적인 일수)
export function convertToRelativeDay(targetDate, baseDate = new Date()) {
  if (!targetDate) return null;
  const startOfBaseDate = resetToStartOfDay(baseDate);
  const startOfTargetDate = resetToStartOfDay(targetDate);
  const diffTime = startOfTargetDate.getTime() - startOfBaseDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const todayGptDay = getGptDayIndex(baseDate);
  return todayGptDay + diffDays;
}

// ============================================================
// CalendarPageRefactored에서 이동된 함수들
// ============================================================

// 타이틀 정규화 헬퍼
const normTitle = (s='') => s.replace(/\s+/g, ' ').trim();
// 의미 기준 표준 타이틀(동의/접미 제거)
const canonTitle = (s='') => {
  const base = String(s).toLowerCase();
  const stripped = base
    // 괄호/구분자/기호 제거
    .replace(/[()\[\]{}<>_\-*–—:.,\/\\|+~!@#$%^&=]/g, '')
    // 공백 제거
    .replace(/\s+/g, '')
    // 흔한 접미사 제거(어말)
    .replace(/(준비|공부|하기)$/g, '')
    // 세션 꼬리표, 진행표기 제거
    .replace(/(집중세션|세션|몰입|분할|라운드)\d*/g, '')
    .replace(/\d+\/\d+/g, '')
    .trim();
  return stripped || base.replace(/\s+/g,'');
};

// YYYY-MM-DD 문자열을 로컬 자정 Date로 파싱
const parseYYYYMMDDLocal = (s) => {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mm = +m[2], dd = +m[3];
  return new Date(y, mm - 1, dd, 0, 0, 0, 0);
};

// 유사 매칭 기반 데드라인 day 찾기
function findDeadlineDayForTitle(actTitle, deadlineMap) {
  if (!deadlineMap || !deadlineMap.size) return null;
  const actKey = canonTitle(actTitle || '');
  if (!actKey) return null;

  if (deadlineMap.has(actKey)) return deadlineMap.get(actKey);

  for (const [taskKey, dlDay] of deadlineMap.entries()) {
    if (!taskKey) continue;
    if (actKey.startsWith(taskKey) || taskKey.startsWith(actKey)) return dlDay;
    if (actKey.includes(taskKey) || taskKey.includes(actKey)) return dlDay;
  }

  const tokenize = (k) => String(k).replace(/[^가-힣a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  const aTok = tokenize(actKey);
  let best = { score: 0, dlDay: null };
  for (const [taskKey, dlDay] of deadlineMap.entries()) {
    const tTok = tokenize(taskKey);
    if (tTok.length === 0 || aTok.length === 0) continue;
    const setA = new Set(aTok);
    let hit = 0;
    for (const t of tTok) if (setA.has(t)) hit++;
    const score = hit / Math.max(tTok.length, aTok.length);
    if (score > best.score) best = { score, dlDay };
  }
  return best.score >= 0.5 ? best.dlDay : null;
}

// 시간 유틸리티
const hhmmToMin = (s) => {
  const [h,m] = String(s||'').split(':').map(n=>parseInt(n||'0',10));
  return (isNaN(h)?0:h)*60 + (isNaN(m)?0:m);
};

const minToHHMM = (min) => {
  const h = Math.floor(min/60)%24;
  const m = min%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
};

// 시험/평가류 제목 판별
function isExamTitle(t='') {
  return /시험|테스트|평가|자격증|오픽|토익|토플|텝스|면접/i.test(String(t));
}

// 날짜 파싱 헬퍼
const pickNextDate = (y, m, d, today) => {
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (dt < base) dt.setFullYear(dt.getFullYear() + 1);
  return dt;
};

const tryParseLooseKoreanDate = (s, today) => {
  let m = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3], 0, 0, 0, 0);
  m = s.match(/(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3], 0, 0, 0, 0);
  m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return pickNextDate(today.getFullYear(), +m[1], +m[2], today);
  m = s.match(/(\d{1,2})\s*[\.\/\-]\s*(\d{1,2})(?!\d)/);
  if (m) return pickNextDate(today.getFullYear(), +m[1], +m[2], today);
  return null;
};

const isExamLike = (t='') => /(오픽|토익|토플|텝스|토스|면접|자격증|시험|테스트|평가)/i.test(t);

const safeParseDateString = (text, today) => {
  try {
    const result = parseDateString(text, today);
    // parseDateString이 이제 { date, hasTime, time } 형태로 반환
    return result?.date || result;
  } catch { return null; }
};

// YYYY.MM.DD / YYYY-MM-DD / M월 D일 + (오전|오후) HH(:mm)? "시" 조합까지 처리
function tryParseKoreanDateTime(s, today = new Date()) {
  const text = String(s || '').replace(/\s+/g, ' ').trim();

  // 1) YYYY.MM.DD HH(:mm)? (AM/PM 한국어)
  let m = text.match(/(\d{4})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})\s*(오전|오후)?\s*(\d{1,2})(?::(\d{1,2}))?\s*시?/);
  if (m) {
    const y = +m[1], M = +m[2] - 1, d = +m[3];
    let h = +(m[5] || 0), mm = +(m[6] || 0);
    if (m[4] === '오후' && h < 12) h += 12;
    if (m[4] === '오전' && h === 12) h = 0;
    return new Date(y, M, d, h, mm, 0, 0);
  }

  // 2) M월 D일 (AM/PM) HH(:mm)? "시"
  m = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(오전|오후)?\s*(\d{1,2})(?::(\d{1,2}))?\s*시?/);
  if (m) {
    const y = today.getFullYear(), M = +m[1] - 1, d = +m[2];
    let h = +(m[4] || 0), mm = +(m[5] || 0);
    if (m[3] === '오후' && h < 12) h += 12;
    if (m[3] === '오전' && h === 12) h = 0;
    const dt = new Date(y, M, d, h, mm, 0, 0);
    // 과거면 내년으로 밀어주는 옵션 (원래 코드 정책과 일치)
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (dt < base) dt.setFullYear(dt.getFullYear() + 1);
    return dt;
  }

  return null;
}

// 약속/회의 키워드 체크용 정규식
const APPOINTMENT_KEYWORDS = /(브런치|점심|저녁|약속|미팅|회의|면담|인터뷰|진료|병원|상담|촬영|행사|발표|수업|강의|세미나|티타임|점심 회동|식사 약속|식사)/i;

// 채팅 문장 → 태스크 파싱
export const parseTaskFromFreeText = (text, nowLike = new Date()) => {
  const today = resolveNow(nowLike);
  if (!text || typeof text !== 'string') return null;
  const s = text.replace(/\s+/g, ' ').trim();

  let parsed = null;
  try {
    parsed = parseDateString(s, today);
  } catch (e) {
    debug('[parseTaskFromFreeText] parseDateString 오류:', e);
  }

  let deadlineDate = null;
  let deadlineTime = null;

  if (parsed && parsed.date) {
    deadlineDate = parsed.date;
    if (parsed.hasTime && parsed.time) {
      deadlineTime = parsed.time;
    }
  }

  // fallback: 기존 로직 유지 (날짜를 못 찾은 경우)
  if (!deadlineDate || isNaN(deadlineDate.getTime())) {
    // 0) 날짜+시간 한 번에 잡기
    let dtFull = tryParseKoreanDateTime(s, today);

    if (!dtFull) {
      const rawCandidates = s.match(/(\d{4}\s*[.\-\/]\s*\d{1,2}\s*[.\-\/]\s*\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}[.\-\/]\d{1,2})/g) || [];
      for (const cand of rawCandidates) {
        const dt = tryParseLooseKoreanDate(cand, today);
        if (dt instanceof Date && !isNaN(dt.getTime())) {
          deadlineDate = dt;
          break;
        }
      }
    } else {
      deadlineDate = dtFull;
      const hh0 = dtFull.getHours();
      const mm0 = dtFull.getMinutes();
      if (!(hh0 === 0 && mm0 === 0)) {
        deadlineTime = `${String(hh0).padStart(2,'0')}:${String(mm0).padStart(2,'0')}`;
      }
    }

    if (!deadlineDate || isNaN(deadlineDate.getTime())) {
      const rel = s.match(/(\d+)\s*(일|주)\s*(후|뒤)/);
      if (rel) {
        const n = +rel[1], unit = rel[2];
        const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        base.setDate(base.getDate() + (unit === '주' ? n*7 : n));
        deadlineDate = base;
      }
    }
  }

  if (!deadlineDate || isNaN(deadlineDate.getTime())) return null;

  // 제목 생성: extractTaskTitle 함수 사용 (서버와 동일한 로직)
  let title = '';
  if (isExamLike(s)) {
    // 시험 관련은 특별 처리
    const word = (s.match(/(오픽|토익|토플|텝스|토스|면접|자격증|시험|테스트|평가)/i)?.[1] || '').trim();
    title = `${/시험$/i.test(word) ? word : `${word} 시험`}`.trim();
    if (/(준비|공부|학습)/.test(s)) title += ' 준비';
  } else {
    // 일반 task는 extractTaskTitle 함수 사용 (서버와 동일한 로직)
    title = extractTaskTitle(s);
    
    // extractTaskTitle이 실패한 경우 fallback
    if (!title || title === '할 일' || title.length < 2) {
      const appointmentKeywords = /(회의|미팅|면담|인터뷰|진료|병원|상담|촬영|행사|발표|수업|강의|세미나|약속)/;
      const taskKeywords = /([가-힣A-Za-z0-9\s]+?)\s*(과제|보고서|프로젝트|발표|신청|접수|등록|업무|자료|문서|준비)/;
      
      // 1) 회의/약속 키워드 우선 체크
      const apptMatch = s.match(appointmentKeywords);
      if (apptMatch && apptMatch[1]) {
        title = apptMatch[1];
      } else {
        // 2) 일반 과제/프로젝트 키워드 체크
        const keywordMatch = s.match(taskKeywords);
        if (keywordMatch && keywordMatch[1] && keywordMatch[2]) {
          let keyword = keywordMatch[1].trim();
          // 날짜/시간 표현 제거
          keyword = keyword
            .replace(/^(오늘|내일|모레|이번주|다음주|다다음주)\s*(월|화|수|목|금|토|일)요일?\s*/, '')
            .replace(/^(오는|이번|다음|다다음)\s*([월화수목금토일])요일\s*/, '')
            .replace(/^(오전|오후)\s*\d{1,2}\s*(?:시|:)\s*(?:\d{1,2}\s*(?:분)?)?\s*(?:에)?\s*/, '')
            .replace(/^\d{1,2}\s*(?:시|:)\s*(?:\d{1,2}\s*(?:분)?)?\s*(?:에)?\s*/, '')
            .trim();
          title = keyword && keyword.length >= 2 
            ? `${keyword} ${keywordMatch[2]}` 
            : keywordMatch[2] || '할 일';
        } else {
          title = '할 일';
        }
      }
    }
  }

  const levelMap = { 상:'상', 중:'중', 하:'하' };
  const impRaw = (s.match(/중요도\s*(상|중|하)/)?.[1]);
  const diffRaw = (s.match(/난이도\s*(상|중|하)/)?.[1]);
  const isExam = isExamLike(s);
  const importance = levelMap[impRaw] || (isExam ? '상' : '중');
  const difficulty = levelMap[diffRaw] || (isExam ? '상' : '중');
  const localMid = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate());
  const looksAppointment = APPOINTMENT_KEYWORDS.test(s) || !!deadlineTime;

  const result = {
    title,
    importance,
    difficulty,
    description: s.replace(title, '').trim(),
    deadlineAtMidnight: localMid,
    deadlineTime,
    estimatedMinutes: looksAppointment ? 60 : (isExam ? 150 : 120),
    type: looksAppointment ? 'appointment' : 'task'
  };

  // 약속인데 시각이 빠졌다면, 안전 기본값(예: 12:00) 보강
  if (result.type === 'appointment' && !result.deadlineTime) {
    result.deadlineTime = '12:00';
  }

  return result;
};

// 할 일을 existingTasks와 사람이 읽는 taskText로 동시에 만들기
export const buildTasksForAI = async (uid, firestoreService, opts = {}) => {
  const fetchLocalTasks = opts.fetchLocalTasks; // async (uid) => [{ title, deadline, importance, difficulty, description, isActive }]
  let all = [];

  // Firestore
  try {
    if (firestoreService?.getAllTasks) {
      all = await firestoreService.getAllTasks(uid);
    } else {
      if (isDev) console.debug('[buildTasksForAI] firestoreService 미주입: Firestore 스킵');
      all = [];
    }
  } catch (error) {
    if (isDev) console.debug('[buildTasksForAI] Firestore 조회 실패:', error?.message);
    all = [];
  }

  // 로컬 DB
  let localDbTasks = [];
  try {
    if (typeof fetchLocalTasks === 'function') {
      localDbTasks = await fetchLocalTasks(uid);
    }
  } catch (e) {
    console.warn('[buildTasksForAI] 로컬 DB 조회 실패:', e?.message);
    localDbTasks = [];
  }

  // 로컬 스토리지
  const readTempTasks = () => {
    try {
      const cands = ['shedAI:tempTasks', 'shedAI:tasks', 'tasks'];
      for (const k of cands) {
        const s = localStorage.getItem(k);
        if (s) return JSON.parse(s);
      }
    } catch {}
    return [];
  };
  const tempTasks = readTempTasks();

  // 여러 형태의 마감일을 로컬 자정 Date로 정규화
  const toDateAtLocalMidnight = (v) => {
    try {
      if (!v) return null;
      if (v.toDate) v = v.toDate();
      if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
      if (typeof v === 'string') {
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return new Date(+m[1], +m[2]-1, +m[3]);
        const d = new Date(v);
        if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      }
      return null;
    } catch { return null; }
  };

  const combinedTasksRaw = [...(all || []), ...(localDbTasks || []), ...(tempTasks || [])];
  const active = (combinedTasksRaw || [])
    .map(t => ({
      ...t,
      isActive: t.isActive === undefined ? true : !!t.isActive,
      deadline: toDateAtLocalMidnight(
        t?.deadline ?? t?.deadlineAtMidnight ?? t?.deadlineAt ?? t?.dueDate ?? t?.due
      )
    }))
    .filter(t => t && t.isActive);

  const existingTasksForAI = active.map(t => ({
    title: normTitle(t.title || '제목없음'),
    deadline: (() => {
      if (t.deadline instanceof Date) {
        return `${t.deadline.getFullYear()}-${String(t.deadline.getMonth()+1).padStart(2,'0')}-${String(t.deadline.getDate()).padStart(2,'0')}`;
      }
      if (typeof t.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.deadline)) return t.deadline;
      // ✅ 최후의 수단: 오늘 날짜를 사용해 캡 맵 비는 상황 방지
      const today = new Date();
      return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    })(),
    importance: t.importance || '중',
    difficulty: t.difficulty || '중',
    description: t.description || '',
    type: (t.type || 'task'),
    deadlineTime: t.deadlineTime || null,
    estimatedMinutes: t.estimatedMinutes || 120
  }));

  const taskText = active.map(t => {
    const iso = t.deadline
      ? `${t.deadline.getFullYear()}-${String(t.deadline.getMonth()+1).padStart(2,'0')}-${String(t.deadline.getDate()).padStart(2,'0')}`
      : '';
    const dd = toKoreanDate(iso);
    return `${t.title || '제목없음'} (마감일: ${dd || '미설정'}, 중요도: ${t.importance || '중'}, 난이도: ${t.difficulty || '중'})`;
  }).join('\n');

  return { existingTasksForAI, taskText };
};

// 공통 메시지 빌더
// ⚠️ 최적화: enforceScheduleRules 제거 (규칙은 서버 systemPrompt에 통합됨)
// 클라이언트는 데이터만 전달하고, 규칙은 서버에서 관리
export const buildScheduleMessages = ({ basePrompt, conversationContext, existingTasksForAI, taskText, useMinimalTaskText = false }) => {
  // taskText 최적화 옵션: JSON만 사용하고 자연어 요약은 생략
  let taskSection = '';
  if (!useMinimalTaskText && taskText && taskText.trim()) {
    taskSection = `\n\n[현재 할 일 목록]\n${taskText.trim()}`;
  }
  // useMinimalTaskText=true면 taskText 생략 (서버의 tasksForAIJSON만 사용)
  
  // conversationContext 최적화: 필요 없으면 줄이기 (기본값: 최근 2개)
  const contextLimit = process.env.REACT_APP_SCHEDULE_CONTEXT_LIMIT 
    ? parseInt(process.env.REACT_APP_SCHEDULE_CONTEXT_LIMIT, 10) 
    : 2;
  
  const messages = [
    ...conversationContext.slice(-contextLimit),
    {
      role: 'user',
      content: `${basePrompt}${taskSection}`
    }
  ].filter(m => m && m.role && typeof m.content === 'string' && m.content.trim());

  return messages;
};

// 생활패턴 제목 정리 함수
const cleanLifestyleTitle = (title, start, end) => {
  if (!title) return '';
  
  const strip = (s='') => s
    .replace(/^[~\-–—|·•,:;\s]+/, '')
    .replace(/[~\-–—|·•,:;\s]+$/, '')
    .replace(/\s{2,}/g,' ')
    .trim();
  let cleaned = strip(title);

  cleaned = cleaned
    .replace(/(?:^|[\s,·•])(매일|평일|주말)(?=$|[\s,·•])/gi,' ')
    .replace(/(?:^|[\s,·•])(매|평)(?=$|[\s,·•])/g,' ')
    .replace(/\bevery\s*day\b/gi,' ');
  cleaned = strip(cleaned);

  if (/^([0-9]{2})$/.test(cleaned)) {
    const n = parseInt(cleaned, 10);
    if (n === 40) cleaned = '점심식사';
    else if (n < 10) cleaned = '아침식사';
    else cleaned = '활동';
  }
  
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


// 요일 정규화 함수
const getKoreanWeekday = (day) => {
  const weekdays = ['', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
  return weekdays[day] || '알 수 없음';
};

// 상대 day 정규화
const normalizeRelativeDays = (schedule, baseDay) => {
  const arr = Array.isArray(schedule) ? schedule : [];
  let current = baseDay;
  return arr.map((dayObj, idx) => {
    let dayNum = Number.isInteger(dayObj?.day) ? dayObj.day : (baseDay + idx);
    if (idx === 0 && dayNum !== baseDay) dayNum = baseDay;
    if (dayNum < current) dayNum = current;
    if (idx > 0 && dayNum <= current) dayNum = current + 1;
    current = dayNum;
    const weekdayNum = ((dayNum - 1) % 7) + 1;
    return {
      ...dayObj,
      day: dayNum,
      weekday: getKoreanWeekday(weekdayNum)
    };
  });
};

// 각 제목의 마감 day 계산
const buildDeadlineDayMap = (existingTasks = [], todayDate) => {
  const map = new Map();
  const base = todayDate.getDay() === 0 ? 7 : todayDate.getDay();
  const toMid = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  
  // ✅ Timestamp/Date/문자열 모두 안전하게 처리 (YYYY-MM-DD는 로컬 자정으로)
  const toDateSafe = (v) => {
    if (!v) return null;
    if (v.toDate) return v.toDate();           // Firestore Timestamp
    if (v instanceof Date) return v;
    if (typeof v === 'string') {
      const ymd = parseYYYYMMDDLocal(v);
      if (ymd) return ymd;
      const parsed = new Date(v);
      if (!isNaN(parsed.getTime())) return parsed;
      const iso = toISODateLocal(v);
      return iso ? new Date(iso) : null;
    }
    return null;
  };
  
  for (const t of (existingTasks || [])) {
    const d0 = toDateSafe(t.deadline);
    if (!d0 || isNaN(d0.getTime())) continue;
    const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()); // 로컬 자정
    const diffDays = Math.floor((toMid(d) - toMid(todayDate)) / (24*60*60*1000));
    const deadlineDay = base + Math.max(0, diffDays);
    map.set(canonTitle(t.title || ''), deadlineDay);
  }
  return map;
};


  // task 메타 보강
const enrichTaskMeta = (schedule, existingTasks=[]) => {
  if (!Array.isArray(schedule)) return schedule;
  const byTitle = new Map();
  // ✅ 타이틀 정규화 일관성: canonTitle로 통일
  (existingTasks||[]).forEach(t => {
    const normalized = canonTitle(t.title || '');
    if (normalized) byTitle.set(normalized, t);
  });

  for (const day of schedule) {
    for (const a of (day.activities||[])) {
      if ((a.type||'').toLowerCase() !== 'task') continue;

      // ✅ 타이틀 정규화로 매칭 (canonTitle)
      const base = byTitle.get(canonTitle(a.title || ''));

      if (isExamTitle(a.title)) {
        a.importance = a.importance || '상';
        a.difficulty = a.difficulty || '상';
        a.isRepeating = a.isRepeating ?? true;
      }

      if (base) {
        if (!a.importance) a.importance = base.importance || '중';
        if (!a.difficulty) a.difficulty = base.difficulty || '중';
        if (isExamTitle(a.title) || a.importance === '상' || a.difficulty === '상') {
          a.isRepeating = a.isRepeating ?? true;
        }
      }

      if (!a.duration && a.start && a.end) {
        a.duration = hhmmToMin(a.end) - hhmmToMin(a.start);
      }
    }
  }
  return schedule;
};

// ISO 로컬 날짜/시각을 모두 허용 (예: 2025-10-31 또는 2025-10-31T14:20)  // NEW
export const parseLocalDateOrDateTime = (s) => {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, y, M, d, h, m2, s2] = m;
    return new Date(+y, +M - 1, +d, +h, +m2, +(s2 || 0), 0);
  }
  m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, y, M, d] = m;
    return new Date(+y, +M - 1, +d, 0, 0, 0, 0);
  }
  return null;
};

// ✅ 기준 시각 resolve (문자열/Date/미지정 모두 처리)  // NEW
export const resolveNow = (nowLike) => {
  if (nowLike instanceof Date) return nowLike;
  if (typeof nowLike === 'string') {
    const d = parseLocalDateOrDateTime(nowLike);
    if (d) return d;
  }
  return new Date();
};


export function dedupeActivitiesByTitleTime(dayActivities=[]) {
  const norm = (s='') => String(s).replace(/\s+/g,'').toLowerCase();
  const seen = new Set();
  const out = [];
  for (const a of (dayActivities||[])) {
    const k = `${norm(a.title||'')}:${a.start||''}-${a.end||''}:${(a.type||'')}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}


// 공통 후처리 파이프라인
export const postprocessSchedule = ({
  raw,
  existingTasksForAI,
  today,                   // backward compat
  nowLike
}) => {
  const now = resolveNow(nowLike ?? today);
  let schedule = enrichTaskMeta(Array.isArray(raw) ? raw : (raw?.schedule || []), existingTasksForAI);

  const baseDay = now.getDay() === 0 ? 7 : now.getDay();
  schedule = normalizeRelativeDays(schedule, baseDay).map(day => ({
    ...day,
    activities: (day.activities || []).map(a => {
      if ((a.type || '').toLowerCase() === 'lifestyle') {
        return { ...a, title: cleanLifestyleTitle(a.title, a.start, a.end) };
      }
      return a;
    })
  }));

  // 활동 유효성 필터 (기본 type 보강 후 검증)
  schedule = schedule.map(d => {
    const acts = (d.activities || []).map(a => {
      if (!a.type) a.type = 'task';
      return a;
    });
    return {
      ...d,
      activities: acts.filter(a => {
        const t = (a.type || 'task').toLowerCase();
        if (t === 'lifestyle') return a.start && a.end;
        return a.title && a.start && a.end;
      })
    };
  });

  return schedule;
};

// 고정 시각 태스크를 FullCalendar 이벤트로 변환
export function tasksToFixedEvents(tasks = []) {
  const safe = Array.isArray(tasks) ? tasks : [];
  const result = safe
    .filter(t => (t && (t.deadlineAtMidnight || t.deadline) && t.deadlineTime))
    .map(t => {
      const base = toLocalMidnightDate(t.deadlineAtMidnight || t.deadline);
      const [H, M] = String(t.deadlineTime).split(':').map(Number);
      const start = base ? new Date(base.getFullYear(), base.getMonth(), base.getDate(), H || 0, M || 0) : new Date();
      const dur = Math.max(30, Number(t.estimatedMinutes || 60));
      const end = new Date(start.getTime() + dur * 60000);
      
      return {
        id: `fixed_${t.id || `${start.getTime()}`}`,
        title: t.title || '(제목 없음)',
        start,
        end,
        allDay: false,
        extendedProps: {
          source: 'fixed-task',
          taskId: t.id || null,
        },
      };
    });
  
  return result;
}


