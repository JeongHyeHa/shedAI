// UI 관련 상수
export const UI_CONSTANTS = {
  MODAL_TYPES: {
    TASK: 'task',
    LIFESTYLE: 'lifestyle'
  },
  
  CHATBOT_MODES: {
    TASK: 'task',
    FEEDBACK: 'feedback'
  },
  
  TASK_INPUT_MODES: {
    CHATBOT: 'chatbot',
    FORM: 'form'
  },
  
  TASK_LEVELS: {
    IMPORTANCE: ['상', '중', '하'],
    DIFFICULTY: ['상', '중', '하']
  },
  
  CALENDAR_VIEWS: {
    MONTH: 'dayGridMonth',
    WEEK: 'timeGridWeek',
    DAY: 'timeGridDay'
  },
  
  EVENT_TYPES: {
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
