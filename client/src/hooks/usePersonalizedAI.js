import { useState, useCallback, useEffect } from 'react';
import apiService from '../services/apiService';
import firestoreService from '../services/firestoreService';
import { useAuth } from '../contexts/AuthContext';

// 사용자 맞춤형 AI 기능을 위한 훅
// 사용자 피드백 히스토리에서 선호도 추출하는 헬퍼 함수
const extractUserPreferencesFromHistory = (allFeedbacks) => {
  const preferences = {
    timePreferences: [],
    activityPreferences: [],
    workloadPreferences: [],
    generalFeedback: []
  };

  allFeedbacks.forEach(feedback => {
    if (feedback.type === 'conversational') {
      const userMessage = feedback.userMessage?.toLowerCase() || '';
      const aiResponse = feedback.aiResponse?.toLowerCase() || '';
      
      // 시간 관련 선호도
      if (userMessage.includes('아침') || userMessage.includes('오전')) {
        preferences.timePreferences.push({
          time: 'morning',
          preference: userMessage.includes('부지런') ? 'active' : 'relaxed',
          feedback: feedback.userMessage
        });
      }
      
      if (userMessage.includes('쉬는시간') || userMessage.includes('휴식')) {
        preferences.timePreferences.push({
          time: 'break',
          preference: userMessage.includes('길') ? 'longer' : 'shorter',
          feedback: feedback.userMessage
        });
      }
      
      // 활동 관련 선호도
      if (userMessage.includes('운동') || userMessage.includes('공부')) {
        preferences.activityPreferences.push({
          activity: userMessage.includes('운동') ? 'exercise' : 'study',
          preference: userMessage.includes('더') ? 'increase' : 'decrease',
          feedback: feedback.userMessage
        });
      }
      
      // 일반적인 피드백
      preferences.generalFeedback.push({
        message: feedback.userMessage,
        response: feedback.aiResponse,
        timestamp: feedback.createdAt
      });
    }
  });

  return preferences;
};

// 강화된 프롬프트 생성 함수
const buildEnhancedPrompt = (basePrompt, userPreferences, conversationHistory, allFeedbacks) => {
  let enhancedPrompt = basePrompt;
  
  // 사용자 선호도 추가
  if (userPreferences.timePreferences.length > 0) {
    const timePrefs = userPreferences.timePreferences.map(pref => 
      `- ${pref.time} 시간대: ${pref.preference} (피드백: "${pref.feedback}")`
    ).join('\n');
    enhancedPrompt += `\n\n사용자 시간 선호도:\n${timePrefs}`;
  }
  
  if (userPreferences.activityPreferences.length > 0) {
    const activityPrefs = userPreferences.activityPreferences.map(pref => 
      `- ${pref.activity} 활동: ${pref.preference} (피드백: "${pref.feedback}")`
    ).join('\n');
    enhancedPrompt += `\n\n사용자 활동 선호도:\n${activityPrefs}`;
  }
  
  // 최근 대화 기록 추가
  if (conversationHistory) {
    enhancedPrompt += `\n\n사용자와의 최근 대화:\n${conversationHistory}`;
  }
  
  // 전체 피드백 히스토리 요약 추가
  if (allFeedbacks.length > 0) {
    const recentFeedbacks = allFeedbacks.slice(0, 10).map(feedback => 
      `"${feedback.userMessage}" (${new Date(feedback.createdAt?.seconds * 1000).toLocaleDateString()})`
    ).join('\n');
    enhancedPrompt += `\n\n사용자 피드백 히스토리 (최근 10개):\n${recentFeedbacks}`;
  }
  
  enhancedPrompt += `\n\n위의 모든 사용자 피드백과 선호도를 종합적으로 고려하여, 사용자가 만족할 수 있는 맞춤형 스케줄을 생성해주세요.`;
  
  return enhancedPrompt;
};

