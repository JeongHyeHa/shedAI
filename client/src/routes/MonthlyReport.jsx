// MonthlyReport.jsx ::  월말 레포트 페이지
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import firestoreService from '../services/firestoreService';
import apiService from '../services/apiService';
import PieChart from '../components/Report/PieChart';
import HabitTracker from '../components/Report/HabitTracker';
import { computeActivityMix } from '../utils/activityMix';
import { normalizeCategoryName } from '../utils/categoryAlias';
import { inferCategory } from '../utils/categoryClassifier';

// 마크다운 텍스트 파싱 함수
const parseMarkdownText = (text) => {
  if (!text) return text;
  
  // **텍스트** 패턴을 <strong>태그로 변환
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const content = part.slice(2, -2);
      return <strong key={index} style={{ fontWeight: 'bold', color: '#333' }}>{content}</strong>;
    }
    return part;
  });
};

function extractCategoriesFromPatternsAndTasks({ lifestylePatterns = [], lastSchedule = null }) {
  // 1) AI가 제공한 활동 비중 데이터가 있으면 우선 사용
  if (lastSchedule?.activityAnalysis && typeof lastSchedule.activityAnalysis === 'object') {
    return lastSchedule.activityAnalysis;
  }

  // 2) 스케줄 데이터가 있으면 computeActivityMix으로 계산
  let scheduleArray = null;
  if (lastSchedule?.scheduleData && Array.isArray(lastSchedule.scheduleData)) {
    scheduleArray = lastSchedule.scheduleData;
  } else if (lastSchedule?.schedule && Array.isArray(lastSchedule.schedule)) {
    scheduleArray = lastSchedule.schedule;
  }

  if (scheduleArray && scheduleArray.length > 0) {
    // 카테고리 누락 시 제목/타입 기반으로 즉석 분류 → 정규화
    const normalizedSchedule = scheduleArray.map(day => ({
      ...day,
      activities: (day.activities || []).map(activity => {
        const raw = activity.category || inferCategory(activity);
        return { ...activity, category: normalizeCategoryName(raw) };
      })
    }));
    
    const mixResult = computeActivityMix(normalizedSchedule);
    return mixResult.byCategory;
  }

  // 3) fallback: 빈 객체 반환
  return {};
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
  const [aiAdviceTimestamp, setAiAdviceTimestamp] = useState(null);
  const [isGeneratingAdvice, setIsGeneratingAdvice] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [goal, setGoal] = useState('');
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
      const response = await apiService.generateAdvice(userData, activityAnalysis, goal.trim());
      if (response.ok) {
        const currentTime = new Date();
        setAiAdvice(response.advice);
        setAiAdviceTimestamp(currentTime);
        
        // AI 조언을 별도 컬렉션에 저장
        try {
          await firestoreService.saveAIAdvice(user.uid, {
            advice: response.advice,
            activityAnalysis: activityAnalysis,
            generatedAt: currentTime,
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
        // 별도 컬렉션에서 최근 AI 조언 로드
        const aiAdvices = await firestoreService.getAIAdvices(user.uid, 1);
        
        if (aiAdvices && aiAdvices.length > 0) {
          const latestAdvice = aiAdvices[0];
          setAiAdvice(latestAdvice.advice);
          setAiAdviceTimestamp(latestAdvice.generatedAt || latestAdvice.createdAt);
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
    
    // 카테고리 라벨 매핑 (정규화된 키 대응)
    const categoryLabels = {
      // 기존 고정 카테고리 (하위 호환성)
      work: '업무',
      study: '공부',
      exercise: '운동',
      reading: '독서',
      hobby: '취미',
      others: '기타',
      // 새로운 동적 카테고리
      'Deep work': '집중 작업',
      'Study': '학습/공부',
      'Exercise': '운동',
      'Meetings': '회의/미팅',
      'Commute': '통근/이동',
      'Meals': '식사',
      'Sleep': '수면',
      'Admin': '관리/행정',
      'Chores': '집안일',
      'Leisure': '여가/휴식',
      'Uncategorized': '분류없음'
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>활동 비중</h3>
            <button
              onClick={async () => {
                if (!userData || isRefreshing || !user?.uid) return;
                
                setIsRefreshing(true);
                try {
                  // 활동 비중 재계산
                  const activityAnalysis = extractCategoriesFromPatternsAndTasks(userData);
                  
                  // Firestore에 업데이트
                  const success = await firestoreService.updateLastScheduleActivityAnalysis(
                    user.uid,
                    activityAnalysis
                  );
                  
                  if (success) {
                    // userData 다시 로드하여 화면 갱신
                    const updatedData = await firestoreService.getUserDataForAI(user.uid, user);
                    setUserData(updatedData);
                    console.log('활동 비중이 업데이트되었습니다.');
                  } else {
                    console.warn('활동 비중 업데이트에 실패했습니다.');
                  }
                } catch (error) {
                  console.error('활동 비중 새로고침 실패:', error);
                } finally {
                  setIsRefreshing(false);
                }
              }}
              disabled={isRefreshing || !userData || !user?.uid}
              style={{
                background: isRefreshing || !userData ? '#ccc' : '#6C8AE4',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                cursor: isRefreshing || !userData ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {isRefreshing ? '새로고침 중...' : '새로고침'}
            </button>
          </div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: '300px' }}>
              <h3 style={{ margin: 0 }}>AI 조언</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '14px', color: '#666', whiteSpace: 'nowrap' }}>목표 :</label>
                <input
                  type="text"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="예: 나는 정보처리기사 실기 합격을 목표로 합니다."
                  style={{
                    padding: '6px 12px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontSize: '14px',
                    minWidth: '600px',
                    flex: 1
                  }}
                />
              </div>
            </div>
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
                fontWeight: '500',
                whiteSpace: 'nowrap'
              }}
            >
              {isGeneratingAdvice ? '생성 중...' : '조언 받기'}
            </button>
          </div>
          <div style={{ color: '#555', fontSize: '12px', marginBottom: 8, opacity: 0.7 }}>
            {aiAdviceTimestamp ? (
              `마지막 생성: ${(() => {
                try {
                  const date = aiAdviceTimestamp.toDate ? aiAdviceTimestamp.toDate() : new Date(aiAdviceTimestamp);
                  return date.toLocaleString('ko-KR', { 
                    year: 'numeric', 
                    month: '2-digit', 
                    day: '2-digit', 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  });
                } catch (error) {
                  console.error('타임스탬프 변환 오류:', error);
                  return '날짜 정보 없음';
                }
              })()}`
            ) : (
              '(하루가 끝나가는 22시에 AI 조언이 생성됩니다.)'
            )}
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
                    {line.trim() ? parseMarkdownText(line) : <br />}
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


