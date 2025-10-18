import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import firestoreService from '../services/firestoreService';
import apiService from '../services/apiService';
import PieChart from '../components/Report/PieChart';
import HabitTracker from '../components/Report/HabitTracker';

function extractCategoriesFromPatternsAndTasks({ lifestylePatterns = [], lastSchedule = null }) {
  // AI가 제공한 활동 비중 데이터가 있으면 우선 사용
  if (lastSchedule?.activityAnalysis) {
    return lastSchedule.activityAnalysis;
  }

  // AI 데이터가 없으면 스케줄 데이터에서 시간 기반으로 계산
  const buckets = {
    work: 0,
    study: 0,
    exercise: 0,
    reading: 0,
    hobby: 0,
    others: 0
  };

  if (lastSchedule?.scheduleData) {
    try {
      const events = Array.isArray(lastSchedule.scheduleData) ? lastSchedule.scheduleData : [];
      for (const dayBlock of events) {
        if (dayBlock?.activities && Array.isArray(dayBlock.activities)) {
          for (const activity of dayBlock.activities) {
            if (activity?.title && activity?.start && activity?.end) {
              // 시간 계산 (간단한 시간 차이 계산)
              const startTime = activity.start;
              const endTime = activity.end;
              const duration = calculateDuration(startTime, endTime);
              
              const title = String(activity.title).toLowerCase();
              
              // 더 포괄적인 분류 로직
              if (/(운동|exercise|gym|workout|헬스|조깅|달리기|수영|요가|필라테스|산책)/.test(title)) {
                buckets.exercise += duration;
              }
              else if (/(독서|reading|book|책|읽기|독서실)/.test(title)) {
                buckets.reading += duration;
              }
              else if (/(공부|study|lecture|exam|자기계발|학습|공부실|도서관|과제|프로젝트|발표|시험|수업)/.test(title)) {
                buckets.study += duration;
              }
              else if (/(개발|코딩|dev|code|프로그래밍|작업|업무|회의|프로젝트|출근|근무)/.test(title)) {
                buckets.work += duration;
              }
              else if (/(취미|hobby|게임|game|music|음악|영화|드라마|넷플릭스|유튜브|게임|만화|애니)/.test(title)) {
                buckets.hobby += duration;
              }
              else {
                buckets.others += duration;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('스케줄 데이터 파싱 오류:', error);
    }
  }

  // 생활 패턴에서도 시간 기반으로 계산 (간단한 추정)
  for (const pattern of lifestylePatterns) {
    const text = String(pattern).toLowerCase();
    
    if (/(운동|exercise|gym|workout|헬스|조깅|달리기|수영|요가|필라테스|산책)/.test(text)) {
      buckets.exercise += 1; // 1시간으로 추정
    }
    else if (/(독서|reading|book|책|읽기|독서실)/.test(text)) {
      buckets.reading += 1;
    }
    else if (/(공부|study|lecture|exam|자기계발|학습|공부실|도서관|과제|프로젝트|발표|시험|수업)/.test(text)) {
      buckets.study += 1;
    }
    else if (/(개발|코딩|dev|code|프로그래밍|작업|업무|회의|프로젝트|출근|근무)/.test(text)) {
      buckets.work += 1;
    }
    else if (/(취미|hobby|게임|game|music|음악|영화|드라마|넷플릭스|유튜브|게임|만화|애니)/.test(text)) {
      buckets.hobby += 1;
    }
    else {
      buckets.others += 1;
    }
  }

  return buckets;
}

// 시간 차이 계산 함수 (간단한 버전)
function calculateDuration(startTime, endTime) {
  try {
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);
    
    // 다음날로 넘어가는 경우 처리
    if (end < start) {
      end.setDate(end.getDate() + 1);
    }
    
    const diffMs = end - start;
    const diffHours = diffMs / (1000 * 60 * 60);
    return Math.max(0, diffHours); // 최소 0시간
  } catch (error) {
    console.error('시간 계산 오류:', error);
    return 1; // 기본값 1시간
  }
}

export default function MonthlyReport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [userData, setUserData] = useState(null);
  const [habits, setHabits] = useState([]);
  const [logsByHabit, setLogsByHabit] = useState({});
  const [aiAdvice, setAiAdvice] = useState('');
  const [isGeneratingAdvice, setIsGeneratingAdvice] = useState(false);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // AI 조언 생성 함수
  const generateAIAdvice = async () => {
    if (!userData || isGeneratingAdvice || !user?.uid) return;
    
    setIsGeneratingAdvice(true);
    try {
      // buckets를 직접 계산하여 사용
      const activityAnalysis = userData ? extractCategoriesFromPatternsAndTasks(userData) : {};
      const response = await apiService.generateAdvice(userData, activityAnalysis);
      if (response.ok) {
        setAiAdvice(response.advice);
        
        // AI 조언을 Firestore에 저장
        try {
          await firestoreService.saveFeedback(user.uid, {
            type: 'ai_advice',
            advice: response.advice,
            activityAnalysis: activityAnalysis,
            generatedAt: new Date(),
            month: month,
            year: year
          });
          console.log('AI 조언이 Firestore에 저장되었습니다.');
        } catch (saveError) {
          console.error('AI 조언 Firestore 저장 실패:', saveError);
        }
      } else {
        setAiAdvice('AI 조언을 생성할 수 없습니다. 잠시 후 다시 시도해주세요.');
      }
    } catch (error) {
      console.error('AI 조언 생성 실패:', error);
      setAiAdvice('AI 조언을 생성할 수 없습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setIsGeneratingAdvice(false);
    }
  };

  // 22시 자동 AI 조언 생성
  useEffect(() => {
    const checkTimeAndGenerateAdvice = () => {
      const now = new Date();
      const hour = now.getHours();
      
      // 22시에 자동으로 AI 조언 생성
      if (hour === 22 && !aiAdvice && userData) {
        generateAIAdvice();
      }
    };

    // 페이지 로드 시 시간 확인
    checkTimeAndGenerateAdvice();
    
    // 1분마다 시간 확인
    const interval = setInterval(checkTimeAndGenerateAdvice, 60000);
    
    return () => clearInterval(interval);
  }, [userData, aiAdvice]);

  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      const data = await firestoreService.getUserDataForAI(user.uid, user);
      setUserData(data);
      const hs = await firestoreService.getHabits(user.uid);
      setHabits(hs);
      const logs = {};
      for (const h of hs) {
        logs[h.id] = await firestoreService.getHabitLogsForMonth(user.uid, h.id, year, month);
      }
      setLogsByHabit(logs);
    })();
  }, [user?.uid]);

  // AI 조언 로드
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        // 최근 AI 조언 로드
        const feedbacks = await firestoreService.getFeedbacks(user.uid);
        const latestAdvice = feedbacks
          .filter(f => f.type === 'ai_advice')
          .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))[0];
        
        if (latestAdvice) {
          setAiAdvice(latestAdvice.advice);
          console.log('저장된 AI 조언을 로드했습니다.');
        }
      } catch (error) {
        console.error('AI 조언 로드 실패:', error);
      }
    })();
  }, [user?.uid]);

  const buckets = useMemo(() => {
    if (!userData) return null;
    return extractCategoriesFromPatternsAndTasks(userData);
  }, [userData]);
  
  const pieData = useMemo(() => {
    if (!buckets) return [];
    
    // 카테고리 라벨 매핑
    const categoryLabels = {
      work: '업무',
      study: '공부',
      exercise: '운동',
      reading: '독서',
      hobby: '취미',
      others: '기타'
    };
    
    return Object.entries(buckets)
      .filter(([k, v]) => v > 0) // 0인 값은 제외
      .map(([k, v]) => ({ 
        label: categoryLabels[k] || k, 
        value: v 
      }))
      .sort((a, b) => b.value - a.value); // 값이 큰 순으로 정렬
  }, [buckets]);
  
  const colors = ['#6C8AE4', '#8AD1C2', '#E6B85C', '#C58AF0', '#F58EA8', '#A7B0C0'];

  const addHabit = async (name) => {
    if (!user?.uid) return;
    const id = await firestoreService.addHabit(user.uid, { name, source: 'custom' });
    const hs = await firestoreService.getHabits(user.uid);
    setHabits(hs);
    const monthLogs = await firestoreService.getHabitLogsForMonth(user.uid, id, year, month);
    setLogsByHabit(prev => ({ ...prev, [id]: monthLogs }));
  };

  const removeHabit = async (habitId) => {
    if (!user?.uid) return;
    await firestoreService.removeHabit(user.uid, habitId);
    setHabits(prev => prev.filter(h => h.id !== habitId));
    setLogsByHabit(prev => { const n = { ...prev }; delete n[habitId]; return n; });
  };

  const toggleDay = async (habitId, iso, done) => {
    if (!user?.uid) return;
    await firestoreService.setHabitDone(user.uid, habitId, iso, done);
    setLogsByHabit(prev => ({
      ...prev,
      [habitId]: { ...(prev[habitId] || {}), [iso]: done }
    }));
  };

  return (
    <div className="monthly-report" style={{ padding: 24 }}>
      {/* 상단 헤더: 뒤로가기 아이콘 버튼 + 제목 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button 
          onClick={() => navigate('/')}
          aria-label="캘린더로 돌아가기"
          style={{
            background: '#6C8AE4',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: '18px',
            fontWeight: '700'
          }}
        >
          ←
        </button>
        <h1 style={{ margin: 0 }}>월말 레포트</h1>
      </div>
      <p>이번 달 활동을 분석해 비중과 조언을 제공합니다.</p>

      <section style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24 }}>
        <div className="report-card" style={{ background: '#fff', borderRadius: 12, padding: 16 }}>
          <h3>활동 비중</h3>
          {userData ? (
            <>
              <PieChart data={pieData} colors={colors} size={240} />
              <ul style={{ marginTop: 12 }}>
                {pieData.map((d, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, background: colors[i % colors.length], display: 'inline-block', borderRadius: 2 }}></span>
                    <span>{d.label}</span>
                    <span style={{ marginLeft: 'auto' }}>{d.value}</span>
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 8, fontSize: '12px', color: '#666', textAlign: 'center' }}>
                * 단위: 시간
              </div>
            </>
          ) : (
            <div style={{ 
              height: 240, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: '#666',
              fontSize: '14px'
            }}>
              데이터를 불러오는 중...
            </div>
          )}
        </div>
        <div className="report-card" style={{ background: '#fff', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>AI 조언</h3>
            <button
              onClick={generateAIAdvice}
              disabled={isGeneratingAdvice || !userData}
              style={{
                background: isGeneratingAdvice ? '#ccc' : '#6C8AE4',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 16px',
                cursor: isGeneratingAdvice || !userData ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '500'
              }}
            >
              {isGeneratingAdvice ? '생성 중...' : '조언 받기'}
            </button>
          </div>
          <div style={{ color: '#555', fontSize: '12px', marginBottom: 8, opacity: 0.7 }}>
            (하루가 끝나가는 22시에 AI 조언이 생성됩니다.)
          </div>
          <div style={{ 
            color: '#555', 
            minHeight: '200px', 
            maxHeight: '350px', 
            overflowY: 'auto',
            padding: '8px',
            width: '100%',
            backgroundColor: '#fafafa'
          }}>
            {aiAdvice ? (
              <div style={{ margin: 0, lineHeight: '1.6', whiteSpace: 'pre-line' }}>
                {aiAdvice.split('\n').map((line, index) => (
                  <div key={index} style={{ marginBottom: line.trim() ? '8px' : '4px' }}>
                    {line.trim() ? line : <br />}
                  </div>
                ))}
              </div>
            ) : userData ? (
              <p style={{ margin: 0, opacity: 0.6 }}>AI가 사용자의 활동 패턴을 분석하여 맞춤형 조언을 제공합니다.</p>
            ) : (
              <p style={{ margin: 0 }}>데이터를 불러오는 중...</p>
            )}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="report-card" style={{ background: '#fff', borderRadius: 12, padding: 16 }}>
          <HabitTracker
            year={year}
            month={month}
            habits={habits}
            logsByHabit={logsByHabit}
            onToggleDay={toggleDay}
            onAddHabit={addHabit}
            onRemoveHabit={removeHabit}
          />
        </div>
      </section>
    </div>
  );
}


