import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import firestoreService from '../services/firestoreService';
import { convertScheduleToEvents } from '../utils/scheduleUtils';
import { resetToStartOfDay } from '../utils/dateUtils';

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
        
        const wrapped = userData.lastSchedule.scheduleData
          ? { schedule: userData.lastSchedule.scheduleData }
          : userData.lastSchedule.schedule
            ? { schedule: userData.lastSchedule.schedule }
            : Array.isArray(userData.lastSchedule)
              ? { schedule: userData.lastSchedule }
              : userData.lastSchedule;

        const events = convertScheduleToEvents(wrapped, today).map(event => ({
          ...event,
          extendedProps: {
            ...event.extendedProps,
            isDone: false,
          }
        }));
        setAllEvents(events);
        
        // 로컬 백업 저장
        try { 
          localStorage.setItem('shedAI:lastSchedule', JSON.stringify(wrapped)); 
        } catch {}
      } else {
        // Firestore에 없으면 로컬 백업에서 복원
        try {
          const raw = localStorage.getItem('shedAI:lastSchedule');
          if (raw) {
            const wrapped = JSON.parse(raw);
            const events = convertScheduleToEvents(wrapped, today).map(event => ({
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
  }, [user?.uid, today]);

  // 스케줄 업데이트
  const updateSchedule = useCallback((newSchedule) => {
    setLastSchedule(newSchedule);
    
    const events = convertScheduleToEvents(newSchedule, today).map(event => ({
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
