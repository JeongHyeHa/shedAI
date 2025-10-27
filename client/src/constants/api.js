// API(서버와 통신하는 방법) 관련 상수
export const API_BASE_URL = 'http://localhost:3001';  // 서버 주소

export const API_ENDPOINTS = {
  SCHEDULE: { // 스케줄 생성
    BASE: '/api/schedule',
    GENERATE: '/api/schedule/generate'
  },
  FEEDBACK: { // 피드백 생성
    BASE: '/api/feedback',
    ADVICE: () => '/api/advice'
  },
  LIFESTYLE: { // 생활패턴 저장
    BASE: '/api/lifestyle-patterns'
  },
  AI: { // AI 이미지 생성, 음성 인식
    IMAGE: '/api/gpt4o-image',
    AUDIO: '/api/whisper-transcribe'
  },
  USERS: { // 사용자 데이터 관리 (클라우드 DB)
    BASE: '/api/users',
    DATA: (sessionId) => `/api/users/${sessionId}`,
    LIFESTYLE_PATTERNS: '/api/users/lifestyle-patterns',
    TASKS: '/api/users/tasks',
    SCHEDULES: '/api/users/schedules',
    FEEDBACKS: '/api/users/feedbacks',
    INSIGHTS: (sessionId) => `/api/users/${sessionId}/insights`,
    PERSONALIZED_SCHEDULE: '/api/users/personalized-schedule',
    SYNC: (sessionId) => `/api/users/${sessionId}/sync`
  }
};

// API 요청 헤더
export const API_HEADERS = {
  JSON: {
    'Content-Type': 'application/json'
  }
};
