import { useState, useCallback, useEffect } from 'react';
import apiService from '../services/apiService';

// 사용자 맞춤형 AI 기능을 위한 훅
export const usePersonalizedAI = (sessionId) => {
  const [userInsights, setUserInsights] = useState(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [userPreferences, setUserPreferences] = useState({});

  // 사용자 인사이트 조회 (AI 기반)
  const fetchUserInsights = useCallback(async () => {
    if (!sessionId) return;
    
    try {
      setIsLoadingInsights(true);
      
      // 사용자 데이터 수집
      const userData = await apiService.getUserData(sessionId);
      
      // AI가 패턴 분석 및 조언 생성
      const insights = await apiService.analyzeUserPatterns(userData);
      
      setUserInsights(insights);
      return insights;
    } catch (error) {
      console.error('사용자 인사이트 조회 실패:', error);
      return null;
    } finally {
      setIsLoadingInsights(false);
    }
  }, [sessionId]);

  // 맞춤형 스케줄 생성 (AI 기반)
  const generatePersonalizedSchedule = useCallback(async (basePrompt, conversationContext) => {
    if (!sessionId) throw new Error('세션 ID가 필요합니다');
    
    try {
      // 사용자 데이터 수집
      const userData = await apiService.getUserData(sessionId);
      
      // AI가 사용자 데이터를 분석하여 맞춤형 프롬프트 생성
      const personalizedPrompt = await apiService.generatePersonalizedPrompt(userData, basePrompt);
      
      // 맞춤형 프롬프트로 스케줄 생성
      const result = await apiService.generateSchedule(
        personalizedPrompt,
        conversationContext,
        sessionId
      );
      
      return result;
    } catch (error) {
      console.error('맞춤형 스케줄 생성 실패:', error);
      throw error;
    }
  }, [sessionId]);

  // 사용자 데이터 동기화
  const syncUserData = useCallback(async () => {
    if (!sessionId) return;
    
    try {
      const userData = await apiService.syncUserData(sessionId);
      return userData;
    } catch (error) {
      console.error('사용자 데이터 동기화 실패:', error);
      return null;
    }
  }, [sessionId]);

  // AI 기반 사용자 조언 생성
  const generatePersonalizedAdvice = useCallback(async () => {
    if (!sessionId) return null;
    
    try {
      // 사용자 데이터 수집
      const userData = await apiService.getUserData(sessionId);
      
      // AI가 맞춤형 조언 생성
      const advice = await apiService.generatePersonalizedAdvice(userData);
      
      return advice;
    } catch (error) {
      console.error('AI 조언 생성 실패:', error);
      return null;
    }
  }, [sessionId]);

  // 사용자 선호도 업데이트
  const updateUserPreferences = useCallback(async (preferenceType, preferenceData) => {
    if (!sessionId) return;
    
    try {
      // TODO: API 호출로 선호도 업데이트
      setUserPreferences(prev => ({
        ...prev,
        [preferenceType]: preferenceData
      }));
    } catch (error) {
      console.error('사용자 선호도 업데이트 실패:', error);
    }
  }, [sessionId]);

  // 컴포넌트 마운트 시 사용자 인사이트 조회
  useEffect(() => {
    if (sessionId) {
      fetchUserInsights();
    }
  }, [sessionId, fetchUserInsights]);

  return {
    userInsights,
    isLoadingInsights,
    userPreferences,
    fetchUserInsights,
    generatePersonalizedSchedule,
    generatePersonalizedAdvice,
    syncUserData,
    updateUserPreferences
  };
};
