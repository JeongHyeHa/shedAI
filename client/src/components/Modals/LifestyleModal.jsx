import React from 'react';
import '../../styles/modal.css';

const LifestyleModal = ({
  isOpen,
  onClose,
  lifestyleList = [],
  lifestyleInput,
  setLifestyleInput,
  onAddLifestyle,
  onDeleteLifestyle,
  onClearAllLifestyles
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal lifestyle-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="lifestyle-title">생활 패턴 입력</h2>
        <p className="modal-description">일상적인 생활 패턴을 입력하면 AI가 이를 고려하여 시간표를 생성합니다.</p>
        
        <div className="lifestyle-grid">
          {lifestyleList.map((item, index) => (
            <div key={index} className="lifestyle-item">
              <pre style={{whiteSpace: 'pre-line', overflow: 'auto', maxHeight: '5em', margin: 0}} title={item}>{item}</pre>
              <button className="lifestyle-delete-btn" onClick={() => onDeleteLifestyle(index)}>삭제</button>
            </div>
          ))}
          {lifestyleList.length === 0 && (
            <div className="empty-message">등록된 생활 패턴이 없습니다. 아래에서 추가해주세요.</div>
          )}
        </div>
        
        <div className="lifestyle-actions">
          <div className="lifestyle-input-row">
            <textarea
              className="lifestyle-input"
              value={lifestyleInput}
              onChange={(e) => setLifestyleInput(e.target.value)}
              placeholder="예: 평일 00시~08시 수면"
              rows={2}
              style={{resize: 'none'}}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onAddLifestyle();
                }
              }}
            />
            <button className="lifestyle-add-btn" onClick={onAddLifestyle}>추가</button>
          </div>
          <div className="lifestyle-buttons">
            <button className="lifestyle-clear-btn" onClick={onClearAllLifestyles}>전체 삭제</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LifestyleModal;
