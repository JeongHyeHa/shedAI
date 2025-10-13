// 메시지 관리 훅 ::: 채팅 메시지를 관리하고, 첨부파일을 추가/제거하는 기능을 담당
// 채팅 메시지들을 Firebase에 자동 저장, AI가 대화맥락을 이해할 수 있게 관리 
import { useState, useCallback, useEffect } from 'react';
import firestoreService from '../services/firestoreService';
import { useAuth } from '../contexts/AuthContext';

export const useMessageManagement = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [conversationContext, setConversationContext] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // 사용자 메시지 로드
  const loadMessages = useCallback(async () => {
    if (!user?.uid) return;
    
    try {
      setLoading(true);
      const userData = await firestoreService.getUserDataForAI(user.uid, user);
      if (userData?.lastSchedule?.conversationContext) {
        setConversationContext(userData.lastSchedule.conversationContext);
      }
    } catch (error) {
      console.error('메시지 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  // AI 메시지 추가
  const addAIMessage = useCallback(async (text, userMessage = null) => {
    if (!user?.uid) return;
    
    const newMessage = {
      type: 'ai',
      text,
      timestamp: new Date()
    };
    
    const newContext = [
      ...conversationContext,
      { role: 'assistant', content: text }
    ];
    
    setMessages(prev => [...prev, newMessage]);
    setConversationContext(newContext);
    
    // 대화형 피드백으로 저장 (사용자 메시지가 있는 경우)
    if (userMessage) {
      try {
        await firestoreService.saveConversationalFeedback(
          user.uid,
          userMessage,
          text,
          { conversationContext: newContext }
        );
      } catch (error) {
        console.error('대화형 피드백 저장 실패:', error);
      }
    }
    
    // Firebase에 대화 컨텍스트 저장
    try {
      await firestoreService.saveScheduleSession(user.uid, {
        conversationContext: newContext,
        lastMessage: text,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('AI 메시지 저장 실패:', error);
    }
  }, [user?.uid, conversationContext]);
  
  // 사용자 메시지 추가
  const addUserMessage = useCallback(async (text, userAttachments = []) => {
    if (!user?.uid) return;
    
    const newMessage = {
      type: 'user',
      text,
      attachments: [...userAttachments],
      timestamp: new Date()
    };
    
    const newContext = [
      ...conversationContext,
      { role: 'user', content: text }
    ];
    
    setMessages(prev => [...prev, newMessage]);
    setAttachments([]);
    setCurrentMessage('');
    setConversationContext(newContext);
    
    // Firebase에 대화 컨텍스트 저장
    try {
      await firestoreService.saveScheduleSession(user.uid, {
        conversationContext: newContext,
        lastMessage: text,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('사용자 메시지 저장 실패:', error);
    }
  }, [user?.uid, conversationContext]);

  // 첨부파일 제거
  const removeAttachment = useCallback((index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 첨부파일 추가
  const addAttachment = useCallback((attachment) => {
    setAttachments(prev => [...prev, attachment]);
  }, []);

  // 메시지 초기화
  const clearMessages = useCallback(async () => {
    if (!user?.uid) return;
    
    setMessages([]);
    setConversationContext([]);
    
    // Firebase에서도 대화 컨텍스트 초기화
    try {
      await firestoreService.saveScheduleSession(user.uid, {
        conversationContext: [],
        lastMessage: '',
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('메시지 초기화 실패:', error);
    }
  }, [user?.uid]);

  // 컴포넌트 마운트 시 메시지 로드
  useEffect(() => {
    if (user?.uid) {
      loadMessages();
    }
  }, [user?.uid, loadMessages]);

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
    clearMessages,
    loading,
    loadMessages
  };
};