export const usePersonalizedAI = () => {
  const { user } = useAuth();
  const [userInsights, setUserInsights] = useState(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [userPreferences, setUserPreferences] = useState({});

  // 사용자 인사이트 조회 (AI 기반) - 전체 피드백 히스토리 활용
  const fetchUserInsights = useCallback(async () => {
    if (!user?.uid) return;
    
    try {
      setIsLoadingInsights(true);
      
      // 사용자 데이터 수집 (Firebase) - 전체 피드백 히스토리 포함
      const userData = await firestoreService.getUserDataForAI(user.uid, user);
      
      // 전체 피드백 히스토리에서 사용자 선호도 추출
      const allFeedbacks = userData.allFeedbackHistory || [];
      const userPreferences = extractUserPreferencesFromHistory(allFeedbacks);
      
      // 대화형 피드백 분석
      const conversationalFeedbacks = userData.recentFeedbacks?.filter(
        feedback => feedback.type === 'conversational'
      ) || [];
      
      let insights;
      if (conversationalFeedbacks.length > 0) {
        // 대화형 피드백이 있으면 이를 기반으로 분석
        const analysisResult = await apiService.analyzeConversationalFeedback(conversationalFeedbacks);
        
        // 추출된 선호도와 AI 분석 결과를 결합
        insights = {
          ...analysisResult,
          extractedPreferences: userPreferences,
          totalFeedbacks: allFeedbacks.length,
          timePreferences: userPreferences.timePreferences,
          activityPreferences: userPreferences.activityPreferences
        };
        
        // AI가 추출한 선호도를 Firestore에 저장
        if (analysisResult.preferences && analysisResult.preferences.length > 0) {
          await saveExtractedPreferences(analysisResult.preferences);
        }
      } else {
        insights = {
          extractedPreferences: userPreferences,
          totalFeedbacks: allFeedbacks.length,
          timePreferences: userPreferences.timePreferences,
          activityPreferences: userPreferences.activityPreferences,
          analysis: "사용자 데이터 기본 분석을 수행했습니다.",
          recommendations: []
        };
      }
      
      setUserInsights(insights);
      return insights;
    } catch (error) {
      console.error('사용자 인사이트 조회 실패:', error);
      return null;
    } finally {
      setIsLoadingInsights(false);
    }
  }, [user?.uid]);

  // 맞춤형 스케줄 생성 (AI 기반) - 사용자 피드백 히스토리 기억
  const generatePersonalizedSchedule = useCallback(async (basePrompt, conversationContext) => {
    if (!user?.uid) throw new Error('사용자 인증이 필요합니다');
    
    try {
      // 사용자 데이터 수집 (Firebase) - 전체 피드백 히스토리 포함
      const userData = await firestoreService.getUserDataForAI(user.uid, user);
      
      // 전체 피드백 히스토리에서 사용자 선호도 추출
      const allFeedbacks = userData.allFeedbackHistory || [];
      const userPreferences = extractUserPreferencesFromHistory(allFeedbacks);
      
      // 대화형 피드백을 컨텍스트로 활용
      const conversationalFeedbacks = userData.recentFeedbacks?.filter(
        feedback => feedback.type === 'conversational'
      ) || [];
      
      // 대화 기록을 프롬프트에 포함
      const conversationHistory = conversationalFeedbacks.map(feedback => 
        `사용자: ${feedback.userMessage}\nAI: ${feedback.aiResponse}`
      ).join('\n\n');
      
      // 사용자 선호도와 대화 기록을 포함한 강화된 프롬프트
      const enhancedPrompt = buildEnhancedPrompt(
        basePrompt, 
        userPreferences, 
        conversationHistory,
        allFeedbacks
      );
      
      // AI가 사용자 데이터를 분석하여 맞춤형 프롬프트 생성
      const personalizedPrompt = await apiService.generatePersonalizedPrompt(userData, enhancedPrompt);
      
      // 맞춤형 프롬프트로 스케줄 생성
      const result = await apiService.generateSchedule(
        personalizedPrompt,
        conversationContext,
        user.uid
      );
      
      // 스케줄을 Firebase에 저장 (사용자 선호도도 함께 저장)
      await firestoreService.saveScheduleSession(user.uid, {
        scheduleData: result,
        lifestyleContext: userData.lifestylePatterns,
        taskContext: basePrompt,
        conversationHistory: conversationHistory,
        userPreferences: userPreferences
      });
      
      return result;
    } catch (error) {
      console.error('맞춤형 스케줄 생성 실패:', error);
      throw error;
    }
  }, [user?.uid]);

  // 사용자 데이터 동기화
  const syncUserData = useCallback(async () => {
    if (!user?.uid) return;
    
    try {
      const userData = await firestoreService.getUserDataForAI(user.uid, user);
      return userData;
    } catch (error) {
      console.error('사용자 데이터 동기화 실패:', error);
      return null;
    }
  }, [user?.uid]);

  // AI 기반 사용자 조언 생성
  const generatePersonalizedAdvice = useCallback(async () => {
    if (!user?.uid) return null;
    
    try {
      // 사용자 데이터 수집 (Firebase)
      const userData = await firestoreService.getUserDataForAI(user.uid, user);
      
      // AI가 맞춤형 조언 생성
      const advice = await apiService.generatePersonalizedAdvice(userData);
      
      // 조언을 Firebase에 저장
      if (advice) {
        await firestoreService.saveAIAdvice(user.uid, advice);
      }
      
      return advice;
    } catch (error) {
      console.error('AI 조언 생성 실패:', error);
      return null;
    }
  }, [user?.uid]);

  // 사용자 선호도 업데이트
  const updateUserPreferences = useCallback(async (preferenceType, preferenceData) => {
    if (!user?.uid) return;
    
    try {
      // Firebase에 선호도 저장
      await firestoreService.saveUserPreference(user.uid, {
        preferenceType,
        preferenceKey: preferenceData.key,
        preferenceValue: preferenceData.value,
        confidenceScore: preferenceData.confidence || 1.0
      });
      
      setUserPreferences(prev => ({
        ...prev,
        [preferenceType]: preferenceData
      }));
    } catch (error) {
      console.error('사용자 선호도 업데이트 실패:', error);
    }
  }, [user?.uid]);

  // AI가 추출한 사용자 선호도를 Firestore에 저장
  const saveExtractedPreferences = useCallback(async (preferences) => {
    if (!user?.uid) return;
    
    try {
      // 추출된 선호도를 Firestore에 저장
      await firestoreService.saveUserPreference(user.uid, {
        extractedPreferences: preferences,
        lastUpdated: new Date()
      });
      
      // 로컬 상태도 업데이트
      setUserPreferences(prev => ({ 
        ...prev, 
        extractedPreferences: preferences,
        lastUpdated: new Date()
      }));
    } catch (error) {
      console.error('추출된 선호도 저장 실패:', error);
    }
  }, [user?.uid]);

  // 컴포넌트 마운트 시 사용자 인사이트 조회
  useEffect(() => {
    if (user?.uid) {
      fetchUserInsights();
    }
  }, [user?.uid, fetchUserInsights]);

  return {
    userInsights,
    isLoadingInsights,
    userPreferences,
    fetchUserInsights,
    generatePersonalizedSchedule,
    generatePersonalizedAdvice,
    syncUserData,
    updateUserPreferences,
    saveExtractedPreferences
  };
};
