import React from 'react';
import Chatbot from '../Chatbot/Chatbot';
import TaskFormModal from './TaskFormModal';
import LifestyleModal from './LifestyleModal';
import { UI_CONSTANTS } from '../../constants/ui';

const Modals = ({
  // Task Modal Props
  showTaskModal,
  setShowTaskModal,
  taskInputMode,
  setTaskInputMode,
  messages,
  currentMessage,
  setCurrentMessage,
  attachments,
  onRemoveAttachment,
  onSubmitMessage,
  onImageUpload,
  onVoiceRecording,
  isRecording,
  isConverting,
  isLoading,
  chatbotMode,
  onModeChange,
  
  // Task Form Props
  taskForm,
  onTaskFormChange,
  onLevelSelect,
  onTaskFormSubmit,
  
  // Lifestyle Modal Props
  showLifestyleModal,
  setShowLifestyleModal,
  lifestyleList,
  lifestyleInput,
  setLifestyleInput,
  onAddLifestyle,
  onDeleteLifestyle,
  onClearAllLifestyles
}) => {
  return (
    <>
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

      <TaskFormModal
        isOpen={showTaskModal && taskInputMode === UI_CONSTANTS.TASK_INPUT_MODES.FORM}
        onClose={() => setShowTaskModal(false)}
        onBackToChatbot={() => setTaskInputMode(UI_CONSTANTS.TASK_INPUT_MODES.CHATBOT)}
        taskForm={taskForm}
        onTaskFormChange={onTaskFormChange}
        onLevelSelect={onLevelSelect}
        onSubmit={onTaskFormSubmit}
      />

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
