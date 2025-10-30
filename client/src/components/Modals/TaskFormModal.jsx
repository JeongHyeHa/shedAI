// 할 일 간단입력 창
import React, { useEffect, useRef } from 'react';
import arrowBackIcon from '../../assets/arrow-small-left-light.svg';
import { toYMDLocal } from '../../utils/dateUtils';
import '../../styles/modal.css';

const TaskFormModal = ({
  isOpen,             // 모달이 열려있는지 여부
  onClose,            // 모달 닫을 때 실행할 함수
  onBackToChatbot,    // 챗봇으로 돌아가기 버튼 클릭 시 실행할 함수
  taskForm,             // 할 일 폼
  onTaskFormChange,     // 할 일 폼 변경 함수
  onLevelSelect,        // 할 일 중요도, 난이도 선택 함수
  onSubmit,             // 할 일 폼 전송 함수
  isEditing,            // 수정 모드인지 여부
  overlayZIndex,
  onResetTaskForm,      // 제출/닫기 후 폼 초기화 콜백
}) => {

  const wasOpenRef = useRef(!!isOpen);

  // 모달이 닫힐 때도 항상 폼 초기화 (외부에서 isOpen을 false로 바꾼 경우 포함)
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      onResetTaskForm?.();
    }
    wasOpenRef.current = !!isOpen;
  }, [isOpen, onResetTaskForm]);

  if (!isOpen) return null;

  // 제출 후 폼 초기화: onSubmit이 Promise면 await 처리
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const result = onSubmit?.();
      if (result instanceof Promise) {
        const ok = await result;
        if (ok !== false) onResetTaskForm?.();
      } else {
        if (result !== false) onResetTaskForm?.();
      }
    } catch (err) {
      // 실패 시 초기화하지 않음
    }
  };

  // 바깥 클릭으로 닫을 때도 폼 초기화
  const handleOverlayClick = () => {
    onResetTaskForm?.();
    onClose?.();
  };

  // 뒤로가기 버튼 클릭 시 폼 초기화 후 이동
  const handleBackToChatbot = () => {
    onResetTaskForm?.();
    onBackToChatbot?.();
  };

  // 내일부터 선택 가능하도록 min 계산 (정책이 내일 이상일 때)
  const todayPlus1YMD = () => {
    const n = new Date();
    n.setDate(n.getDate() + 1);
    return toYMDLocal(n);
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick} style={overlayZIndex ? { zIndex: overlayZIndex } : undefined}>
      <div className="modal task-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="task-form-header">
          <button className="back-to-chatbot-btn" onClick={handleBackToChatbot}>
            <img src={arrowBackIcon} alt="뒤로가기" width="20" height="20" />
          </button>
          <h2 className="task-form-title">{isEditing ? '할 일 수정' : '할 일 입력'}</h2>
        </div>
        
        <div className="task-form-container">
          {/* 상세 입력 모드 */}
          <>
              {/* 제목, 마감일 입력 폼 */}
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="task-title">제목 <span className="required">*</span></label>
                  <input 
                    type="text" 
                    id="task-title" 
                    className="task-input task-title-input" 
                    placeholder="예: 중간고사 준비"
                    value={taskForm.title}
                    onChange={onTaskFormChange}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="task-deadline">마감일 <span className="required">*</span></label>
                  <div className="date-input-container">
                    <input 
                      type="date" 
                      id="task-deadline" 
                      className="task-input task-date-input"
                      value={taskForm.deadline instanceof Date ? toYMDLocal(taskForm.deadline) : taskForm.deadline}
                      min={todayPlus1YMD()}
                      onChange={onTaskFormChange}
                    />
                  </div>
                </div>
              </div>

              {/* 중요도, 난이도 선택 폼 */}
              <div className="form-row">
                <div className="form-group half-width">
                  <label>중요도 <span className="required">*</span></label>
                  <div className="button-group">
                    <button 
                      type="button"
                      className={`level-button ${taskForm.importance === "상" ? "active" : ""}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onLevelSelect("importance", "상");
                      }}
                    >
                      상
                    </button>
                    <button 
                      type="button"
                      className={`level-button middle ${taskForm.importance === "중" ? "active" : ""}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onLevelSelect("importance", "중");
                      }}
                    >
                      중
                    </button>
                    <button 
                      type="button"
                      className={`level-button ${taskForm.importance === "하" ? "active" : ""}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onLevelSelect("importance", "하");
                      }}
                    >
                      하
                    </button>
                  </div>
                </div>
                
                <div className="form-group half-width">
                  <label>난이도 <span className="required">*</span></label>
                  <div className="button-group">
                    <button 
                      type="button"
                      className={`level-button ${taskForm.difficulty === "상" ? "active" : ""}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onLevelSelect("difficulty", "상");
                      }}
                    >
                      상
                    </button>
                    <button 
                      type="button"
                      className={`level-button middle ${taskForm.difficulty === "중" ? "active" : ""}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onLevelSelect("difficulty", "중");
                      }}
                    >
                      중
                    </button>
                    <button 
                      type="button"
                      className={`level-button ${taskForm.difficulty === "하" ? "active" : ""}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onLevelSelect("difficulty", "하");
                      }}
                    >
                      하
                    </button>
                  </div>
                </div>
              </div>

              {/* 설명 입력 폼 */}
              <div className="form-group">
                <label htmlFor="task-description">설명(선택)</label>
                <textarea 
                  id="task-description" 
                  className="task-input task-textarea" 
                  placeholder="예: 요약 정리 → 문제 풀이 → 복습 순서로 진행"
                  value={taskForm.description}
                  onChange={onTaskFormChange}
                ></textarea>
              </div>

              {/* 제출 버튼 */}
              <div className="task-form-buttons">
                <button 
                  type="button"
                  className="task-submit-button"
                  onClick={handleSubmit}
                >
{isEditing ? '수정' : '추가'}
                </button>
              </div>
            </>
        </div>
      </div>
    </div>
  );
};

export default TaskFormModal;