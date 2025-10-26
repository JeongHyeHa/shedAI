import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import firestoreService from '../services/firestoreService';
import { convertToRelativeDay } from '../utils/dateUtils';
import { Timestamp, serverTimestamp } from 'firebase/firestore';
import { toLocalMidnightDate } from '../utils/dateNormalize';

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
  const handleTaskFormSubmit = useCallback(async (onSuccess, onScheduleRegenerate, onTaskSaved) => {
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
        deadline: Timestamp.fromDate(toLocalMidnightDate(taskForm.deadline)), // ✔ 로컬 자정 고정
        importance: taskForm.importance,
        difficulty: taskForm.difficulty,
        description: taskForm.description,
        relativeDay: relativeDay,
        estimatedMinutes: 60,
        isActive: true,                 // ✅ 기본 활성
        persistAsTask: true,            // ✅ 사용자가 직접 만든 할 일임을 표시
        createdAt: serverTimestamp()    // ✅ 정렬/쿼리용 타임스탬프
      };

      // 세션 ID는 더 이상 필요하지 않음 (클라이언트 Firestore 직접 사용)

      // 클라이언트 Firestore에 직접 저장 (일관성을 위해)
      console.log('할 일 저장 시도:', taskData);
      const taskId = await firestoreService.saveTask(user.uid, taskData);
      console.log('할 일 저장 완료, ID:', taskId);
      
      // 할 일 저장 완료 콜백 실행
      if (onTaskSaved) {
        onTaskSaved();
      }
      
      // 성공 콜백 실행
      if (onSuccess) {
        onSuccess(formattedMessage);
      }
      
      // 스케줄 재생성 콜백 실행 (Firestore는 강한 일관성)
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
