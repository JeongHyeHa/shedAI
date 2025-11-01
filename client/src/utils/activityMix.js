// 활동 비중 계산 유틸리티 (AI 결과 누락 시 fallback)

/**
 * 스케줄 배열로부터 카테고리별 시간을 합산해 비중(%) 계산
 * @param {Array} scheduleArray - 스케줄 배열 [{ day, activities: [{ start, end, category, ... }] }]
 * @returns {Object} { byCategory: { "<카테고리명>": <정수 %>, ... }, totalMinutes: <총 분> }
 */
export function computeActivityMix(scheduleArray) {
  const toMin = (t = '00:00') => {
    const [h, m] = String(t)
      .split(':')
      .map((n) => parseInt(n || '0', 10));
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
  };

  const acc = new Map(); // name -> minutes
  let total = 0;

  (scheduleArray || []).forEach((day) => {
    (day.activities || []).forEach((a) => {
      if (!a.start || !a.end) return;
      
      const s = toMin(a.start);
      const e = toMin(a.end);
      // 자정 넘어감 대응
      const dur = Math.max(0, e >= s ? e - s : 24 * 60 - s + e);
      
      const cat = (a.category || '').trim() || 'Uncategorized';
      acc.set(cat, (acc.get(cat) || 0) + dur);
      total += dur;
    });
  });

  if (total <= 0) return { byCategory: {}, totalMinutes: 0 };

  // %로 변환(정수), 반올림으로 합 100 맞추기
  const entries = Array.from(acc.entries()).map(([k, v]) => [
    k,
    (v / total) * 100,
  ]);

  // 가장 큰 항목에 보정치 몰아줘서 합 100 보장
  const rounded = entries.map(([k, p]) => [k, Math.round(p)]);
  const sum = rounded.reduce((s, [, p]) => s + p, 0);
  const diff = 100 - sum;
  
  if (diff !== 0 && rounded.length > 0) {
    // 가장 큰 항목의 인덱스 찾기
    const maxIdx = rounded.reduce(
      (imax, [, p], idx, arr) => (p > arr[imax][1] ? idx : imax),
      0
    );
    rounded[maxIdx][1] += diff;
  }

  return {
    byCategory: Object.fromEntries(rounded), // { "Deep work": 42, ... }
    totalMinutes: total,
  };
}

