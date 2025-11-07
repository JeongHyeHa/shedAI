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

  // 단순 알림 메시지인지 확인 (conversationContext에 저장하지 않음)
  const isNotificationMessage = (text) => {
    if (!text || typeof text !== 'string') return false;
    // "스케줄 설계 이유:"로 시작하는 메시지는 실제 AI 응답이므로 저장해야 함
    if (text.trim().startsWith('스케줄 설계 이유:')) return false;
    const notificationPatterns = [
      /^스케줄이 생성되었습니다!?$/,
      /^스케줄을 생성했습니다!?$/,
      /^캘린더가 초기화되었습니다/,
      /^로그인이 필요합니다/,
      /^스케줄 생성에 실패했습니다/,
      /^스케줄을 생성하는 중입니다/,
      /^DB 데이터를 기반으로 스케줄을 재생성합니다/,
      /^피드백을 반영하여 스케줄을 조정합니다/,
      /^할 일이 수정되었습니다/,
      /^할 일 수정에 실패했습니다/,
      /^저장할 생활패턴이 없습니다/,
      /^요청이 시간 초과되었습니다/,
      /^요청 실패/,
      /^현재 제공할 AI 조언이 없습니다/,
      /^AI 조언을 불러오는데 실패했습니다/,
      /^저장 및 스케줄 생성에 실패했습니다/,
      /^스케줄 재생성에 실패했습니다/
    ];
    return notificationPatterns.some(pattern => pattern.test(text.trim()));
  };

  // AI 메시지 추가
  const addAIMessage = useCallback(async (text, userMessage = null, saveToContext = null) => {
    if (!user?.uid) return;
    
    const newMessage = {
      type: 'ai',
      text,
      timestamp: new Date()
    };
    
    // saveToContext가 명시적으로 지정되지 않은 경우, 알림 메시지인지 자동 판단
    const shouldSaveToContext = saveToContext !== null 
      ? saveToContext 
      : !isNotificationMessage(text);
    
    const newContext = shouldSaveToContext
      ? [...conversationContext, { role: 'assistant', content: text }]
      : conversationContext;
    
    setMessages(prev => [...prev, newMessage]);
    if (shouldSaveToContext) {
      setConversationContext(newContext);
    }
    
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
    
    // conversationContext에 저장할 메시지인 경우에만 Firestore에 저장
    if (shouldSaveToContext) {
      try {
        const updated = await firestoreService.updateActiveScheduleSession(user.uid, {
          conversationContext: newContext,
          lastMessage: text
        });
        if (!updated) {
          await firestoreService.saveScheduleSession(user.uid, {
            conversationContext: newContext,
            lastMessage: text,
            hasSchedule: false,
            isActive: false
          });
        }
      } catch (error) {
        console.error('AI 메시지 저장 실패:', error);
      }
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
