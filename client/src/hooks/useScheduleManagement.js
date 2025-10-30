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

    // 제목 추출: 트리거 꼬리를 제거
    const core = stripPostTags(raw).replace(SIMPLE_SCHEDULE_RE, '').trim();
    const title = (core
      .replace(/\b(오늘|내일|모레|이번주|다음주|다다음주)\b/g, '')
      .replace(/\b(오전|오후)?\s*\d{1,2}\s*시(\s*\d{1,2}\s*분)?/g, '')
      .replace(/\s*\((?:day:\d+|\d{1,2}:\d{2})\)\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim()) || '새 일정';

    // 날짜/시간 파싱(간단 규칙)
    let m = raw.match(/(\d{4})-(\d{2})-(\d{2})[^\d]{1,3}(\d{1,2})[:시](\d{1,2})/);
    let m2 = raw.match(/(\d{4})-(\d{2})-(\d{2})[^\d]{1,3}(\d{1,2})\s*시/);
    let m3 = raw.match(/(\d{1,2})월\s*(\d{1,2})일[^\d]{1,3}(\d{1,2})[:시](\d{1,2})/);
    let m4 = raw.match(/(\d{1,2})월\s*(\d{1,2})일[^\d]{1,3}(\d{1,2})\s*시/);

    let year, month, day, hour = 9, minute = 0; // 기본 09:00
    const now = baseDate instanceof Date ? baseDate : new Date();

    if (m) {
      year = +m[1]; month = +m[2]; day = +m[3]; hour = +m[4]; minute = +m[5];
    } else if (m2) {
      year = +m2[1]; month = +m2[2]; day = +m2[3]; hour = +m2[4]; minute = 0;
    } else if (m3) {
      year = now.getFullYear(); month = +m3[1]; day = +m3[2]; hour = +m3[3]; minute = +m3[4];
    } else if (m4) {
      year = now.getFullYear(); month = +m4[1]; day = +m4[2]; hour = +m4[3]; minute = 0;
    } else {
      if (/내일/.test(raw)) {
        const ap = raw.match(/오전|오후/);
        const hhMatch = raw.match(/(\d{1,2})\s*시/);
        const mmMatch = raw.match(/(\d{1,2})\s*분/);
        let H = hhMatch ? parseInt(hhMatch[1], 10) : 9;
        if (ap && ap[0] === '오전') H = H % 12;
        if (ap && ap[0] === '오후') H = (H % 12) + 12;
        const M = mmMatch ? parseInt(mmMatch[1], 10) : 0;
        const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, H, M);
        year = t.getFullYear(); month = t.getMonth() + 1; day = t.getDate(); hour = t.getHours(); minute = t.getMinutes();
      } else if (/모레/.test(raw)) {
        const ap = raw.match(/오전|오후/);
        const hhMatch = raw.match(/(\d{1,2})\s*시/);
        const mmMatch = raw.match(/(\d{1,2})\s*분/);
        let H = hhMatch ? parseInt(hhMatch[1], 10) : 9;
        if (ap && ap[0] === '오전') H = H % 12;
        if (ap && ap[0] === '오후') H = (H % 12) + 12;
        const M = mmMatch ? parseInt(mmMatch[1], 10) : 0;
        const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, H, M);
        year = t.getFullYear(); month = t.getMonth() + 1; day = t.getDate(); hour = t.getHours(); minute = t.getMinutes();
      } else {
        year = now.getFullYear(); month = now.getMonth() + 1; day = now.getDate(); hour = now.getHours(); minute = 0;
      }
    }

    const start = new Date(year, month - 1, day, hour, minute, 0, 0);
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

      const apiResponse = await apiService.generateSchedule(
        messages,
        lifestylePatterns,
        existingTasks,
        { ...opts, userId: user.uid, sessionId }
      );
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
