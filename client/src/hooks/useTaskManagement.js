import { useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import firestoreService from '../services/firestoreService';
import { serverTimestamp, Timestamp } from 'firebase/firestore';
import { toLocalMidnightDate } from '../utils/dateNormalize';

function useTaskManagement() {
  const { user } = useAuth();
  const inflightRef = useRef(false);

  const [taskForm, setTaskForm] = useState({
    title: '',
    deadline: '',       // 'YYYY-MM-DD'
    deadlineTime: '18:00', // NEW: 'HH:mm'
    importance: '중',
    difficulty: '중',
    description: ''
  });

  const normalizeTitle = (s='') =>
    s.replace(/\s+/g, ' ').trim().slice(0, 120);

  // 'HH:mm' -> {h,m} 파서 (안전)
  const parseHHmm = (hhmm = '') => {
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { h: 18, m: 0 }; // fallback
    let h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    let mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    return { h, m: mi };
  };

  // 오늘도 허용: "지금 + 5분" 이후만 OK
  const isFutureOrTodayWithTime = (dateStr, timeStr) => {
    if (!dateStr) return false;
    const { h, m } = parseHHmm(timeStr);
    const candidate = new Date();
    const [y, mo, d] = dateStr.split('-').map(n => parseInt(n, 10));
    candidate.setFullYear(y);
    candidate.setMonth((mo || 1) - 1);
    candidate.setDate(d || 1);
    candidate.setHours(h, m, 0, 0);

    const now = new Date();
    const nowPlus = new Date(now.getTime() + 5 * 60 * 1000); // 5분 버퍼
    return candidate.getTime() >= nowPlus.getTime();
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

      // ✅ 오늘도 허용(시간 기반 검증)
      if (!taskForm.deadline || !isFutureOrTodayWithTime(taskForm.deadline, taskForm.deadlineTime)) {
        console.error('마감일/시간이 유효하지 않습니다. 현재 시각 이후로 선택해주세요.');
        return;
      }

      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        // 자정 Timestamp (정렬/쿼리용), 문자열 ISO(업서트 키용)
        const deadlineMidnight = toLocalMidnightDate(taskForm.deadline);
        const deadlineISO = taskForm.deadline; // 'YYYY-MM-DD'
        const { h, m } = parseHHmm(taskForm.deadlineTime);

        const taskData = {
          title,
          // Firestore Timestamp(자정), 문자열 ISO, HH:mm 모두 보관
          deadline: Timestamp.fromDate(deadlineMidnight),
          deadlineISO,                 // NEW: 업서트/검색용
          deadlineTime: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
          importance: taskForm.importance || '중',
          difficulty: taskForm.difficulty || '중',
          description: (taskForm.description || '').trim(),
          isActive: true,
          persistAsTask: true,
          createdAt: serverTimestamp()
        };

        // ✅ 중복 방지 업서트(선행 패치 적용 기준)
        const savedId = await firestoreService.saveTask(user.uid, taskData);

        // 콜백 보호 실행
        try { await onSuccess(savedId); } catch (e) { console.warn('onSuccess 콜백 오류:', e); }
        try { await onScheduleRegenerate(savedId); } catch (e) { console.warn('onScheduleRegenerate 콜백 오류:', e); }
        try { await onSaveComplete(savedId); } catch (e) { console.warn('onSaveComplete 콜백 오류:', e); }

        // 폼 초기화
        setTaskForm({
          title: '',
          deadline: '',
          deadlineTime: '18:00',
          importance: '중',
          difficulty: '중',
          description: ''
        });

        return savedId;
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
