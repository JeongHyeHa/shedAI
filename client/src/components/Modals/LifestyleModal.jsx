// 생활패턴 입력/관리하는 창
import React from 'react';
import '../../styles/modal.css';

const LifestyleModal = ({
  isOpen,             // 모달이 열려있는지 여부
  onClose,            // 모달 닫을 때 실행할 함수
  lifestyleList = [], // 생활패턴 목록(기본값: 빈 배열)
  lifestyleInput,     // 생활패턴 입력 필드
  setLifestyleInput,  // 생활패턴 입력 필드 변경 함수
  onAddLifestyle,     // 생활패턴 추가 시 실행 함수
  onDeleteLifestyle,  // 생활패턴 삭제 시 실행 함수
  onClearAllLifestyles, // 모든 생활패턴 삭제 시 실행 함수
  onImageUpload,
  onVoiceRecording,
  isRecording,
  isConverting,
  isClearing,         // 전체 삭제 중인지 여부
  overlayZIndex,
  onSaveLifestyleAndRegenerate
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={overlayZIndex ? { zIndex: overlayZIndex } : undefined}>
      <div className="modal lifestyle-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="lifestyle-title">생활 패턴 입력</h2>
        <p className="modal-description">일상적인 생활 패턴을 입력하면 AI가 이를 고려하여 시간표를 생성합니다.</p>
        
        {/* 생활패턴 목록 표시 */}
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
        
        {/* 생활패턴 입력 필드 및 버튼 - 챗봇 입력 영역과 동일 양식으로 통일 */}
        <div className="lifestyle-actions">
          {/* 이미지/음성/텍스트/전송 UI - 챗봇 입력 영역과 동일 양식 */}
          <div className="chat-input-container">
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              id="lifestyle-image-input"
              onChange={onImageUpload}
            />
            <button className="chat-attach-btn" onClick={() => document.getElementById('lifestyle-image-input').click()}>
              <span role="img" aria-label="이미지 첨부">🖼️</span>
            </button>
            <button 
              className="chat-attach-btn" 
              onClick={onVoiceRecording}
              disabled={isRecording || isConverting}
              style={{ 
                backgroundColor: isRecording ? '#ff6b6b' : '#4CAF50',
                opacity: isRecording || isConverting ? 0.7 : 1
              }}
              title="음성 녹음 (5초간 녹음 후 변환)"
            >
              <span role="img" aria-label="음성 녹음">
                {isRecording ? '🔴' : '🎤'}
              </span>
            </button>
            <div style={{ width: '8px' }}></div>
            {(isConverting || isRecording) && (
              <div className="conversion-status">
                {isConverting && '이미지 처리 중...'}
                {isRecording && '음성 녹음 중 (5초)...'}
              </div>
            )}
            <input
              type="text"
              className="chat-input"
              value={lifestyleInput}
              onChange={(e) => setLifestyleInput(e.target.value)}
              placeholder="예: 평일 00시~08시 수면"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onAddLifestyle();
                }
              }}
            />
            <button 
              className="chat-send-button"
              onClick={(e) => { e.preventDefault(); onAddLifestyle(); }}
            >
              추가
            </button>
          </div>
          <div className="lifestyle-buttons">
            <button 
              className="lifestyle-clear-btn" 
              onClick={onClearAllLifestyles}
              disabled={isClearing}
            >
              {isClearing ? '삭제 중...' : '전체 삭제'}
            </button>
            <button className="lifestyle-add-btn" onClick={onSaveLifestyleAndRegenerate}>저장</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LifestyleModal;
