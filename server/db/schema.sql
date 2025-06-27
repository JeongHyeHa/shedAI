-- 사용자 피드백 및 스케줄 관리 시스템 DB 스키마

-- 사용자 테이블
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 생활 패턴 테이블 (사용자별 고정 패턴)
CREATE TABLE lifestyle_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    pattern_text TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 스케줄 세션 테이블 (각 스케줄 생성 세션)
CREATE TABLE schedule_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    schedule_data JSON NOT NULL, -- 전체 스케줄 JSON
    lifestyle_context TEXT, -- 해당 세션에서 사용된 생활패턴
    task_context TEXT, -- 해당 세션에서 사용된 할일 목록
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 사용자 피드백 테이블 (스케줄에 대한 피드백)
CREATE TABLE user_feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_session_id INTEGER NOT NULL,
    feedback_type TEXT NOT NULL, -- 'positive', 'negative', 'suggestion', 'complaint'
    feedback_text TEXT NOT NULL,
    specific_activities TEXT, -- 구체적인 활동들 (JSON 배열)
    time_period TEXT, -- 피드백이 적용되는 시간대 (예: "저녁", "주말", "평일")
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_session_id) REFERENCES schedule_sessions(id) ON DELETE CASCADE
);

-- AI 조언 테이블 (AI가 사용자에게 제공한 조언)
CREATE TABLE ai_advice (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    advice_type TEXT NOT NULL, -- 'productivity', 'health', 'time_management', 'stress_relief'
    advice_title TEXT NOT NULL,
    advice_content TEXT NOT NULL,
    trigger_conditions TEXT, -- 조언이 생성된 조건 (JSON)
    is_read BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 사용자 선호도 테이블 (AI가 학습할 사용자 패턴)
CREATE TABLE user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    preference_type TEXT NOT NULL, -- 'time_preference', 'activity_preference', 'workload_preference'
    preference_key TEXT NOT NULL, -- 예: 'morning_work', 'break_duration', 'weekend_work'
    preference_value TEXT NOT NULL, -- 예: 'prefer', 'avoid', '30min', '2hours'
    confidence_score FLOAT DEFAULT 1.0, -- AI가 이 선호도를 얼마나 확신하는지 (0.0-1.0)
    evidence_count INTEGER DEFAULT 1, -- 이 선호도를 뒷받침하는 증거의 수
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, preference_type, preference_key)
);

-- 인덱스 생성
CREATE INDEX idx_users_session_id ON users(session_id);
CREATE INDEX idx_lifestyle_user_id ON lifestyle_patterns(user_id);
CREATE INDEX idx_schedule_user_id ON schedule_sessions(user_id);
CREATE INDEX idx_feedback_session_id ON user_feedbacks(schedule_session_id);
CREATE INDEX idx_advice_user_id ON ai_advice(user_id);
CREATE INDEX idx_preferences_user_id ON user_preferences(user_id);
CREATE INDEX idx_preferences_type_key ON user_preferences(preference_type, preference_key); 