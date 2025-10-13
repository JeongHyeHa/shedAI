// 스케줄 관리 훅 ::: 스케줄을 생성하고, 로딩 프로그레스를 관리하는 기능을 담당
// AI에게 스케줄 생성 요청, AI 응답을 캘린더로 변환 
import { useState, useCallback, useEffect } from 'react';
import apiService from '../services/apiService';
import firestoreService from '../services/firestoreService';
import { convertScheduleToEvents } from '../utils/scheduleUtils';
import { useAuth } from '../contexts/AuthContext';

export const useScheduleManagement = () => {
  const { user } = useAuth();
  const [allEvents, setAllEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);

  // 이벤트 상태만 관리 (실제 캘린더 적용은 Calendar 컴포넌트에서 처리)

  // 스케줄 생성
  const generateSchedule = useCallback(async (prompt, context, today) => {
    if (!user?.uid) throw new Error('사용자 인증이 필요합니다');
    
    try {
      setIsLoading(true);
      
      const newSchedule = await apiService.generateSchedule(
        prompt,
        context,
        user.uid
      );
      
      const events = convertScheduleToEvents(newSchedule.schedule, today).map(event => ({
        ...event,
        extendedProps: {
          ...event.extendedProps,
          isDone: false,
        }
      }));
      
      setAllEvents(events);
      
      // Firebase에 스케줄 저장
      const scheduleSessionId = await firestoreService.saveScheduleSession(user.uid, {
        scheduleData: newSchedule.schedule,
        lifestyleContext: context.lifestylePatterns || '',
        taskContext: prompt,
        conversationContext: context.conversationContext || []
      });
      
      return {
        schedule: newSchedule.schedule,
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

  // 로딩 프로그레스 자동 관리
  useEffect(() => {
    let timer;
    if (isLoading) {
      setLoadingProgress(0);
      setTimeout(() => setLoadingProgress(1), 50);
      timer = setInterval(() => {
        setLoadingProgress((prev) => (prev < 90 ? prev + 1 : prev));
      }, 300);
    } else if (loadingProgress > 0 && loadingProgress < 100) {
      setLoadingProgress(100);
    }
    return () => timer && clearInterval(timer);
  }, [isLoading, loadingProgress]);

  return {
    allEvents,
    setAllEvents,
    isLoading,
    setIsLoading,
    loadingProgress,
    updateLoadingProgress,
    generateSchedule
  };
};
