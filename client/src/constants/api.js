// API 관련 상수
export const API_BASE_URL = 'http://localhost:3001';  // 서버 주소

export const API_ENDPOINTS = {
  SCHEDULE: { // 스케줄 생성
    BASE: '/api/schedule',
    GENERATE: '/api/schedule/generate'
  },
  FEEDBACK: { // 피드백 생성
    BASE: '/api/feedback',
    ADVICE: (sessionId) => `/api/feedback/advice/${sessionId}`
  },
  LIFESTYLE: { // 생활패턴 저장
    BASE: '/api/lifestyle-patterns'
  },
  AI: { // AI 이미지 생성, 음성 인식
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
