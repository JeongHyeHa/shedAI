// 세션 관리 훅 ::: 사용자 세션을 관리하는 기능
// 고유한 사용자ID 생성, 페이지 새로고침해도 같은 사용자로 인식, 세션 리셋 시 모든 데이터 초기화 
import { useRef, useCallback } from 'react';
import { STORAGE_KEYS } from '../constants/ui';

export const useSession = () => {
  const sessionIdRef = useRef(null);

  const getOrCreateSessionId = useCallback(() => {
    let sessionId = localStorage.getItem(STORAGE_KEYS.USER_SESSION_ID);
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem(STORAGE_KEYS.USER_SESSION_ID, sessionId);
    }
    return sessionId;
  }, []);

  const updateSessionId = useCallback(() => {
    const newSessionId = getOrCreateSessionId();
    sessionIdRef.current = newSessionId;
    return newSessionId;
  }, [getOrCreateSessionId]);

  const initializeSession = useCallback(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current = getOrCreateSessionId();
    }
    return sessionIdRef.current;
  }, [getOrCreateSessionId]);

  const resetSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.USER_SESSION_ID);
    localStorage.removeItem(STORAGE_KEYS.LAST_SCHEDULE);
    localStorage.removeItem(STORAGE_KEYS.LAST_SCHEDULE_SESSION_ID);
    localStorage.removeItem(STORAGE_KEYS.CHAT_MESSAGES);
    localStorage.removeItem(STORAGE_KEYS.CHAT_CONTEXT);
    updateSessionId();
  }, [updateSessionId]);

  return {
    sessionIdRef,
    getOrCreateSessionId,
    updateSessionId,
    initializeSession,
    resetSession
  };
};
