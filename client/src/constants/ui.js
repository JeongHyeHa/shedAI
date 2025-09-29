// UI 관련 상수
export const UI_CONSTANTS = {
  MODAL_TYPES: { // 모달 타입
    TASK: 'task',
    LIFESTYLE: 'lifestyle'
  },
  
  CHATBOT_MODES: { // 챗봇 모드
    TASK: 'task',
    FEEDBACK: 'feedback'
  },
  
  TASK_INPUT_MODES: { // 할 일 입력 모드
    CHATBOT: 'chatbot',
    FORM: 'form'
  },
  
  TASK_LEVELS: { // 할 일 중요도, 난이도
    IMPORTANCE: ['상', '중', '하'],
    DIFFICULTY: ['상', '중', '하']
  },
  
  CALENDAR_VIEWS: { // 캘린더 뷰
    MONTH: 'dayGridMonth',
    WEEK: 'timeGridWeek',
    DAY: 'timeGridDay'
  },
  
  EVENT_TYPES: { // 이벤트 타입
    LIFESTYLE: 'lifestyle',
    TASK: 'task'
  }
};

// 로컬 스토리지 키
export const STORAGE_KEYS = {
  USER_SESSION_ID: 'userSessionId',
  LIFESTYLE_LIST: 'lifestyleList',
  LAST_SCHEDULE: 'lastSchedule',
  LAST_SCHEDULE_SESSION_ID: 'lastScheduleSessionId',
  CHAT_MESSAGES: 'chatMessages',
  CHAT_CONTEXT: 'chatContext'
};
