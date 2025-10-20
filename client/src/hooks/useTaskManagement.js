import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiService from '../services/apiService';
import { convertToRelativeDay } from '../utils/dateUtils';

export function useTaskManagement() {
  const { user } = useAuth();
  const [taskForm, setTaskForm] = useState({
    title: "",
    deadline: "",
    importance: "",
    difficulty: "",
    description: ""
  });

  // 할 일 폼 제출
  const handleTaskFormSubmit = useCallback(async (onSuccess, onScheduleRegenerate) => {
    if (!taskForm.title || !taskForm.deadline) {
      alert('제목과 마감일은 필수 입력 항목입니다.');
      return;
    }

    const today = new Date();
    const deadlineDate = new Date(taskForm.deadline);
    const relativeDay = convertToRelativeDay(deadlineDate, today);
    
    const formattedMessage = `${taskForm.title} (${taskForm.importance}중요도, ${taskForm.difficulty}난이도, 마감일: ${taskForm.deadline} day:${relativeDay})${taskForm.description ? '\n' + taskForm.description : ''}`;
    
    // 할 일 데이터를 서버(Firestore)로 저장
    try {
      const taskData = {
        title: taskForm.title,
        deadline: taskForm.deadline,
        importance: taskForm.importance,
        difficulty: taskForm.difficulty,
        description: taskForm.description,
        relativeDay: relativeDay,
        estimatedMinutes: 60
      };

      // 세션 ID 확보: 기존 값 사용, 없으면 생성하여 localStorage에 저장
      let sessionId = localStorage.getItem('shedai_session_id');
      if (!sessionId) {
        sessionId = `sess_${Date.now()}`;
        localStorage.setItem('shedai_session_id', sessionId);
      }

      await apiService.saveTaskToDB(user.uid, sessionId, taskData);
      
      // 성공 콜백 실행
      if (onSuccess) {
        onSuccess(formattedMessage);
      }
      
      // 스케줄 재생성 콜백 실행
      if (onScheduleRegenerate) {
        onScheduleRegenerate();
      }
      
      // 폼 초기화
      setTaskForm({
        title: "",
        deadline: "",
        importance: "",
        difficulty: "",
        description: ""
      });
      
    } catch (error) {
      console.error('[Task] 할 일 저장 실패:', error);
      alert('할 일 저장에 실패했습니다: ' + error.message);
    }
  }, [taskForm, user?.uid]);

  return {
    taskForm,
    setTaskForm,
    handleTaskFormSubmit
  };
}
