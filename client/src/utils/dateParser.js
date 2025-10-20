/**
 * 체계적인 날짜 파싱 시스템
 * 다양한 한국어 날짜 표현을 정확히 처리
 */

export class DateParser {
  constructor(baseDate = new Date()) {
    this.baseDate = this.resetToStartOfDay(baseDate);
    this.currentYear = this.baseDate.getFullYear();
    this.currentMonth = this.baseDate.getMonth();
    this.currentDate = this.baseDate.getDate();
    this.currentDay = this.baseDate.getDay(); // 0: 일요일, 6: 토요일
  }

  resetToStartOfDay(date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  getKoreanDayIndex(dayName) {
    const dayMap = {
      '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6
    };
    return dayMap[dayName] || 0;
  }

  // 주 단위 패턴 처리
  parseWeekPatterns(dateStr) {
    const patterns = [
      { regex: /이번\s*주\s*(월|화|수|목|금|토|일)요일/i, weeks: 0 },
      { regex: /다음\s*주\s*(월|화|수|목|금|토|일)요일/i, weeks: 1 },
      { regex: /다다음\s*주\s*(월|화|수|목|금|토|일)요일/i, weeks: 2 },
      { regex: /(\d+)\s*주\s*(후|뒤)/i, weeks: null }, // N주 후
    ];

    for (const pattern of patterns) {
      const match = dateStr.match(pattern.regex);
      if (match) {
        if (pattern.weeks !== null) {
          // 이번주, 다음주, 다다음주
          const targetDay = this.getKoreanDayIndex(match[1]);
          const daysToAdd = (targetDay - this.currentDay + 7) % 7 + (pattern.weeks * 7);
          
          const result = new Date(this.baseDate);
          result.setDate(this.currentDate + daysToAdd);
          return result;
        } else {
          // N주 후
          const weeks = parseInt(match[1], 10);
          const result = new Date(this.baseDate);
          result.setDate(this.currentDate + (weeks * 7));
          return result;
        }
      }
    }
    return null;
  }

  // 월 단위 패턴 처리
  parseMonthPatterns(dateStr) {
    const patterns = [
      { regex: /다다음\s*달\s*(\d{1,2})일/i, months: 2 }, // 다다음달을 먼저 처리
      { regex: /이번\s*달\s*(\d{1,2})일/i, months: 0 },
      { regex: /다음\s*달\s*(\d{1,2})일/i, months: 1 },
      { regex: /(\d+)\s*달\s*(후|뒤)/i, months: null }, // N달 후
    ];

    for (const pattern of patterns) {
      const match = dateStr.match(pattern.regex);
      if (match) {
        if (pattern.months !== null) {
          // 이번달, 다음달, 다다음달
          const day = parseInt(match[1], 10);
          const result = new Date(this.currentYear, this.currentMonth + pattern.months, day);
          return result;
        } else {
          // N달 후
          const months = parseInt(match[1], 10);
          const result = new Date(this.currentYear, this.currentMonth + months, this.currentDate);
          return result;
        }
      }
    }
    return null;
  }

  // 년 단위 패턴 처리
  parseYearPatterns(dateStr) {
    const patterns = [
      { regex: /다음\s*해\s*(\d{1,2})월\s*(\d{1,2})일/i, years: 1 },
      { regex: /(\d+)\s*년\s*(후|뒤)/i, years: null }, // N년 후
    ];

    for (const pattern of patterns) {
      const match = dateStr.match(pattern.regex);
      if (match) {
        if (pattern.years !== null) {
          // 다음해
          const month = parseInt(match[1], 10) - 1; // 월은 0부터 시작
          const day = parseInt(match[2], 10);
          const result = new Date(this.currentYear + 1, month, day);
          return result;
        } else {
          // N년 후
          const years = parseInt(match[1], 10);
          const result = new Date(this.currentYear + years, this.currentMonth, this.currentDate);
          return result;
        }
      }
    }
    return null;
  }

  // 상대적 날짜 패턴 처리
  parseRelativePatterns(dateStr) {
    const patterns = [
      { regex: /내일모레/i, days: 2 }, // 내일모레를 먼저 처리
      { regex: /오늘/i, days: 0 },
      { regex: /금일/i, days: 0 }, // 금일 = 오늘
      { regex: /내일/i, days: 1 },
      { regex: /익일/i, days: 1 }, // 익일 = 내일
      { regex: /모레/i, days: 2 },
      { regex: /명일/i, days: 2 }, // 명일 = 모레
      { regex: /(\d+)일\s*(후|뒤)/i, days: null }, // N일 후
    ];

    for (const pattern of patterns) {
      const match = dateStr.match(pattern.regex);
      if (match) {
        if (pattern.days !== null) {
          // 오늘, 내일, 모레
          const result = new Date(this.baseDate);
          result.setDate(this.currentDate + pattern.days);
          return result;
        } else {
          // N일 후
          const days = parseInt(match[1], 10);
          const result = new Date(this.baseDate);
          result.setDate(this.currentDate + days);
          return result;
        }
      }
    }
    return null;
  }

  // 절대적 날짜 패턴 처리
  parseAbsolutePatterns(dateStr) {
    const patterns = [
      // 2024년 12월 25일
      { regex: /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/i, hasYear: true },
      // 12월 25일
      { regex: /(\d{1,2})월\s*(\d{1,2})일/i, hasYear: false },
    ];

    for (const pattern of patterns) {
      const match = dateStr.match(pattern.regex);
      if (match) {
        if (pattern.hasYear) {
          const year = parseInt(match[1], 10);
          const month = parseInt(match[2], 10) - 1;
          const day = parseInt(match[3], 10);
          return new Date(year, month, day);
        } else {
          const month = parseInt(match[1], 10) - 1;
          const day = parseInt(match[2], 10);
          
          let year = this.currentYear;
          // 현재 월보다 작으면 내년으로 설정
          if (month < this.currentMonth || (month === this.currentMonth && day < this.currentDate)) {
            year += 1;
          }
          
          return new Date(year, month, day);
        }
      }
    }
    return null;
  }

  // 시간 표현 파싱 (날짜와 함께 사용)
  parseTimeExpression(timeStr) {
    if (!timeStr) return null;

    const patterns = [
      { regex: /00시/i, hour: 0 },
      { regex: /12시/i, hour: 12 },
      { regex: /오후\s*12시/i, hour: 12 },
      { regex: /자정/i, hour: 0 },
      { regex: /정오/i, hour: 12 },
      { regex: /(\d{1,2})시/i, hour: null }, // N시
      { regex: /오전\s*(\d{1,2})시/i, hour: null }, // 오전 N시
      { regex: /오후\s*(\d{1,2})시/i, hour: null }, // 오후 N시
    ];

    for (const pattern of patterns) {
      const match = timeStr.match(pattern.regex);
      if (match) {
        if (pattern.hour !== null) {
          return pattern.hour;
        } else {
          let hour = parseInt(match[1], 10);
          if (timeStr.includes('오후') && hour !== 12) {
            hour += 12;
          } else if (timeStr.includes('오전') && hour === 12) {
            hour = 0;
          }
          return hour;
        }
      }
    }
    return null;
  }

  // 메인 파싱 함수
  parse(dateStr) {
    if (!dateStr) return null;

    // 1. 상대적 날짜 패턴 (오늘, 내일, 모레, N일 후)
    let result = this.parseRelativePatterns(dateStr);
    if (result) return result;

    // 2. 주 단위 패턴 (이번주, 다음주, 다다음주, N주 후)
    result = this.parseWeekPatterns(dateStr);
    if (result) return result;

    // 3. 월 단위 패턴 (이번달, 다음달, 다다음달, N달 후)
    result = this.parseMonthPatterns(dateStr);
    if (result) return result;

    // 4. 년 단위 패턴 (다음해, N년 후)
    result = this.parseYearPatterns(dateStr);
    if (result) return result;

    // 5. 절대적 날짜 패턴 (2024년 12월 25일, 12월 25일)
    result = this.parseAbsolutePatterns(dateStr);
    if (result) return result;

    return null;
  }
}

// 편의 함수
export function parseDateString(dateStr, baseDate = new Date()) {
  const parser = new DateParser(baseDate);
  return parser.parse(dateStr);
}

// 테스트 함수
export function testDateParser() {
  const testCases = [
    '오늘',
    '내일',
    '모레',
    '이번주 월요일',
    '다음주 수요일',
    '다다음주 금요일',
    '3주 후',
    '이번달 15일',
    '다음달 1일',
    '다다음달 10일',
    '2달 후',
    '다음해 1월 1일',
    '1년 후',
    '2024년 12월 25일',
    '12월 25일',
    '10월 27일',
    '5일 후',
  ];

  console.log('=== 날짜 파싱 테스트 ===');
  testCases.forEach(testCase => {
    const result = parseDateString(testCase);
    console.log(`"${testCase}" → ${result ? result.toLocaleDateString('ko-KR') : '파싱 실패'}`);
  });
}
