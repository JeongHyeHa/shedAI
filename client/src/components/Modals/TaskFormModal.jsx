import React from 'react';
import arrowBackIcon from '../../assets/arrow-small-left-light.svg';
import '../../styles/modal.css';

const TaskFormModal = ({
  isOpen,
  onClose,
  onBackToChatbot,
  taskForm,
  onTaskFormChange,
  onLevelSelect,
  onSubmit
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="task-form-header">
          <button className="back-to-chatbot-btn" onClick={onBackToChatbot}>
            <img src={arrowBackIcon} alt="뒤로가기" width="20" height="20" />
          </button>
          <h2 className="task-form-title">할 일 입력</h2>
        </div>
        
        <div className="task-form-container">
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
                  value={taskForm.deadline}
                  onChange={onTaskFormChange}
                />
              </div>
            </div>
          </div>

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

          <div className="task-form-buttons">
            <button 
              type="button"
              className="task-submit-button"
              onClick={(e) => {
                e.preventDefault(); 
                onSubmit();
              }}
            >
              추가
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskFormModal;
