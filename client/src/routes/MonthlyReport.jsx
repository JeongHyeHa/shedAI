import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import firestoreService from '../services/firestoreService';
import PieChart from '../components/Report/PieChart';
import HabitTracker from '../components/Report/HabitTracker';

function extractCategoriesFromPatternsAndTasks({ lifestylePatterns = [], lastSchedule = null }) {
  // Very simple keyword-based bucketing; server/AI can replace later.
  const buckets = {
    work: 0,
    study: 0,
    exercise: 0,
    reading: 0,
    hobby: 0,
    others: 0
  };
  const texts = [];
  texts.push(...lifestylePatterns);
  if (lastSchedule?.scheduleData) {
    try {
      const events = Array.isArray(lastSchedule.scheduleData) ? lastSchedule.scheduleData : [];
      for (const e of events) {
        if (e?.title) texts.push(String(e.title));
      }
    } catch {}
  }
  const lower = texts.map(t => String(t).toLowerCase());
  for (const t of lower) {
    if (/(운동|exercise|gym|workout)/.test(t)) buckets.exercise += 1;
    else if (/(독서|reading|book)/.test(t)) buckets.reading += 1;
    else if (/(공부|study|lecture|exam)/.test(t)) buckets.study += 1;
    else if (/(개발|코딩|dev|code|프로그래밍)/.test(t)) buckets.work += 1;
    else if (/(취미|hobby|게임|game|music)/.test(t)) buckets.hobby += 1;
    else buckets.others += 1;
  }
  return buckets;
}

export default function MonthlyReport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [userData, setUserData] = useState(null);
  const [habits, setHabits] = useState([]);
  const [logsByHabit, setLogsByHabit] = useState({});
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

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

  const buckets = useMemo(() => userData ? extractCategoriesFromPatternsAndTasks(userData) : null, [userData]);
  const pieData = useMemo(() => buckets ? Object.entries(buckets).map(([k, v]) => ({ label: k, value: v })) : [], [buckets]);
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
      <div style={{ marginBottom: 16 }}>
        <button 
          onClick={() => navigate('/')}
          style={{
            background: '#6C8AE4',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '12px 24px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            marginBottom: '16px'
          }}
        >
          ← 캘린더로 돌아가기
        </button>
        <h1>월말 레포트</h1>
        <p>이번 달 활동을 분석해 비중과 조언을 제공합니다.</p>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24 }}>
        <div className="report-card" style={{ background: '#fff', borderRadius: 12, padding: 16 }}>
          <h3>활동 비중</h3>
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
        </div>
        <div className="report-card" style={{ background: '#fff', borderRadius: 12, padding: 16 }}>
          <h3>AI 조언</h3>
          <div style={{ color: '#555' }}>
            {userData ? (
              <p>AI가 사용자의 활동 패턴을 분석하여 맞춤형 조언을 제공합니다.</p>
            ) : (
              <p>데이터를 불러오는 중...</p>
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


