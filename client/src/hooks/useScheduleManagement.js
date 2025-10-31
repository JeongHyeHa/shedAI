// useScheduleManagement.js
// 스케줄 관리 훅 ::: 스케줄을 생성하고, 로딩 프로그레스를 관리하는 기능을 담당
// AI에게 스케줄 생성 요청, AI 응답을 캘린더로 변환 
import { useState, useCallback, useEffect } from 'react';
import apiService from '../services/apiService';
import firestoreService from '../services/firestoreService'; 
import { convertScheduleToEvents, tasksToFixedEvents } from '../utils/scheduleUtils';
import { useAuth } from '../contexts/AuthContext';
import { toISODateLocal, toLocalMidnightDate } from '../utils/dateNormalize';
import { serverTimestamp } from 'firebase/firestore';
import { looksLikeSystemPrompt } from '../utils/promptGuards';

export const useScheduleManagement = (setAllEvents) => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);

  // 이벤트 상태만 관리 (실제 캘린더 적용은 Calendar 컴포넌트에서 처리)

  // -----------------------------
  // 1) "단순 일정" 트리거 감지 (문장부호/띄어쓰기 허용)
  // -----------------------------
  const normalizeText = (s = '') => s
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // “일정/스케줄 추가/등록/넣어/만들/잡아 줘(요)” 등 폭넓게 허용, 문장 끝 강제 제거
  const SIMPLE_SCHEDULE_RE = /(일정|스케줄)\s*(추가|등록|넣어|만들|잡아)\s*줘(?:요)?/u;
  // 전처리 꼬리 태그 제거: (day:x), (HH:MM)
  const stripPostTags = (s = '') => s.replace(/\s*(\((?:day:\d+|\d{1,2}:\d{2})\)\s*)+$/g, '').trim();

  // ===== Helpers for natural language date/time parsing (inside hook) =====
  // 요일 매핑 (월=1 ... 일=7 규칙 가정)
  const WEEKDAY_MAP = { '월':1,'화':2,'수':3,'목':4,'금':5,'토':6,'일':7 };

  // baseDate(로컬) 기준 "이번주/다음주/다다음주 + 요일" -> 실제 날짜 계산
  function resolveWeekday(baseDate, weekWord, korDow) {
    const wantDow = WEEKDAY_MAP[korDow]; // 1~7
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    // 현재 주의 월요일(= day:1)을 구함 (일요일=0, 월요일=1 ...)
    const jsDow = d.getDay(); // 0(일)~6(토)
    const currentWeekMonday = new Date(d);
    // 월요일로 이동
    const offsetToMonday = (jsDow === 0 ? -6 : 1 - jsDow);
    currentWeekMonday.setDate(d.getDate() + offsetToMonday);

    let weekOffset = 0;
    if (weekWord === '다음주') weekOffset = 1;
    if (weekWord === '다다음주') weekOffset = 2;
    const targetWeekMonday = new Date(currentWeekMonday);
    targetWeekMonday.setDate(currentWeekMonday.getDate() + weekOffset * 7);

    const target = new Date(targetWeekMonday);
    // 월요일(=1) 기준 wantDow까지 이동
    target.setDate(targetWeekMonday.getDate() + (wantDow - 1));

    // "이번주"인데 그 요일이 이미 지났으면: 오늘 이후로 가장 가까운 해당 요일(= 다음주 같은 요일)
    if (weekWord === '이번주') {
      if (target < d) target.setDate(target.getDate() + 7);
    }
    return target;
  }

  // "오전/오후 H시 m분" → 시/분 계산
  function parseKoreanTime(text) {
    // HH:mm 혹은 HH시 mm분 / HH시
    let ap = null; // 오전/오후
    const apMatch = text.match(/(오전|오후)/);
    if (apMatch) ap = apMatch[1];

    let H = null, M = 0;
    const hhmm = text.match(/(\d{1,2})\s*[:시]\s*(\d{1,2})/);
    const hhOnly = text.match(/(\d{1,2})\s*시/);

    if (hhmm) { H = parseInt(hhmm[1],10); M = parseInt(hhmm[2],10); }
    else if (hhOnly) { H = parseInt(hhOnly[1],10); }

    if (H != null) {
      if (ap === '오전') { H = H % 12; }
      if (ap === '오후') { H = (H % 12) + 12; }
      return { hour: H, minute: M };
    }
    return null;
  }

  // 분을 10분 단위로 올림
  function ceilTo10Min(date) {
    const d = new Date(date);
    const m = d.getMinutes();
    const add = (10 - (m % 10)) % 10;
    if (add) d.setMinutes(m + add, 0, 0);
    else d.setSeconds(0,0);
    return d;
  }

  // 마지막 사용자 메시지 텍스트 추출
  const getLastUserText = (messages = []) => {
    if (!Array.isArray(messages)) return '';
    const lastUser = [...messages].reverse().find(m => m?.role === 'user');
    return normalizeText(lastUser?.content || '');
  };

  const isSimpleScheduleTrigger = (messages) => {
    const last = stripPostTags(getLastUserText(messages));
    return SIMPLE_SCHEDULE_RE.test(last);
  };

  // -----------------------------
  // 2) 메시지에서 이벤트 추출 (최소 파서)
  // -----------------------------
  const extractEventFromMessage = (messages, baseDate = new Date()) => {
    const raw = getLastUserText(messages);
    const now = (baseDate instanceof Date && !isNaN(baseDate)) ? new Date(baseDate) : new Date();

    // 1) 제목 추출(트리거 꼬리/날짜·시간 토큰 제거)
    const core = stripPostTags(raw).replace(SIMPLE_SCHEDULE_RE, '').trim();
    const title = (core
      .replace(/\b(오늘|내일|모레|이번주|다음주|다다음주)\b/g, '')
      .replace(/\b(월|화|수|목|금|토|일)요일\b/g, '')
      .replace(/\b(오전|오후)\b/g, '')
      .replace(/\d{4}-\d{2}-\d{2}/g, '')
      .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, '')
      .replace(/\d{1,2}\s*:\s*\d{2}/g, '')
      .replace(/\d{1,2}\s*시(\s*\d{1,2}\s*분)?/g, '')
      .replace(/\s+/g, ' ')
      .trim()) || '새 일정';

    // 2) 날짜/시간 파싱 우선순위
    // A) yyyy-MM-dd [HH:mm|HH시 mm분|HH시]
    let dtYmd = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
    // B) (이번주|다음주|다다음주) (월|화|수|목|금|토|일)요일
    let dtW = raw.match(/(이번주|다음주|다다음주)\s*([월화수목금토일])요일/);
    // C) M월 D일
    let dtMD = raw.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    // D) 오늘/내일/모레
    let rel = null;
    if (/오늘/.test(raw)) rel = 0;
    else if (/내일/.test(raw)) rel = 1;
    else if (/모레/.test(raw)) rel = 2;

    // 시간(선택)
    const tParsed = parseKoreanTime(raw);
    const hhmm = raw.match(/(\d{1,2}):(\d{2})/);
    const hhOnly = raw.match(/(\d{1,2})\s*시/);

    let Y, M, D, H, Min;

    if (dtYmd) {
      Y = +dtYmd[1]; M = +dtYmd[2]; D = +dtYmd[3];
    } else if (dtW) {
      const anchor = resolveWeekday(now, dtW[1], dtW[2]);
      Y = anchor.getFullYear(); M = anchor.getMonth() + 1; D = anchor.getDate();
    } else if (dtMD) {
      Y = now.getFullYear(); M = +dtMD[1]; D = +dtMD[2];
    } else if (rel != null) {
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + rel);
      Y = t.getFullYear(); M = t.getMonth() + 1; D = t.getDate();
    } else {
      // 날짜 미지정 → 오늘
      Y = now.getFullYear(); M = now.getMonth() + 1; D = now.getDate();
    }

    // 시간 설정 규칙
    if (tParsed) {
      H = tParsed.hour; Min = tParsed.minute;
    } else if (hhmm) {
      H = parseInt(hhmm[1],10); Min = parseInt(hhmm[2],10);
    } else if (hhOnly) {
      H = parseInt(hhOnly[1],10); Min = 0;
    } else {
      // ⬅️ 시간 미지정: "지금 시각을 10분 올림"으로 시작
      const rounded = ceilTo10Min(now);
      H = rounded.getHours();
      Min = rounded.getMinutes();
    }

    const start = new Date(Y, M - 1, D, H, Min, 0, 0);
    // 과거 시각 방지: ‘오늘’인데 이미 지났다면 10분 올림된 now로
    if (start < now && (Y===now.getFullYear() && M===now.getMonth()+1 && D===now.getDate())) {
      const r = ceilTo10Min(now);
      start.setHours(r.getHours(), r.getMinutes(), 0, 0);
    }

    // 기본 지속시간: 60분
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    return { title, start, end };
  };

  // 스케줄 생성 - 서버 시그니처와 일치하도록 수정
  const generateSchedule = useCallback(async (messages, lifestylePatterns = [], existingTasks = [], opts = {}) => {
    if (!user?.uid) throw new Error('사용자 인증이 필요합니다');
    if (isLoading) {
      throw new Error('REQUEST_IN_PROGRESS');
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('messages가 비어 있습니다');
    }
    
    // 📌 서버와 동일 anchor: opts.baseDate > opts.nowOverride > now
    const baseDate =
      opts.baseDate instanceof Date
        ? opts.baseDate
        : (typeof opts.nowOverride === 'string' ? new Date(opts.nowOverride) : new Date());
    
    try {
      setIsLoading(true);
      
      // A) 고정 시각 태스크 먼저 캘린더에 반영
      const fixedEvents = tasksToFixedEvents(existingTasks);
      if (fixedEvents.length) {
        setAllEvents(prev => (Array.isArray(prev) ? [...prev, ...fixedEvents] : fixedEvents));
      }

      // (A) 단순 일정 트리거면: AI 호출 없이 바로 처리
      let quickAddedEvent = null;
      if (isSimpleScheduleTrigger(messages)) {
        const ev = extractEventFromMessage(messages, baseDate);

        // 1) 캘린더 이벤트 추가
        setAllEvents((prev) => (Array.isArray(prev) ? [...prev, {
          id: `evt_${Date.now()}`,
          title: ev.title,
          start: ev.start,
          end: ev.end,
          allDay: false,
          extendedProps: { isDone: false, source: 'quick-add' },
        }] : [{
          id: `evt_${Date.now()}`,
          title: ev.title,
          start: ev.start,
          end: ev.end,
          allDay: false,
          extendedProps: { isDone: false, source: 'quick-add' },
        }]));

        // 2) Task DB에도 기록 (deadline=이벤트 날짜 자정, deadlineTime=시작 HH:mm)
        const ymd = toISODateLocal(ev.start);
        const hh = String(ev.start.getHours()).padStart(2, '0');
        const mm = String(ev.start.getMinutes()).padStart(2, '0');

        try {
          await firestoreService.saveTask(user.uid, {
            title: ev.title,
            deadline: toLocalMidnightDate(ymd),
            deadlineTime: `${hh}:${mm}`,
            importance: '중',
            difficulty: '중',
            description: '[자동] 단순 일정 추가',
            isActive: true,
            persistAsTask: true,
            createdAt: serverTimestamp(),
          });
        } catch (e) {
          console.warn('Quick-add task 저장 실패:', e);
        }

        // 즉시 반환하지 않고 AI 생성도 계속 진행
        quickAddedEvent = ev;
      }

      // (A-2) 암시적 퀵애드: 마지막 사용자 문장에 시간/날짜가 보이면 로컬로 바로 추가
      {
        const lastUser = getLastUserText(messages);
        const looksTimed = /(오늘|내일|모레|\d{4}-\d{2}-\d{2}|[0-9]{1,2}\s*월\s*[0-9]{1,2}\s*일)/.test(lastUser)
                         || /(오전|오후|[0-9]{1,2}\s*시)/.test(lastUser);
        const isPromptLike = looksLikeSystemPrompt(lastUser);
        if (!quickAddedEvent && !isSimpleScheduleTrigger(messages) && looksTimed && !isPromptLike) {
          const ev = extractEventFromMessage([{ role: 'user', content: lastUser }], baseDate);

          setAllEvents(prev => (Array.isArray(prev) ? [...prev, {
            id: `evt_${Date.now()}`,
            title: ev.title,
            start: ev.start,
            end: ev.end,
            allDay: false,
            extendedProps: { isDone: false, source: 'quick-add-implicit' },
          }] : [{
            id: `evt_${Date.now()}`,
            title: ev.title,
            start: ev.start,
            end: ev.end,
            allDay: false,
            extendedProps: { isDone: false, source: 'quick-add-implicit' },
          }]));

          const ymd = toISODateLocal(ev.start);
          const hh = String(ev.start.getHours()).padStart(2, '0');
          const mm = String(ev.start.getMinutes()).padStart(2, '0');
          try {
            await firestoreService.saveTask(user.uid, {
              title: ev.title,
              deadline: toLocalMidnightDate(ymd),
              deadlineTime: `${hh}:${mm}`,
              importance: '중',
              difficulty: '중',
              description: '[자동] 암시적 단순 일정 추가',
              isActive: true,
              persistAsTask: true,
              createdAt: serverTimestamp(),
            });
          } catch (e) {
            console.warn('Implicit quick-add task 저장 실패:', e);
          }

          // 즉시 반환하지 않고 AI 생성도 계속 진행
          quickAddedEvent = ev;
        }
      }
      
      // 세션 ID 확보: 로컬 유지
      let sessionId = localStorage.getItem('shedai_session_id');
      if (!sessionId) {
        sessionId = `sess_${Date.now()}`;
        localStorage.setItem('shedai_session_id', sessionId);
      }

      // 타이밍 로그 시작
      const T0 = Date.now();
      
      const apiResponse = await apiService.generateSchedule(
        messages,
        lifestylePatterns,
        existingTasks,
        { ...opts, userId: user.uid, sessionId }
      );
      
      const T1 = Date.now();
      const apiResponseTime = T1 - T0;
      
      // 로컬 폴백 감지
      const isFallback = 
        apiResponse?.__fallback === true ||
        apiResponse?.__debug?.mode === 'dummy' ||
        apiResponse?.__debug?.isFallback === true ||
        apiResponse?.explanation?.includes('더미 스케줄') ||
        apiResponse?.explanation?.includes('개발 모드');
      
      if (isFallback) {
        console.warn('[⚠️ 폴백 감지] 로컬 더미 스케줄이 생성되었습니다. AI 호출이 실패했을 가능성이 높습니다.');
        console.warn('[⚠️ 폴백 감지] 응답 시간:', apiResponseTime, 'ms');
        console.warn('[⚠️ 폴백 감지] __debug:', apiResponse?.__debug);
        console.warn('[⚠️ 폴백 감지] __fallback:', apiResponse?.__fallback);
        console.warn('[⚠️ 폴백 감지] 이유:', apiResponse?.__debug?.reason || apiResponse?.message || '알 수 없음');
      } else {
        console.log('[✅ AI 스케줄] 정상 응답 수신');
        console.log('[✅ AI 스케줄] 응답 시간:', apiResponseTime, 'ms');
      }
      
      // 응답 스키마 방어적으로 정규화
      let scheduleArr = [];
      if (Array.isArray(apiResponse)) {
        scheduleArr = apiResponse;
      } else if (Array.isArray(apiResponse?.schedule)) {
        scheduleArr = apiResponse.schedule;
      } else if (Array.isArray(apiResponse?.data?.schedule)) {
        scheduleArr = apiResponse.data.schedule;
      } else if (Array.isArray(apiResponse?.result?.schedule)) {
        scheduleArr = apiResponse.result.schedule;
      } else if (Array.isArray(apiResponse?.events)) {
        scheduleArr = apiResponse.events;
      } else {
        console.warn('Unknown schedule payload shape:', apiResponse);
        scheduleArr = [];
      }

      try { console.debug('[AI raw schedule]', JSON.stringify(scheduleArr, null, 2)); } catch {}

      if (!scheduleArr.length) {
        throw new Error('EMPTY_SCHEDULE_FROM_SERVER');
      }

      const events = convertScheduleToEvents(scheduleArr, baseDate).map(event => ({
        ...event,
        extendedProps: {
          ...event.extendedProps,
          isDone: false,
        }
      }));
      
      // B) AI 결과 병합 (고정 이벤트 유지)
      // 퀵애드가 있었다면 결과에 고정 이벤트로 병합해 최종 반영
      if (quickAddedEvent) {
        setAllEvents(prev => (Array.isArray(prev) ? [...prev, {
          id: `evt_${Date.now()}_fixed` ,
          title: quickAddedEvent.title,
          start: quickAddedEvent.start,
          end: quickAddedEvent.end,
          allDay: false,
          extendedProps: { isDone: false, source: 'quick-add-fixed' }
        }, ...events] : [{
          id: `evt_${Date.now()}_fixed` ,
          title: quickAddedEvent.title,
          start: quickAddedEvent.start,
          end: quickAddedEvent.end,
          allDay: false,
          extendedProps: { isDone: false, source: 'quick-add-fixed' }
        }, ...events]));
      } else {
        setAllEvents(prev => (Array.isArray(prev) ? [...prev, ...events] : events));
      }
      
      // 훅에서는 저장하지 않고 스케줄만 리턴 (관심사 분리)
      return {
        schedule: scheduleArr,
        events: quickAddedEvent
          ? [...fixedEvents, {
              title: quickAddedEvent.title,
              start: quickAddedEvent.start,
              end: quickAddedEvent.end,
              allDay: false,
              extendedProps: { isDone: false, source: 'quick-add-fixed' }
            }, ...events]
          : [...fixedEvents, ...events]
      };
    } catch (error) {
      console.error('스케줄 생성 실패:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid, setAllEvents, isLoading]);

  // 로딩 프로그레스 관리
  const updateLoadingProgress = useCallback((progress) => {
    setLoadingProgress(progress);
  }, []);

  // 로딩 프로그레스 자동 관리 (보다 안정적인 증가)
  useEffect(() => {
    let timer;
    if (isLoading) {
      // 시작 즉시 5%로 표시하여 숫자가 보이게 함
      setLoadingProgress((prev) => (prev <= 0 ? 5 : prev));
      timer = setInterval(() => {
        setLoadingProgress((prev) => {
          if (prev < 90) return prev + 2; // 조금 더 빠르게 증가
          return prev;
        });
      }, 200);
    } else {
      // 로딩이 끝나면 100%로 채우고 이후 자연스럽게 초기화는 외부에서
      setLoadingProgress((prev) => (prev > 0 && prev < 100 ? 100 : prev));
    }
    return () => timer && clearInterval(timer);
  }, [isLoading]);

  return {
    isLoading,
    setIsLoading,
    loadingProgress,
    updateLoadingProgress,
    generateSchedule
  };
};
