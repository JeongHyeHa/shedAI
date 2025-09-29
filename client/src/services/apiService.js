import { API_BASE_URL, API_ENDPOINTS, API_HEADERS } from '../constants/api';

class ApiService {
  constructor() {
    this.baseURL = API_BASE_URL;
  }

  // 기본 fetch 래퍼
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: API_HEADERS.JSON,
      ...options
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('API 요청 실패:', error);
      throw error;
    }
  }

  // 스케줄 생성
  async generateSchedule(prompt, conversationContext, sessionId) {
    return this.request(API_ENDPOINTS.SCHEDULE.GENERATE, {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        conversationContext,
        sessionId
      })
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

  // 이미지 처리
  async processImage(image, prompt) {
    return this.request(API_ENDPOINTS.AI.IMAGE, {
      method: 'POST',
      body: JSON.stringify({
        image,
        prompt
      })
    });
  }

  // 음성 인식
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
}

export default new ApiService();
