// 카테고리 이름 통일 유틸리티

const aliases = [
  { canon: 'Deep work', keys: [/deep ?work/i, /집중(작업|업무)/] },
  { canon: 'Study', keys: [/study|공부|학습/i] },
  { canon: 'Exercise', keys: [/운동|헬스|러닝|요가/i] },
  { canon: 'Meals', keys: [/식사|아침|점심|저녁/i] },
  { canon: 'Chores', keys: [/집안일|정리|청소|설거지/i] },
  { canon: 'Admin', keys: [/보고|정리|메일|서류|행정|잡무/i] },
  { canon: 'Leisure', keys: [/여가|게임|취미|휴식(?!\/)/i] },
  { canon: 'Commute', keys: [/출근|퇴근|통근|이동/i] },
];

/**
 * 카테고리 이름을 표준 형태로 통일
 * @param {string} categoryName - 원본 카테고리 이름
 * @returns {string} - 정규화된 카테고리 이름
 */
export function normalizeCategoryName(categoryName = '') {
  const s = String(categoryName).trim();
  if (!s) return 'Uncategorized';
  
  for (const { canon, keys } of aliases) {
    if (keys.some((re) => re.test(s))) return canon;
  }
  
  return s || 'Uncategorized';
}

