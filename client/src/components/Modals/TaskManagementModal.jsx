import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import firestoreService from '../../services/firestoreService';
// import { apiService } from '../../services/apiService'; // ❌ 미사용 제거
import './TaskManagementModal.css';

const IMP_ORDER = { '상': 0, '중': 1, '하': 2 };

const TaskManagementModal = ({ isOpen, onClose, onEditTask, onSaveAndRegenerate }) => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);

  // 날짜 유틸
  const toDate = (v) => (v?.toDate ? v.toDate() : (typeof v === 'string' ? new Date(v) : new Date(v || Date.now())));
  const fmtDate = (d) => (d ? d.toLocaleDateString('ko-KR') : '날짜 없음');

  // ✅ 태스크 로더 (정규화 + 정렬 + isActive 필터)
  const loadTasks = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    try {
      let fsTasks = [];
      try {
        fsTasks = await firestoreService.getAllTasks(user.uid);
        // console.log('[TaskManagementModal] Firestore 할 일:', fsTasks.length, '개');
      } catch (e) {
        console.warn('[TaskManagementModal] Firestore 할 일 조회 실패:', e?.message || e);
        fsTasks = [];
      }

      let localTasks = [];
      try {
        const raw = localStorage.getItem('shedAI:tempTasks');
        if (raw) localTasks = JSON.parse(raw);
        // console.log('[TaskManagementModal] 로컬 스토리지 할 일:', localTasks.length, '개');
      } catch (e) {
        console.warn('[TaskManagementModal] 로컬 스토리지 할 일 조회 실패:', e?.message || e);
        localTasks = [];
      }

      // ✅ 스키마 정규화
      const norm = (t, isLocal = false) => {
        const id = t.id || (isLocal ? `temp_${t.createdAt || Date.now()}` : undefined);
        const deadline = t.deadline?.toDate ? t.deadline : (t.deadline ? { toDate: () => new Date(t.deadline) } : null);
        const importance = t.importance || '중';
        const difficulty = t.difficulty || '중';
        const description = t.description || '';
        const isActive = t.isActive !== false; // undefined는 true 취급
        return {
          ...t,
          id,
          isLocal: isLocal || t.isLocal === true,
          importance,
          difficulty,
          description,
          isActive,
          __deadlineDate: t.deadline?.toDate ? t.deadline.toDate() : (t.deadline ? new Date(t.deadline) : null),
        };
      };

      const combined = [
        ...fsTasks.map(t => norm(t, false)),
        ...localTasks.map(t => norm(t, true)),
      ]
        .filter(t => t.isActive) // ✅ 비활성 제외
        .sort((a, b) => {
          const da = a.__deadlineDate ? a.__deadlineDate.getTime() : Number.POSITIVE_INFINITY;
          const db = b.__deadlineDate ? b.__deadlineDate.getTime() : Number.POSITIVE_INFINITY;
          if (da !== db) return da - db; // ⏳ 마감 빠른 순
          const ia = IMP_ORDER[a.importance] ?? 9;
          const ib = IMP_ORDER[b.importance] ?? 9;
          if (ia !== ib) return ia - ib; // 🔥 중요도 상 > 중 > 하
          return (a.title || '').localeCompare(b.title || '', 'ko');
        });

      setTasks(combined);
    } catch (error) {
      console.error('할 일 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  // 모달 open 시 로드
  useEffect(() => {
    if (isOpen && user?.uid) loadTasks();
  }, [isOpen, user?.uid, loadTasks]);

  // 외부 저장 이벤트 시 새로고침
  useEffect(() => {
    const handleTaskSaved = () => {
      if (isOpen) loadTasks();
    };
    window.addEventListener('taskSaved', handleTaskSaved);
    return () => window.removeEventListener('taskSaved', handleTaskSaved);
  }, [isOpen, loadTasks]);

  // ✅ 개별 삭제
  const handleDeleteTask = async (taskId) => {
    if (!window.confirm('이 할 일을 삭제하시겠습니까?')) return;
    const target = tasks.find(t => t.id === taskId);
    if (!target) return;

    try {
      if (target.isLocal) {
        const raw = localStorage.getItem('shedAI:tempTasks');
        const arr = raw ? JSON.parse(raw) : [];
        const next = arr.filter(t => t.id !== taskId);
        localStorage.setItem('shedAI:tempTasks', JSON.stringify(next));
      } else {
        if (!user?.uid) return;
        await firestoreService.deleteTask(user.uid, taskId);
      }
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (e) {
      console.error('할 일 삭제 실패:', e);
      alert('할 일 삭제에 실패했습니다.');
    }
  };

  // ✅ 수정
  const handleEdit = (task) => {
    onEditTask?.(task);
    onClose?.();
  };

  // ✅ 전체 삭제
  const handleDeleteAllTasks = async () => {
    if (tasks.length === 0) {
      alert('삭제할 할 일이 없습니다.');
      return;
    }
    const msg = `정말로 모든 할 일(${tasks.length}개)을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`;
    if (!window.confirm(msg)) return;

    try {
      const hasFs = tasks.some(t => !t.isLocal);
      const hasLocal = tasks.some(t => t.isLocal);

      if (hasFs && user?.uid) {
        await firestoreService.deleteAllTasks(user.uid);
      }
      if (hasLocal) {
        localStorage.removeItem('shedAI:tempTasks');
      }
      setTasks([]);
      alert('모든 할 일이 삭제되었습니다.');
    } catch (e) {
      console.error('전체 할 일 삭제 실패:', e);
      alert('전체 할 일 삭제에 실패했습니다.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-management-modal" onClick={(e) => e.stopPropagation()}>
        <div className="task-management-header">
          <h2>할 일 관리</h2>
          <div className="header-actions">
            <button className="refresh-btn" onClick={loadTasks} disabled={loading}>
              {loading ? '새로고침 중...' : '새로고침'}
            </button>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="task-list">
          {loading ? (
            <div className="loading">할 일을 불러오는 중...</div>
          ) : tasks.length === 0 ? (
            <div className="empty-state">할 일이 없습니다.</div>
          ) : (
            tasks.map(task => (
              <div key={task.id} className={`task-item ${task.isLocal ? 'local-task' : ''}`}>
                <div className="task-info">
                  <div className="task-title">
                    {task.title}
                    {task.isLocal && <span className="local-badge">임시저장</span>}
                  </div>
                  <div className="task-details">
                    <span className="deadline">마감일: {fmtDate(task.__deadlineDate)}</span>
                    <span className="importance">중요도: {task.importance || '중'}</span>
                    <span className="difficulty">난이도: {task.difficulty || '중'}</span>
                  </div>
                  {task.description && (
                    <div className="task-description">{task.description}</div>
                  )}
                </div>
                <div className="task-actions">
                  <button className="edit-btn" onClick={() => handleEdit(task)}>수정</button>
                  <button className="delete-btn" onClick={() => handleDeleteTask(task.id)}>삭제</button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="task-management-footer">
          <button
            className={`delete-all-btn ${tasks.length === 0 ? 'disabled' : ''}`}
            onClick={handleDeleteAllTasks}
            title="전체 삭제"
            disabled={tasks.length === 0 || loading}
          >
            전체 삭제
          </button>
          <button
            className="save-btn"
            onClick={onSaveAndRegenerate}
            title="스케줄 재생성"
            disabled={loading || tasks.length === 0}
          >
            일정 재생성
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaskManagementModal;