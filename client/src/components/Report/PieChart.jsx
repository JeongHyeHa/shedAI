import React from 'react';

function polarToCartesian(cx, cy, r, angle) {
  const a = (angle - 90) * Math.PI / 180.0;
  return { x: cx + (r * Math.cos(a)), y: cy + (r * Math.sin(a)) };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  // 각도가 같거나 매우 작으면 빈 경로 반환
  if (startAngle === endAngle || endAngle - startAngle < 0.1) {
    return '';
  }
  
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  
  const path = [
    'M', cx, cy,
    'L', start.x, start.y,
    'A', r, r, 0, largeArcFlag, 1, end.x, end.y,
    'Z'
  ].join(' ');
  
  return path;
}

export default function PieChart({ data = [], colors = [], size = 180 }) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - 10; // 여백을 위해 반지름을 조금 줄임
  let angle = 0;

  // 데이터가 없거나 모든 값이 0인 경우
  if (!data || data.length === 0 || total === 0) {
    return (
      <div style={{ 
        width: size, 
        height: size, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        backgroundColor: '#f5f5f5',
        borderRadius: '50%',
        color: '#666',
        fontSize: '14px',
        textAlign: 'center'
      }}>
        데이터 없음
      </div>
    );
  }

  // 데이터가 있지만 모든 값이 0인 경우 (others: 51이 있으므로 이 조건은 통과)
  const hasNonZeroData = data.some(d => (d.value || 0) > 0);
  if (!hasNonZeroData) {
    return (
      <div style={{ 
        width: size, 
        height: size, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        backgroundColor: '#f5f5f5',
        borderRadius: '50%',
        color: '#666',
        fontSize: '14px',
        textAlign: 'center'
      }}>
        데이터 없음
      </div>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {data.map((d, i) => {
        const portion = (d.value || 0) / total * 360;
        const start = angle;
        const end = angle + portion;
        angle = end;
        
        // portion이 0이면 렌더링하지 않음
        if (portion <= 0) {
          return null;
        }
        
        // 360도 전체인 경우 원을 그림
        if (portion >= 360) {
          return (
            <circle 
              key={`${d.label}-${i}`} 
              cx={cx} 
              cy={cy} 
              r={r} 
              fill={colors[i % colors.length] || '#6c8'} 
            />
          );
        }
        
        const path = arcPath(cx, cy, r, start, end);
        return (
          <path key={`${d.label}-${i}`} d={path} fill={colors[i % colors.length] || '#6c8'} />
        );
      }).filter(Boolean)}
    </svg>
  );
}


