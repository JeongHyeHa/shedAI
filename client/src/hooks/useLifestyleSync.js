// 페이지 처음 로드 시 실행x 
import { useEffect, useCallback, useRef } from 'react';
import firestoreService from '../services/firestoreService';
import { buildShedAIPrompt, buildFeedbackPrompt } from '../utils/scheduleUtils';

export const useLifestyleSync = (
  lifestyleList,
  lastSchedule,
  today,
  userId,
  onScheduleGenerated,
  { autoGenerate = false, autoSync = true } = {}
) => {
  const isFirstMount = useRef(true);

  // Firebase 동기화 (전체 교체 저장 로직 사용)
  const syncLifestylePatterns = useCallback(async () => {
    if (!userId) return;
    
    try {
      await firestoreService.saveLifestylePatterns(userId, lifestyleList);
    } catch (error) {
      console.error("생활 패턴 저장 오류:", error);
    }
  }, [lifestyleList, userId]);

  // 스케줄 자동 생성
  const generateScheduleFromLifestyle = useCallback(async () => {
    if (lifestyleList.length === 0) return;
    
    const lifestyleText = lifestyleList.join("\n");
    const prompt = lastSchedule
      ? buildFeedbackPrompt(lifestyleText, "", lastSchedule)
      : buildShedAIPrompt(lifestyleText, "", today);
    
    try {
      onScheduleGenerated(prompt, "생활패턴이 변경되어 스케줄을 다시 생성합니다...");
    } catch (error) {
      console.error("스케줄 자동 생성 실패:", error);
    }
  }, [lifestyleList, lastSchedule, today, onScheduleGenerated]);

  // 생활패턴 변경 감지
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    
    // 서버 동기화 (옵션)
    if (autoSync) {
      syncLifestylePatterns();
    }
    
    // 스케줄 자동 생성은 옵션으로 처리
    if (autoGenerate) {
      generateScheduleFromLifestyle();
    }
  }, [lifestyleList, syncLifestylePatterns, generateScheduleFromLifestyle, autoGenerate, autoSync]);

  return {
    syncLifestylePatterns,
    generateScheduleFromLifestyle
  };
};
