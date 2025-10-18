// 스케줄 관리 훅 ::: 스케줄을 생성하고, 로딩 프로그레스를 관리하는 기능을 담당
// AI에게 스케줄 생성 요청, AI 응답을 캘린더로 변환 
import { useState, useCallback, useEffect } from 'react';
import apiService from '../services/apiService';
import firestoreService from '../services/firestoreService';
import { convertScheduleToEvents } from '../utils/scheduleUtils';
import { useAuth } from '../contexts/AuthContext';

export const useScheduleManagement = (setAllEvents) => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);

  // 이벤트 상태만 관리 (실제 캘린더 적용은 Calendar 컴포넌트에서 처리)

  // 스케줄 생성
  const generateSchedule = useCallback(async (prompt, context, today) => {
    if (!user?.uid) throw new Error('사용자 인증이 필요합니다');
    
    try {
      setIsLoading(true);
      
      const apiResponse = await apiService.generateSchedule(
        prompt,
        context,
        user.uid
      );
      // normalize to { schedule: [...] }
      const normalized = apiResponse?.schedule ? apiResponse : { schedule: apiResponse };

      const events = convertScheduleToEvents(normalized, today).map(event => ({
        ...event,
        extendedProps: {
          ...event.extendedProps,
          isDone: false,
        }
      }));
      
      setAllEvents(events);
      
      // Firebase에 스케줄 저장
      const scheduleSessionId = await firestoreService.saveScheduleSession(user.uid, {
        scheduleData: normalized.schedule,
        hasSchedule: true,
        lifestyleContext: context.lifestylePatterns || '',
        taskContext: prompt,
        conversationContext: context.conversationContext || []
      });
      
      return {
        schedule: normalized.schedule,
        scheduleSessionId,
        events
      };
    } catch (error) {
      console.error('스케줄 생성 실패:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);

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
