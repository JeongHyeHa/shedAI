import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import firestoreService from '../services/firestoreService';
import apiService from '../services/apiService';

export function useFeedbackManagement() {
  const { user } = useAuth();
  const [feedbackInput, setFeedbackInput] = useState("");

  // 피드백 제출
  const handleSubmitFeedbackMessage = useCallback(async (messageText, onSuccess) => {
    const text = messageText || feedbackInput;
    if (!text.trim() || !user?.uid) return;

    try {
      const response = await apiService.submitFeedback(
        user.uid,
        null, 
        text
      );

      if (response.ok || response.success) {
        // 성공 콜백 실행
        if (onSuccess) {
          onSuccess(text, response.analysis, response.advice);
        }
        
        setFeedbackInput("");
      } else {
        throw new Error(response.message || '피드백 처리에 실패했습니다.');
      }
    } catch (error) {
      alert('피드백 제출에 실패했습니다: ' + error.message);
    }
  }, [feedbackInput, user?.uid]);

  return {
    feedbackInput,
    setFeedbackInput,
    handleSubmitFeedbackMessage
  };
}
