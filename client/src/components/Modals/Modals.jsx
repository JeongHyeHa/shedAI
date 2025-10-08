// 여러 개의 모달창들을 하나로 묶어서 관리하는 컨테이너 컴포넌트
import React from 'react';
import Chatbot from '../Chatbot/Chatbot';         // 챗봇 모달 컴포넌트
import TaskFormModal from './TaskFormModal';      // 할 일 입력 모달 컴포넌트
import LifestyleModal from './LifestyleModal';    // 생활패턴 입력 모달 컴포넌트
import { UI_CONSTANTS } from '../../constants/ui';

const Modals = ({
  // 힐 일 모달 관련 속성들
  showTaskModal,             // 힐 일 모달 열려있는지 여부
  setShowTaskModal,          // 힐 일 모달 열려있는지 여부 변경 함수
  taskInputMode,            // 힐 일 입력 모드
  setTaskInputMode,          // 힐 일 입력 모드 변경 함수
  messages,                 // 채팅 메시지들
  currentMessage,           // 현재 입력 중인 메시지
  setCurrentMessage,        // 현재 입력 중인 메시지 변경 함수
  attachments,              // 첨부파일들
  onRemoveAttachment,       // 첨부파일 제거 함수
  onSubmitMessage,          // 메시지 전송 함수
  onImageUpload,            // 이미지 업로드 함수
  onVoiceRecording,         // 음성 녹음 함수
  isRecording,              // 음성 녹음 중인지 여부
  isConverting,             // 이미지 처리 중인지 여부
  isLoading,                // 로딩 중인지 여부
  chatbotMode,              // 챗봇 모드
  onModeChange,             // 챗봇 모드 변경 함수
  
  // 할 일 간단 입력 폼 관련 속성들
  taskForm,                 // 할 일 폼
  onTaskFormChange,         // 할 일 폼 변경 함수
  onLevelSelect,            // 할 일 중요도, 난이도 선택 함수
  onTaskFormSubmit,         // 할 일 폼 전송 함수
  
  // 생활패턴 모달 관련 속성들
  showLifestyleModal,       // 생활패턴 모달 열려있는지 여부
  setShowLifestyleModal,    // 생활패턴 모달 열려있는지 여부 변경 함수
  lifestyleList,            // 생활패턴 목록
  lifestyleInput,           // 생활패턴 입력 필드
  setLifestyleInput,        // 생활패턴 입력 필드 변경 함수
  onAddLifestyle,           // 생활패턴 추가 함수
  onDeleteLifestyle,        // 생활패턴 삭제 함수
  onClearAllLifestyles,     // 모든 생활패턴 삭제 함수
}) => {
  // 챗 봇: 할 일 모달이 열려있고, 모드가 챗봇일 때만 표시
  // 할 일 간단 입력 폼: 할 일 모달이 열려있고, 모드가 간단 입력 폼일 때만 표시
  // 생활패턴: 생활패턴 모달이 열려있을 때만 표시
  return (
    <>
      {/* 챗봇 모달 */}
      <Chatbot
        isOpen={showTaskModal && taskInputMode === UI_CONSTANTS.TASK_INPUT_MODES.CHATBOT}
        onClose={() => setShowTaskModal(false)}
        messages={messages}
        currentMessage={currentMessage}
        setCurrentMessage={setCurrentMessage}
        attachments={attachments}
        onRemoveAttachment={onRemoveAttachment}
        onSubmitMessage={onSubmitMessage}
        onImageUpload={onImageUpload}
        onVoiceRecording={onVoiceRecording}
        isRecording={isRecording}
        isConverting={isConverting}
        isLoading={isLoading}
        chatbotMode={chatbotMode}
        onModeChange={onModeChange}
      />

      {/* 할 일 간단 입력 폼 모달 */}
      <TaskFormModal
        isOpen={showTaskModal && taskInputMode === UI_CONSTANTS.TASK_INPUT_MODES.FORM}
        onClose={() => setShowTaskModal(false)}
        onBackToChatbot={() => setTaskInputMode(UI_CONSTANTS.TASK_INPUT_MODES.CHATBOT)}
        taskForm={taskForm}
        onTaskFormChange={onTaskFormChange}
        onLevelSelect={onLevelSelect}
        onSubmit={onTaskFormSubmit}
      />

      {/* 생활패턴 모달 */}
      <LifestyleModal
        isOpen={showLifestyleModal}
        onClose={() => setShowLifestyleModal(false)}
        lifestyleList={lifestyleList}
        lifestyleInput={lifestyleInput}
        setLifestyleInput={setLifestyleInput}
        onAddLifestyle={onAddLifestyle}
        onDeleteLifestyle={onDeleteLifestyle}
        onClearAllLifestyles={onClearAllLifestyles}
      />
    </>
  );
};

export default Modals;
