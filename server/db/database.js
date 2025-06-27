const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        this.dbPath = path.join(__dirname, 'shedai.db');
        this.db = null;
        this.init();
    }

    init() {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
            if (err) {
                console.error('데이터베이스 연결 실패:', err.message);
            } else {
                console.log('SQLite 데이터베이스 연결 성공');
                this.createTables();
            }
        });
    }

    createTables() {
        const fs = require('fs');
        const schemaPath = path.join(__dirname, 'schema.sql');
        
        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            this.db.exec(schema, (err) => {
                if (err) {
                    console.error('테이블 생성 실패:', err.message);
                } else {
                    console.log('데이터베이스 테이블 생성 완료');
                }
            });
        } else {
            console.error('schema.sql 파일을 찾을 수 없습니다');
        }
    }

    // 사용자 관리
    async getOrCreateUser(sessionId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM users WHERE session_id = ?',
                [sessionId],
                (err, user) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    if (user) {
                        // 마지막 활동 시간 업데이트
                        this.db.run(
                            'UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = ?',
                            [user.id]
                        );
                        resolve(user);
                    } else {
                        // 새 사용자 생성
                        this.db.run(
                            'INSERT INTO users (session_id) VALUES (?)',
                            [sessionId],
                            function(err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                resolve({ id: this.lastID, session_id: sessionId });
                            }
                        );
                    }
                }
            );
        });
    }

    // 생활 패턴 관리
    async saveLifestylePatterns(userId, patterns) {
        return new Promise((resolve, reject) => {
            // 기존 패턴 비활성화
            this.db.run(
                'UPDATE lifestyle_patterns SET is_active = 0 WHERE user_id = ?',
                [userId],
                (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    // 새 패턴들 저장
                    const stmt = this.db.prepare(
                        'INSERT INTO lifestyle_patterns (user_id, pattern_text) VALUES (?, ?)'
                    );
                    
                    patterns.forEach(pattern => {
                        stmt.run([userId, pattern]);
                    });
                    
                    stmt.finalize((err) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                }
            );
        });
    }

    async getLifestylePatterns(userId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT pattern_text FROM lifestyle_patterns WHERE user_id = ? AND is_active = 1',
                [userId],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows.map(row => row.pattern_text));
                    }
                }
            );
        });
    }

    // 스케줄 세션 저장
    async saveScheduleSession(userId, sessionId, scheduleData, lifestyleContext, taskContext) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO schedule_sessions 
                (user_id, session_id, schedule_data, lifestyle_context, task_context) 
                VALUES (?, ?, ?, ?, ?)`,
                [userId, sessionId, JSON.stringify(scheduleData), lifestyleContext, taskContext],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    // 사용자 피드백 저장
    async saveUserFeedback(scheduleSessionId, feedbackType, feedbackText, specificActivities = null, timePeriod = null) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO user_feedbacks 
                (schedule_session_id, feedback_type, feedback_text, specific_activities, time_period) 
                VALUES (?, ?, ?, ?, ?)`,
                [
                    scheduleSessionId, 
                    feedbackType, 
                    feedbackText, 
                    specificActivities ? JSON.stringify(specificActivities) : null,
                    timePeriod
                ],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    // AI 조언 저장
    async saveAIAdvice(userId, adviceType, adviceTitle, adviceContent, triggerConditions = null) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO ai_advice 
                (user_id, advice_type, advice_title, advice_content, trigger_conditions) 
                VALUES (?, ?, ?, ?, ?)`,
                [
                    userId, 
                    adviceType, 
                    adviceTitle, 
                    adviceContent,
                    triggerConditions ? JSON.stringify(triggerConditions) : null
                ],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    // 사용자 선호도 저장/업데이트
    async saveUserPreference(userId, preferenceType, preferenceKey, preferenceValue, confidenceScore = 1.0) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO user_preferences 
                (user_id, preference_type, preference_key, preference_value, confidence_score, evidence_count, updated_at) 
                VALUES (?, ?, ?, ?, ?, 
                    COALESCE((SELECT evidence_count + 1 FROM user_preferences 
                              WHERE user_id = ? AND preference_type = ? AND preference_key = ?), 1),
                    CURRENT_TIMESTAMP)`,
                [userId, preferenceType, preferenceKey, preferenceValue, confidenceScore,
                 userId, preferenceType, preferenceKey],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    // 사용자 선호도 조회
    async getUserPreferences(userId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM user_preferences WHERE user_id = ? ORDER BY confidence_score DESC',
                [userId],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                }
            );
        });
    }

    // 최근 피드백 조회
    async getRecentFeedbacks(userId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT uf.*, ss.session_id 
                FROM user_feedbacks uf
                JOIN schedule_sessions ss ON uf.schedule_session_id = ss.id
                WHERE ss.user_id = ?
                ORDER BY uf.created_at DESC
                LIMIT ?`,
                [userId, limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                }
            );
        });
    }

    // AI 조언 조회
    async getAIAdvice(userId, limit = 5) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM ai_advice 
                WHERE user_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?`,
                [userId, limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                }
            );
        });
    }

    // 사용자 데이터 요약 (AI 프롬프트용)
    async getUserDataSummary(userId) {
        return new Promise((resolve, reject) => {
            Promise.all([
                this.getLifestylePatterns(userId),
                this.getUserPreferences(userId),
                this.getRecentFeedbacks(userId, 5)
            ]).then(([lifestylePatterns, preferences, recentFeedbacks]) => {
                resolve({
                    lifestylePatterns,
                    preferences,
                    recentFeedbacks
                });
            }).catch(reject);
        });
    }

    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('데이터베이스 연결 종료 실패:', err.message);
                } else {
                    console.log('데이터베이스 연결 종료');
                }
            });
        }
    }
}

module.exports = new Database(); 