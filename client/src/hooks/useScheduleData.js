import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import firestoreService from '../services/firestoreService';
import { convertScheduleToEvents } from '../utils/scheduleUtils';
import { resetToStartOfDay } from '../utils/dateUtils';
import { normalizeSchedule, hasAnyActivities } from '../utils/scheduleNormalize';

export function useScheduleData() {
  const { user } = useAuth();
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastSchedule, setLastSchedule] = useState(null);
  const today = resetToStartOfDay(new Date());

  // 사용자 데이터 로드
  const loadUserData = useCallback(async () => {
    if (!user?.uid) return;
    
    try {
      setLoading(true);
      const userData = await firestoreService.getUserDataForAI(user.uid, user);
      
      if (userData?.lastSchedule) {
        setLastSchedule(userData.lastSchedule);
        
        // 정규화된 스케줄 배열 추출
        const scheduleArr = normalizeSchedule(userData.lastSchedule);
        
        // 빈 스케줄 데이터 처리
        if (scheduleArr.length === 0) {
          setAllEvents([]);
          return;
        }

        // activities 상태 확인
        const hasActivities = hasAnyActivities(scheduleArr);
        
        if (!hasActivities) {
          setAllEvents([]);
          return;
        }

        // 정규화된 배열로 이벤트 변환
        const events = convertScheduleToEvents(scheduleArr, today).map(event => ({
          ...event,
          extendedProps: {
            ...event.extendedProps,
            isDone: false,
          }
        }));
        setAllEvents(events);
        
        // 로컬 백업 저장 (정규화된 형태로)
        try { 
          localStorage.setItem('shedAI:lastSchedule', JSON.stringify({ schedule: scheduleArr })); 
        } catch {}
      } else {
        // Firestore에 없으면 로컬 백업에서 복원
        try {
          const raw = localStorage.getItem('shedAI:lastSchedule');
          if (raw) {
            const wrapped = JSON.parse(raw);
            const scheduleArr = normalizeSchedule(wrapped);
            
            // 로컬 백업도 빈 스케줄 체크
            if (scheduleArr.length === 0) {
              console.log('[ScheduleData] 로컬 백업도 빈 스케줄 - 이벤트 없음');
              setAllEvents([]);
              return;
            }
            
            // activities 상태 확인
            const hasActivities = hasAnyActivities(scheduleArr);
            
            if (!hasActivities) {
              console.warn('[ScheduleData] 로컬 백업도 activities가 비어 있음');
              setAllEvents([]);
              return;
            }
            
            const events = convertScheduleToEvents(scheduleArr, today).map(event => ({
              ...event,
              extendedProps: {
                ...event.extendedProps,
                isDone: false,
              }
            }));
            setAllEvents(events);
          }
        } catch (error) {
          console.error('[ScheduleData] 로컬 백업 복원 실패:', error);
        }
      }
    } catch (error) {
      console.error('[ScheduleData] 사용자 데이터 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  // 스케줄 업데이트
  const updateSchedule = useCallback((newSchedule) => {
    setLastSchedule(newSchedule);
    
    // 정규화된 스케줄 배열 추출
    const scheduleArr = normalizeSchedule(newSchedule);
    
    if (scheduleArr.length === 0) {
      setAllEvents([]);
      return;
    }
    
    // activities 상태 확인
    const hasActivities = hasAnyActivities(scheduleArr);
    
    if (!hasActivities) {
      setAllEvents([]);
      return;
    }
    
    const events = convertScheduleToEvents(scheduleArr, today).map(event => ({
      ...event,
      extendedProps: {
        ...event.extendedProps,
        isDone: false,
      }
    }));
    setAllEvents(events);
  }, [today]);

  useEffect(() => {
    loadUserData();
  }, [loadUserData]);

  return {
    allEvents,
    setAllEvents,
    loading,
    lastSchedule,
    setLastSchedule,
    loadUserData,
    updateSchedule
  };
}
