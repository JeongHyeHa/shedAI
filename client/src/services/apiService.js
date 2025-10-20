// 서버와 통신하는 모든 API 호출을 관리 
import { API_BASE_URL, API_ENDPOINTS, API_HEADERS } from '../constants/api';
import firestoreService from './firestoreService';

class ApiService {
  constructor() {
    this.baseURL = API_BASE_URL;
  }

  // 기본 fetch 래퍼
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: API_HEADERS.JSON,
      // 쿠키 세션을 쓴다면 주석 해제
      // credentials: 'include',
      ...options
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 요청 실패: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[API] 요청 실패:', error);
      throw error;
    }
  }

  // 스케줄 생성(gpt-4o) - 서버 시그니처와 일치하도록 수정
  async generateSchedule(messages, lifestylePatterns = [], existingTasks = [], opts = {}) {
    console.log('=== API Service generateSchedule 호출 ===');
    console.log('messages:', messages);
    console.log('lifestylePatterns:', lifestylePatterns);
    console.log('existingTasks:', existingTasks);
    console.log('opts:', opts);

    const lastContent = messages?.[messages.length - 1]?.content || '';

    const requestData = {
      messages,
      lifestylePatterns,
      existingTasks,
      // 서버 구현체 호환을 위해 둘 다 포함 (백엔드에서 하나만 읽어도 됨)
      aiPrompt: lastContent,
      prompt: lastContent,
      ...opts
    };

    console.log('[API] generateSchedule payload bytes:', new Blob([JSON.stringify(requestData)]).size);

    return this.request(API_ENDPOINTS.SCHEDULE.GENERATE, {
      method: 'POST',
      body: JSON.stringify(requestData)
    });
  }

  // 피드백 저장
  async saveFeedback(sessionId, scheduleSessionId, feedbackText) {
    return this.request(API_ENDPOINTS.FEEDBACK.BASE, {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        scheduleSessionId,
        feedbackText
      })
    });
  }

  // AI 조언 조회
  async getAdvice(sessionId) {
    return this.request(API_ENDPOINTS.FEEDBACK.ADVICE(sessionId));
  }

  // 생활 패턴 저장
  async saveLifestylePatterns(sessionId, patterns) {
    return this.request(API_ENDPOINTS.LIFESTYLE.BASE, {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        patterns
      })
    });
  }

  // 이미지 처리(gpt-4o)
  async processImage(image, prompt) {
    return this.request(API_ENDPOINTS.AI.IMAGE, {
      method: 'POST',
      body: JSON.stringify({
        image,
        prompt
      })
    });
  }

  // 음성 인식(gpt-whisper)
  async transcribeAudio(audioBlob) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');

    const response = await fetch(`${this.baseURL}${API_ENDPOINTS.AI.AUDIO}`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }

  // 클라우드 DB 연동을 위한 새로운 API 메서드들
  
  // 사용자 데이터 조회 (Firebase 기반)
  async getUserData(userId) {
    return await firestoreService.getUserDataForAI(userId);
  }

  // 생활 패턴 저장 (Firebase 기반)
  async saveLifestylePatternsToDB(userId, patterns) {
    return await firestoreService.saveLifestylePatterns(userId, patterns);
  }

  // 할 일 저장
  async saveTaskToDB(sessionId, taskData) {
    // ✅ 엔드포인트 체계 통일: /api/users/:sessionId/tasks
    return this.request(`/api/users/${sessionId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        ...taskData
      })
    });
  }

  // 할 일 조회 (중복 제거 + 통일)
  async getTasks(sessionId) {
    return this.request(`/api/users/${sessionId}/tasks`, { method: 'GET' });
  }

  // 할 일 삭제
  async deleteTask(sessionId, taskId) {
    return this.request(`/api/users/${sessionId}/tasks/${taskId}`, {
      method: 'DELETE'
    });
  }

  // 할 일 활성/비활성 토글
  async toggleTaskStatus(sessionId, taskId, isActive) {
    return this.request(`/api/users/${sessionId}/tasks/${taskId}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive })
    });
  }

  // 스케줄 저장
  async saveScheduleToDB(sessionId, scheduleData, scheduleSessionId) {
    return this.request(`/api/users/${sessionId}/schedules`, {
      method: 'POST',
      body: JSON.stringify({
        scheduleData,
        scheduleSessionId
      })
    });
  }

  // 피드백 저장 (DB 버전)
  async saveFeedbackToDB(sessionId, scheduleId, feedbackText) {
    return this.request('/api/users/feedbacks', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        scheduleId,
        feedbackText
      })
    });
  }

  // 사용자 선호도 분석 및 조언
  async getUserInsights(sessionId) {
    return this.request(`/api/users/${sessionId}/insights`);
  }

  // 맞춤형 스케줄 생성 (사용자 패턴 학습 기반)
  async generatePersonalizedSchedule(sessionId, prompt, conversationContext) {
    return this.request('/api/users/personalized-schedule', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        prompt,
        conversationContext
      })
    });
  }

  // 사용자 데이터 동기화
  async syncUserData(sessionId) {
    return this.request(`/api/users/${sessionId}/sync`);
  }

  // AI 기반 사용자 패턴 분석
  async analyzeUserPatterns(userData) {
    return this.request('/api/ai/analyze-patterns', {
      method: 'POST',
      body: JSON.stringify({ userData })
    });
  }

  // AI 기반 맞춤형 프롬프트 생성
  async generatePersonalizedPrompt(userData, basePrompt) {
    return this.request('/api/ai/personalize-prompt', {
      method: 'POST',
      body: JSON.stringify({ userData, basePrompt })
    });
  }

  // AI 기반 사용자 조언 생성
  async generatePersonalizedAdvice(userData) {
    return this.request('/api/ai/generate-advice', {
      method: 'POST',
      body: JSON.stringify({ userData })
    });
  }

  // 대화형 피드백 분석
  async analyzeConversationalFeedback(conversationalFeedbacks) {
    return this.request('/api/ai/analyze-conversational-feedback', {
      method: 'POST',
      body: JSON.stringify({ conversationalFeedbacks })
    });
  }

  // AI 조언 생성
  async generateAdvice(userData, activityAnalysis) {
    return this.request('/api/advice/generate', {
      method: 'POST',
      body: JSON.stringify({ userData, activityAnalysis })
    });
  }

  // 피드백 제출
  async submitFeedback(sessionId, scheduleId, feedbackText) {
    return this.request('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ sessionId, scheduleId, feedbackText })
    });
  }
}

export default new ApiService();
