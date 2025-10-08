// 메시지 관리 훅 ::: 채팅 메시지를 관리하고, 첨부파일을 추가/제거하는 기능을 담당
// 채팅 메시지들을 로컬 스토리지에 자동 저장, AI가 대화맥락을 이해할 수 있게 관리 
import { useState, useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { STORAGE_KEYS } from '../constants/ui';

export const useMessageManagement = () => {
  const [messages, setMessages] = useLocalStorage(STORAGE_KEYS.CHAT_MESSAGES, []);
  const [conversationContext, setConversationContext] = useLocalStorage(STORAGE_KEYS.CHAT_CONTEXT, []);
  const [attachments, setAttachments] = useState([]);
  const [currentMessage, setCurrentMessage] = useState("");

  // AI 메시지 추가
  const addAIMessage = useCallback((text) => {
    const newMessage = {
      type: 'ai',
      text,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
    setConversationContext(prev => [
      ...prev,
      { role: 'assistant', content: text }
    ]);
  }, [setMessages, setConversationContext]);
  
  // 사용자 메시지 추가
  const addUserMessage = useCallback((text, userAttachments = []) => {
    const newMessage = {
      type: 'user',
      text,
      attachments: [...userAttachments],
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
    setAttachments([]);
    setCurrentMessage('');
    setConversationContext(prev => [
      ...prev,
      { role: 'user', content: text }
    ]);
  }, [setMessages, setConversationContext]);

  // 첨부파일 제거
  const removeAttachment = useCallback((index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 첨부파일 추가
  const addAttachment = useCallback((attachment) => {
    setAttachments(prev => [...prev, attachment]);
  }, []);

  // 메시지 초기화
  const clearMessages = useCallback(() => {
    setMessages([]);
    setConversationContext([]);
  }, [setMessages, setConversationContext]);

  return {
    messages,
    setMessages,
    conversationContext,
    setConversationContext,
    attachments,
    setAttachments,
    currentMessage,
    setCurrentMessage,
    addAIMessage,
    addUserMessage,
    removeAttachment,
    addAttachment,
    clearMessages
  };
};
