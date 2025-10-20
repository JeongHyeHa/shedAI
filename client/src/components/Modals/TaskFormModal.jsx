// 할 일 간단입력 창
import React, { useState } from 'react';
import arrowBackIcon from '../../assets/arrow-small-left-light.svg';
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
}) => {

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={overlayZIndex ? { zIndex: overlayZIndex } : undefined}>
      <div className="modal task-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="task-form-header">
          <button className="back-to-chatbot-btn" onClick={onBackToChatbot}>
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
                      value={taskForm.deadline}
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
                  onClick={(e) => {
                    e.preventDefault(); 
                    onSubmit();
                  }}
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
