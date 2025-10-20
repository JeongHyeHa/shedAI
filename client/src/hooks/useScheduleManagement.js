// useScheduleManagement.js
// 스케줄 관리 훅 ::: 스케줄을 생성하고, 로딩 프로그레스를 관리하는 기능을 담당
// AI에게 스케줄 생성 요청, AI 응답을 캘린더로 변환 
import { useState, useCallback, useEffect } from 'react';
import apiService from '../services/apiService';
// firestoreService는 이 훅에서 사용하지 않음
import { convertScheduleToEvents } from '../utils/scheduleUtils';
import { useAuth } from '../contexts/AuthContext';

export const useScheduleManagement = (setAllEvents) => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);

  // 이벤트 상태만 관리 (실제 캘린더 적용은 Calendar 컴포넌트에서 처리)

  // 스케줄 생성 - 서버 시그니처와 일치하도록 수정
  const generateSchedule = useCallback(async (messages, lifestylePatterns = [], existingTasks = [], opts = {}) => {
    if (!user?.uid) throw new Error('사용자 인증이 필요합니다');
    if (isLoading) return; // 중복 호출 방지
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('messages가 비어 있습니다');
    }
    
    try {
      setIsLoading(true);
      
      // 마지막 프롬프트 유효성 로깅(디버깅 용)
      const lastContent = messages[messages.length - 1]?.content;
      if (!lastContent || typeof lastContent !== 'string' || lastContent.trim() === '') {
        console.warn('[useScheduleManagement] 마지막 프롬프트가 비어 있습니다.');
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
      // normalize to { schedule: [...] }
      const normalized = apiResponse?.schedule ? apiResponse : { schedule: apiResponse };

      // 📌 서버 계산 기준과 동일한 anchor 날짜를 사용
      // 우선순위: opts.baseDate(직접 Date) > opts.nowOverride(ISO 문자열) > 현재시각
      const baseDate =
        opts.baseDate instanceof Date
          ? opts.baseDate
          : (typeof opts.nowOverride === 'string' ? new Date(opts.nowOverride) : new Date());

      const events = convertScheduleToEvents(normalized.schedule, baseDate).map(event => ({
        ...event,
        extendedProps: {
          ...event.extendedProps,
          isDone: false,
        }
      }));
      
      setAllEvents(events);
      
      // 훅에서는 저장하지 않고 스케줄만 리턴 (관심사 분리)
      return {
        schedule: normalized.schedule,
        events
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
