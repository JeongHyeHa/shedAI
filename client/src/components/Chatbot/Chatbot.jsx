// AI 챗봇 인터페이스를 만드는 컴포넌트(할 일 입력/ 피드백 남기는 채팅창)
// 다양한 입력 방식(텍스트, 이미지, 음성) // 사용자 친화적UI(자동 스크롤, 모드별 안내 등)
import React, { useRef, useEffect } from 'react';
import ToggleSwitch from '../UI/ToggleSwitch';  // 할 일/ 피드백 모드 전환 스위치 컴포넌트
import '../../styles/chatbot.css';

const Chatbot = ({
  isOpen,              // 챗봇이 열려있는지 여부
  onClose,             // 챗봇을 닫을 때 실행할 함수
  messages = [],       // 채팅 메시지들 (기본값: 빈 배열)
  currentMessage,      // 현재 입력 중인 메시지
  setCurrentMessage,   // 메시지를 설정하는 함수
  attachments = [],    // 첨부파일들 (기본값: 빈 배열)
  onRemoveAttachment,  // 첨부파일을 제거할 때 실행할 함수
  onSubmitMessage,     // 메시지를 전송할 때 실행할 함수
  onImageUpload,       // 이미지를 업로드할 때 실행할 함수
  onVoiceRecording,    // 음성을 녹음할 때 실행할 함수
  isRecording = false, // 현재 녹음 중인지 여부 (기본값: false)
  isConverting = false,// 파일을 변환 중인지 여부 (기본값: false)
  isLoading = false,   // 로딩 중인지 여부 (기본값: false)
  chatbotMode = 'task',// 챗봇 모드 ('task' 또는 'feedback')
  onModeChange         // 모드를 변경할 때 실행할 함수
}) => {
  const chatContainerRef = useRef(null);
  const fileInputRef = useRef(null);

  // 새로운 메시지가 올 때마다 채팅창을 맨 아래로 자동 스크롤
  useEffect(() => {
    if (chatContainerRef.current && isOpen) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal chatbot-modal" onClick={(e) => e.stopPropagation()}>  {/*배경 클릭 시 챗봇 닫기 */}
        {/* 할 일/ 피드백 모드 전환 스위치 */}
        <div style={{ position: 'absolute', top: 24, left: 24, zIndex: 2 }}>
          <ToggleSwitch
            checked={chatbotMode === 'task'}
            onChange={() => onModeChange(chatbotMode === 'task' ? 'feedback' : 'task')}
            leftLabel="할 일"
            rightLabel="피드백"
          />
        </div>
        
        {/* 챗봇 제목 */}
        <h2 className="chatbot-title" style={{ textAlign: 'center', paddingLeft: 0 }}>
          ShedAI 챗봇
        </h2>
        
        {/* 메시지 표시 영역 */}
        <div className="chat-container" ref={chatContainerRef}>
          {messages.length === 0 && (
            <div className="chat-welcome">
              {chatbotMode === "task" ? (
                <>
                  <p>안녕하세요! 오늘의 할 일을 알려주세요.</p>
                  <p>시간표를 생성하거나 업데이트해 드릴게요!</p>
                </>
              ) : (
                <>
                  <p>현재 스케줄에 대한 피드백을 남겨주세요.</p>
                  <p>AI가 이를 분석하여 더 나은 스케줄을 만들어드립니다.</p>
                </>
              )}
            </div>
          )}
          
          {messages.map((msg, idx) => (
            <div key={idx} className={`chat-message ${msg.type}-message`}>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="message-attachments">
                  {msg.attachments.map((attachment, attIdx) => (
                    <div key={attIdx} className="attachment-preview">
                      {attachment.type === 'image' && (
                        <img src={attachment.data} alt="첨부 이미지" />
                      )}
                      {attachment.type === 'audio' && (
                        <audio controls src={attachment.data}></audio>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {(() => {
                const raw = msg?.text;
                const html = typeof raw === 'string'
                  ? raw.replace(/\n/g, '<br>')
                  : String(raw || '');
                return <div className="message-text" dangerouslySetInnerHTML={{ __html: html }}></div>;
              })()}
              <div className="message-time">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
        
        {/* 첨부파일 미리보기 */}
        {attachments.length > 0 && (
          <div className="attachments-preview">
            {attachments.map((attachment, idx) => (
              <div key={idx} className="attachment-item">
                {attachment.type === 'image' && (
                  <img src={attachment.data} alt="첨부 이미지" />
                )}
                {attachment.type === 'audio' && (
                  <audio controls src={attachment.data}></audio>
                )}
                <button className="remove-attachment" onClick={() => onRemoveAttachment(idx)}>×</button>
              </div>
            ))}
          </div>
        )}
        
        {/* 메시지 입력 영역 */}
        <div className="chat-input-container">
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={onImageUpload}
          />
          
          <button className="chat-attach-btn" onClick={() => fileInputRef.current?.click()}>
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
            title="음성 녹음 (5초간 녹음 후 Whisper API로 변환)"
          >
            <span role="img" aria-label="음성 녹음">
              {isRecording ? '🔴' : '🎤'}
            </span>
          </button>
          
          <div style={{ width: '8px' }}></div>
          
          {/* 변환 상태 표시 */}
          {(isConverting || isRecording) && (
            <div className="conversion-status">
              {isConverting && 'GPT-4o 이미지 처리 중...'}
              {isRecording && '음성 녹음 중 (5초)...'}
            </div>
          )}
          
          {/* 텍스트 입력 */}
          <input
            type="text"
            className="chat-input"
            value={currentMessage}
            onChange={(e) => setCurrentMessage(e.target.value)}
            placeholder={
              chatbotMode === "task"
                ? "할 일을 입력하세요...(마감일, 중요도, 난이도 필수 입력)"
                : "피드백을 입력하세요...(ex. 오전 시간이 너무 빡빡해요)"
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmitMessage();
              }
            }}
          />
          
          {/* 전송 버튼 */}
          <button 
            className="chat-send-button"
            onClick={onSubmitMessage}
            disabled={isLoading}
          >
            전송
          </button>
        </div>
        
        <div className="chatbot-buttons-row">
          <button className="chatbot-close-btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
};

export default Chatbot;
