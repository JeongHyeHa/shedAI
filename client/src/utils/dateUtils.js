// 날짜 관련 유틸리티 함수들

export const resetToStartOfDay = (date) => {
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
};

export const parseDateString = (text, today) => {
  console.log('[parseDateString] 입력:', text, 'today:', today);
  
  const patterns = [
    { regex: /이번\s*주\s*(월|화|수|목|금|토|일)요일/g, type: 'thisWeek' },
    { regex: /다음\s*주\s*(월|화|수|목|금|토|일)요일/g, type: 'nextWeek' },
    { regex: /(\d{1,2})월\s*(\d{1,2})일/g, type: 'monthDay' },
    { regex: /(\d+)일\s*(후|뒤)/g, type: 'daysAfter' },
    { regex: /(\d+)주\s*(후|뒤)/g, type: 'weeksAfter' },
    { regex: /다음\s*(월|화|수|목|금|토|일)요일/g, type: 'nextWeekday' },
    { regex: /오는\s*(월|화|수|목|금|토|일)요일/g, type: 'comingWeekday' },
    { regex: /이번\s*(월|화|수|목|금|토|일)요일/g, type: 'thisWeekday' },
    { regex: /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g, type: 'fullDate' }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    console.log('[parseDateString] 패턴 테스트:', pattern.type, '매치:', match);
    if (match) {
      const result = parseDateByType(match, pattern.type, today);
      console.log('[parseDateString] parseDateByType 결과:', result);
      return result;
    }
  }
  
  console.log('[parseDateString] 매칭 실패, null 반환');
  return null;
};

const parseDateByType = (match, type, today) => {
  const weekdays = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
  
  switch (type) {
    case 'thisWeek':
    case 'thisWeekday':
      const thisWeekday = weekdays[match[1]];
      const thisWeekDate = new Date(today);
      const thisWeekDayDiff = (thisWeekday - today.getDay() + 7) % 7;
      thisWeekDate.setDate(today.getDate() + thisWeekDayDiff);
      return thisWeekDate;
      
    case 'nextWeek':
    case 'nextWeekday':
    case 'comingWeekday':
      const nextWeekday = weekdays[match[1]];
      const nextWeekDate = new Date(today);
      const nextWeekDayDiff = (nextWeekday - today.getDay() + 7) % 7 + 7;
      nextWeekDate.setDate(today.getDate() + nextWeekDayDiff);
      return nextWeekDate;
      
    case 'monthDay':
      const month = parseInt(match[1]);
      const day = parseInt(match[2]);
      console.log('[parseDateByType] monthDay:', { month, day, matchArray: match });
      const monthDayDate = new Date(today.getFullYear(), month - 1, day);
      console.log('[parseDateByType] monthDayDate 생성:', monthDayDate);
      return monthDayDate;
      
    case 'daysAfter':
      const days = parseInt(match[1]);
      const daysAfterDate = new Date(today);
      daysAfterDate.setDate(today.getDate() + days);
      return daysAfterDate;
      
    case 'weeksAfter':
      const weeks = parseInt(match[1]);
      const weeksAfterDate = new Date(today);
      weeksAfterDate.setDate(today.getDate() + (weeks * 7));
      return weeksAfterDate;
      
    case 'fullDate':
      const year = parseInt(match[1]);
      const fullMonth = parseInt(match[2]);
      const fullDay = parseInt(match[3]);
      return new Date(year, fullMonth - 1, fullDay);
      
    default:
      return null;
  }
};

export const convertToRelativeDay = (date, today) => {
  const diffTime = date.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};
