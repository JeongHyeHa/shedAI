import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import firestoreService from '../../services/firestoreService';
import { apiService } from '../../services/apiService';
import './TaskManagementModal.css';

const TaskManagementModal = ({ isOpen, onClose, onEditTask, onSaveAndRegenerate }) => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      loadTasks();
    }
  }, [isOpen, user]);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const allTasks = await firestoreService.getAllTasks(user.uid);
      setTasks(allTasks);
    } catch (error) {
      console.error('할 일 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm('이 할 일을 삭제하시겠습니까?')) return;

    try {
      await firestoreService.deleteTask(user.uid, taskId);
      setTasks(tasks.filter(task => task.id !== taskId));
    } catch (error) {
      console.error('할 일 삭제 실패:', error);
      alert('할 일 삭제에 실패했습니다.');
    }
  };

  const handleEditTask = (task) => {
    onEditTask(task);
    onClose();
  };

  const handleDeleteAllTasks = async () => {
    if (tasks.length === 0) {
      alert('삭제할 할 일이 없습니다.');
      return;
    }

    const confirmMessage = `정말로 모든 할 일(${tasks.length}개)을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`;
    if (!window.confirm(confirmMessage)) return;

    try {
      await firestoreService.deleteAllTasks(user.uid);
      setTasks([]); // 로컬 상태도 초기화
      alert('모든 할 일이 삭제되었습니다.');
    } catch (error) {
      console.error('전체 할 일 삭제 실패:', error);
      alert('전체 할 일 삭제에 실패했습니다.');
    }
  };

  const formatDate = (date) => {
    if (!date) return '날짜 없음';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('ko-KR');
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-management-modal" onClick={(e) => e.stopPropagation()}>
        <div className="task-management-header">
          <h2>할 일 관리</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="task-list">
          {loading ? (
            <div className="loading">할 일을 불러오는 중...</div>
          ) : tasks.length === 0 ? (
            <div className="empty-state">할 일이 없습니다.</div>
          ) : (
            tasks.map(task => (
              <div key={task.id} className="task-item">
                <div className="task-info">
                  <div className="task-title">{task.title}</div>
                  <div className="task-details">
                    <span className="deadline">마감일: {formatDate(task.deadline)}</span>
                    <span className="importance">중요도: {task.importance}</span>
                    <span className="difficulty">난이도: {task.difficulty}</span>
                  </div>
                  {task.description && (
                    <div className="task-description">{task.description}</div>
                  )}
                </div>
                <div className="task-actions">
                  <button 
                    className="edit-btn"
                    onClick={() => handleEditTask(task)}
                  >
                    수정
                  </button>
                  <button 
                    className="delete-btn"
                    onClick={() => handleDeleteTask(task.id)}
                  >
                    삭제
                  </button>
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
            disabled={tasks.length === 0}
          >
            전체 삭제
          </button>
          <button 
            className="save-btn"
            onClick={onSaveAndRegenerate}
            title="스케줄 재생성"
          >
            일정 재생성
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaskManagementModal;
