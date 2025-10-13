import React, { useMemo } from 'react';

function daysInMonth(year, month) { // month: 1-12
  return new Date(year, month, 0).getDate();
}

export default function HabitTracker({
  year,
  month, // 1-12
  habits = [], // [{id,name}],
  logsByHabit = {}, // { habitId: { 'YYYY-MM-DD': true } }
  onToggleDay, // (habitId, dateISO, done)
  onAddHabit, // (name)
  onRemoveHabit // (habitId)
}) {
  const dim = daysInMonth(year, month);
  const days = useMemo(() => Array.from({ length: dim }, (_, i) => i + 1), [dim]);

  const toISO = (d) => {
    const mm = String(month).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  };

  return (
    <div className="habit-tracker" style={{ width: '100%' }}>
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 12px 0' }}>Habit Tracker</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input 
            type="text" 
            placeholder="새 습관 이름" 
            id="ht-new-name"
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              flex: 1,
              maxWidth: '200px'
            }}
          />
          <button 
            onClick={() => {
              const el = document.getElementById('ht-new-name');
              const name = (el?.value || '').trim();
              if (name) { onAddHabit(name); el.value = ''; }
            }}
            style={{
              padding: '8px 16px',
              background: '#6C8AE4',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            추가
          </button>
        </div>
      </div>
      
      <div style={{ overflowX: 'auto' }}>
        <table style={{ 
          width: '100%', 
          borderCollapse: 'collapse',
          border: '1px solid #ddd',
          minWidth: '600px'
        }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ 
                padding: '12px', 
                textAlign: 'left', 
                border: '1px solid #ddd',
                minWidth: '120px'
              }}>
                Habit
              </th>
              {days.map(d => (
                <th key={d} style={{ 
                  padding: '8px 4px', 
                  textAlign: 'center', 
                  border: '1px solid #ddd',
                  minWidth: '32px',
                  fontSize: '12px'
                }}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {habits.map(h => (
              <tr key={h.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ 
                  padding: '12px', 
                  border: '1px solid #ddd',
                  position: 'relative'
                }}>
                  <span>{h.name}</span>
                  <button 
                    onClick={() => onRemoveHabit(h.id)}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: '#ff4757',
                      color: 'white',
                      border: 'none',
                      borderRadius: '50%',
                      width: '20px',
                      height: '20px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    ×
                  </button>
                </td>
                {days.map(d => {
                  const iso = toISO(d);
                  const done = !!logsByHabit[h.id]?.[iso];
                  return (
                    <td key={iso} style={{ 
                      padding: '4px', 
                      textAlign: 'center', 
                      border: '1px solid #ddd'
                    }}>
                      <button
                        onClick={() => onToggleDay(h.id, iso, !done)}
                        style={{
                          width: '24px',
                          height: '24px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          background: done ? '#6C8AE4' : 'white',
                          color: done ? 'white' : '#666',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px'
                        }}
                      >
                        {done ? '✔' : ''}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


