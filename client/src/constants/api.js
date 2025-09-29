// API 엔드포인트 상수
export const API_BASE_URL = 'http://localhost:3001';

export const API_ENDPOINTS = {
  SCHEDULE: {
    BASE: '/api/schedule',
    GENERATE: '/api/schedule/generate'
  },
  FEEDBACK: {
    BASE: '/api/feedback',
    ADVICE: (sessionId) => `/api/feedback/advice/${sessionId}`
  },
  LIFESTYLE: {
    BASE: '/api/lifestyle-patterns'
  },
  AI: {
    IMAGE: '/api/gpt4o-image',
    AUDIO: '/api/whisper-transcribe'
  }
};

// API 요청 헤더
export const API_HEADERS = {
  JSON: {
    'Content-Type': 'application/json'
  }
};
