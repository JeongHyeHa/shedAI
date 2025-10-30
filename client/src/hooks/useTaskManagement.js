import { useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import firestoreService from '../services/firestoreService';
import { serverTimestamp, Timestamp } from 'firebase/firestore';
import { toLocalMidnightDate, isAfterTodayLocal } from '../utils/dateNormalize';

function useTaskManagement() {
  const { user } = useAuth();
  const inflightRef = useRef(false);

  const [taskForm, setTaskForm] = useState({
    title: '',
    deadline: '',
    importance: '중',
    difficulty: '중',
    description: ''
  });

  const normalizeTitle = (s='') =>
    s.replace(/\s+/g, ' ').trim().slice(0, 120); // 길이 제한은 필요에 맞게 조정

  const isPastDate = (d) => {
    // 유지: 기존 호출부 호환용
    const dd = toLocalMidnightDate(d);
    if (!dd) return true;
    const nowMid = new Date();
    nowMid.setHours(0,0,0,0);
    return dd < nowMid;
  };

  const handleTaskFormSubmit = useCallback(
    async (onSuccess = () => {}, onScheduleRegenerate = () => {}, onSaveComplete = () => {}) => {
      if (!user?.uid) {
        console.error('사용자가 로그인하지 않았습니다.');
        return;
      }

      const title = normalizeTitle(taskForm.title || '');
      if (!title) {
        console.error('할 일 제목을 입력해주세요.');
        return;
      }
      // 오늘 이후(내일 이상)만 허용
      if (!taskForm.deadline || !isAfterTodayLocal(taskForm.deadline)) {
        console.error('마감일이 유효하지 않습니다. 오늘 이후 날짜를 선택해주세요.');
        return;
      }

      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        const taskData = {
          title,
          deadline: Timestamp.fromDate(toLocalMidnightDate(taskForm.deadline)),
          importance: taskForm.importance || '중',
          difficulty: taskForm.difficulty || '중',
          description: (taskForm.description || '').trim(),
          isActive: true,
          persistAsTask: true,
          deadlineTime: '23:59',
          createdAt: serverTimestamp()
        };

        // 저장
        const savedId = await firestoreService.saveTask(user.uid, taskData);

        // 콜백은 서로 독립적으로 보호
        try { await onSuccess(savedId); } catch (e) { console.warn('onSuccess 콜백 오류:', e); }
        try { await onScheduleRegenerate(savedId); } catch (e) { console.warn('onScheduleRegenerate 콜백 오류:', e); }
        try { await onSaveComplete(savedId); } catch (e) { console.warn('onSaveComplete 콜백 오류:', e); }

        // 폼 초기화
        setTaskForm({
          title: '',
          deadline: '',
          importance: '중',
          difficulty: '중',
          description: ''
        });

        return savedId; // 상위에서 필요하면 활용
      } catch (error) {
        console.error('할 일 저장 실패:', error);
        throw error;
      } finally {
        inflightRef.current = false;
      }
    },
    [user?.uid, taskForm]
  );

  return {
    taskForm,
    setTaskForm,
    handleTaskFormSubmit
  };
}

export { useTaskManagement };
export default useTaskManagement;
