import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import firestoreService from '../services/firestoreService';
import { serverTimestamp, Timestamp } from 'firebase/firestore';
import { toLocalMidnightDate } from '../utils/dateNormalize';

/**
 * useTaskManagement Hook
 * 할 일 폼 관리 및 제출을 위한 커스텀 훅
 */
function useTaskManagement() {
  const { user } = useAuth();
  
  // 할 일 폼 상태
  const [taskForm, setTaskForm] = useState({
    title: '',
    deadline: new Date(),
    importance: '중',
    difficulty: '중',
    description: ''
  });

  /**
   * 할 일 폼 제출 핸들러
   * @param {Function} onSuccess - 성공 콜백
   * @param {Function} onScheduleRegenerate - 스케줄 재생성 콜백
   * @param {Function} onSaveComplete - 저장 완료 콜백
   */
  const handleTaskFormSubmit = async (
    onSuccess = () => {},
    onScheduleRegenerate = () => {},
    onSaveComplete = () => {}
  ) => {
    if (!user?.uid) {
      console.error('사용자가 로그인하지 않았습니다.');
      return;
    }

    // 유효성 검사
    if (!taskForm.title || taskForm.title.trim() === '') {
      console.error('할 일 제목을 입력해주세요.');
      return;
    }

    if (!taskForm.deadline) {
      console.error('마감일을 선택해주세요.');
      return;
    }

    try {
      // 할 일 데이터 준비
      const taskData = {
        title: taskForm.title,
        deadline: Timestamp.fromDate(toLocalMidnightDate(taskForm.deadline)), // 로컬 자정 고정
        importance: taskForm.importance || '중',
        difficulty: taskForm.difficulty || '중',
        description: taskForm.description || '',
        isActive: true,
        persistAsTask: true, // 사용자 입력 태스크임을 표시
        deadlineTime: '23:59',
        createdAt: serverTimestamp()
      };

      // Firestore에 저장
      await firestoreService.saveTask(user.uid, taskData);

      // 성공 콜백 호출
      await onSuccess();

      // 스케줄 재생성 콜백 호출
      await onScheduleRegenerate();

      // 저장 완료 콜백 호출
      await onSaveComplete();

      // 폼 초기화
      setTaskForm({
        title: '',
        deadline: new Date(),
        importance: '중',
        difficulty: '중',
        description: ''
      });
    } catch (error) {
      console.error('할 일 저장 실패:', error);
      throw error;
    }
  };

  return {
    taskForm,
    setTaskForm,
    handleTaskFormSubmit
  };
}

export { useTaskManagement };
export default useTaskManagement;

