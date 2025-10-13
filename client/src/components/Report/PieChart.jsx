import React from 'react';

function polarToCartesian(cx, cy, r, angle) {
  const a = (angle - 90) * Math.PI / 180.0;
  return { x: cx + (r * Math.cos(a)), y: cy + (r * Math.sin(a)) };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    'M', start.x, start.y,
    'A', r, r, 0, largeArcFlag, 0, end.x, end.y,
    'L', cx, cy,
    'Z'
  ].join(' ');
}

export default function PieChart({ data = [], colors = [], size = 180 }) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  let angle = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {data.map((d, i) => {
        const portion = (d.value || 0) / total * 360;
        const start = angle;
        const end = angle + portion;
        angle = end;
        const path = arcPath(cx, cy, r, start, end);
        return (
          <path key={i} d={path} fill={colors[i % colors.length] || '#6c8'} />
        );
      })}
    </svg>
  );
}


