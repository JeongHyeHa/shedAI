// 생활패턴 동기화 훅 ::: 생활패턴이 변경될 때 서버에 저장하고, 스케줄을 자동 생성 
// 생활패턴이 바뀌면 자동으로 서버에 저장, 생활패턴 변경 시 AI가 새로운 스케줄 생성
// 페이지 처음 로드 시 실행x 
import { useEffect, useCallback, useRef } from 'react';
import apiService from '../services/apiService';
import { buildShedAIPrompt, buildFeedbackPrompt } from '../utils/scheduleUtils';

export const useLifestyleSync = (lifestyleList, lastSchedule, today, sessionId, onScheduleGenerated) => {
  const isFirstMount = useRef(true);

  // 서버 동기화
  const syncLifestylePatterns = useCallback(async () => {
    try {
      await apiService.saveLifestylePatterns(sessionId, lifestyleList);
    } catch (error) {
      console.error("생활 패턴 저장 오류:", error);
    }
  }, [lifestyleList, sessionId]);

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
    
    // 서버 동기화
    syncLifestylePatterns();
    
    // 스케줄 자동 생성
    generateScheduleFromLifestyle();
  }, [lifestyleList, syncLifestylePatterns, generateScheduleFromLifestyle]);

  return {
    syncLifestylePatterns,
    generateScheduleFromLifestyle
  };
};
