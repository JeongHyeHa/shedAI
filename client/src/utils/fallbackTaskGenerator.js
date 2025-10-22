/**
 * fallbackTaskGenerator.js
 * 사용자의 메시지나 프롬프트에서 "공부/시험/프로젝트/준비"류 태스크를 자동 감지해 생성
 * 
 * @author ShedAI Team
 * @version 2.0.0
 * @description 유연한 키워드 기반 fallback task 자동 생성 시스템
 */

// 상수 정의
// 다중 그룹 키워드 우선순위 (exam > project > study > interview > preparation)
const GROUP_PRIORITY = ['exam','project','study','interview','preparation'];

const KEYWORD_GROUPS = [
  { 
    type: 'exam', 
    keywords: ['시험', '테스트', '평가', '자격증', '시험공부', '오픽', '토익', '토플', '텝스', '한국사', '공무원', '임용고시'],
    titlePattern: /(?:^|[^가-힣A-Za-z0-9])([가-힣A-Za-z0-9\s]{2,30}?)(시험|테스트|평가|자격증)(?:$|[^가-힣A-Za-z0-9])/i
  },
  { 
    type: 'study', 
    keywords: ['공부', '학습', '복습', '예습', '스터디', '과제', '숙제', '독서', '읽기'],
    titlePattern: /(?:^|[^가-힣A-Za-z0-9])([가-힣A-Za-z0-9\s]{2,30}?)(공부|학습|복습|예습|스터디)(?:$|[^가-힣A-Za-z0-9])/i
  },
  { 
    type: 'project', 
    keywords: ['프로젝트', '개발', '제작', '완성', '기획', '작업', '코딩', '프로그래밍', '앱개발', '웹개발'],
    titlePattern: /(?:^|[^가-힣A-Za-z0-9])([가-힣A-Za-z0-9\s]{2,30}?)(프로젝트|개발|제작|작업|코딩)(?:$|[^가-힣A-Za-z0-9])/i
  },
  { 
    type: 'interview', 
    keywords: ['면접', '포트폴리오', '자기소개서', '이력서', '취업', '구직', '채용'],
    titlePattern: /(?:^|[^가-힣A-Za-z0-9])([가-힣A-Za-z0-9\s]{2,30}?)(면접|포트폴리오|자기소개서|이력서)(?:$|[^가-힣A-Za-z0-9])/i
  },
  { 
    type: 'preparation', 
    keywords: ['준비', '대비', '계획', '설계', '정리', '정돈', '마무리'],
    titlePattern: /(?:^|[^가-힣A-Za-z0-9])([가-힣A-Za-z0-9\s]{2,30}?)(준비|대비|계획|정리)(?:$|[^가-힣A-Za-z0-9])/i
  }
];

const DYNAMIC_KEYWORDS = [
  '시험', '공부', '연습', '복습', '과제', '준비', '연구', '정리',
  '작성', '리뷰', '발표', '예습', '트레이닝', '모의고사', '학습',
  '개발', '프로그래밍', '코딩', '프로젝트', '완성', '제작',
  '면접', '포트폴리오', '자기소개서', '이력서', '취업', '구직'
];

const DURATION_SETTINGS = {
  HIGH: 150,    // 상급: 2.5시간 (집중 우선 배치형)
  MEDIUM: 120,  // 중급: 2시간 (기본 몰입 시간)
  LOW: 90       // 하급: 1.5시간 (유동형)
};

/**
 * 텍스트에서 학습/업무 관련 키워드를 감지하고 적절한 fallback task를 생성
 * 
 * @param {string} text - 분석할 텍스트 (프롬프트, 메시지 등)
 * @returns {Object|null} 생성된 fallback task 객체 또는 null
 * @returns {string} returns.title - 추출된 작업 제목
 * @returns {string} returns.start - 시작 시간 (HH:MM 형식)
 * @returns {string} returns.end - 종료 시간 (HH:MM 형식)
 * @returns {string} returns.type - 작업 타입 ('task')
 * @returns {string} returns.source - 감지 소스 ('fallback_detection')
 * @returns {string} returns.detectedType - 감지된 카테고리 타입
 * 
 * @example
 * // "정보처리기사 시험 준비" 입력 시
 * detectAndGenerateFallbackTask("정보처리기사 시험 준비")
 * // → { title: "정보처리기사 시험", start: "19:00", end: "21:00", type: "task", ... }
 */
export const detectAndGenerateFallbackTask = (text) => {
  if (!text || typeof text !== 'string') return null;

  // 텍스트를 한 번만 소문자로 변환 (성능 최적화)
  const lc = text.toLowerCase();

  // 키워드 그룹별로 매칭 시도 (우선순위 순서대로)
  // 현재 배열이 GROUP_PRIORITY 순서와 일치하므로 정렬 생략
  // 향후 변경 시: KEYWORD_GROUPS.sort((a,b)=>GROUP_PRIORITY.indexOf(a.type)-GROUP_PRIORITY.indexOf(b.type));
  for (const group of KEYWORD_GROUPS) {
    const hasKeyword = group.keywords.some(keyword => 
      lc.includes(keyword.toLowerCase())
    );
    
    if (hasKeyword) {
      // 동적으로 title 구성
      let inferredTitle = '중요 작업 준비';
      
      // 패턴 매칭으로 더 구체적인 제목 추출
      const titleMatch = text.match(group.titlePattern);
      if (titleMatch && titleMatch[1]) {
        inferredTitle = titleMatch[1].trim() + ' ' + titleMatch[2];
      } else {
        // 패턴 매칭 실패 시 첫 번째 매칭된 키워드로 제목 생성
        const matchedKeyword = group.keywords.find(keyword => 
          text.toLowerCase().includes(keyword.toLowerCase())
        );
        if (matchedKeyword) {
          inferredTitle = `${matchedKeyword} 관련 작업`;
        }
      }

      // 기본 배치 시간 (19:00~21:00, 2시간)
      return {
        title: inferredTitle,
        start: '19:00',
        end: '21:00',
        type: 'task',
        source: 'fallback_detection',
        detectedType: group.type
      };
    }
  }

  return null;
};

/**
 * AI 응답에서도 fallback task를 감지 (notes, explanation 등)
 * @param {Object} aiResponse - AI 응답 객체
 * @returns {Object|null} - 생성된 fallback task 객체 또는 null
 */
export const detectFallbackFromAIResponse = (aiResponse) => {
  if (!aiResponse) return null;

  // AI 응답의 여러 필드에서 텍스트 추출
  const responseTexts = [];
  
  if (aiResponse.notes) {
    responseTexts.push(typeof aiResponse.notes === 'string' ? aiResponse.notes : aiResponse.notes.join(' '));
  }
  
  if (aiResponse.explanation) {
    responseTexts.push(aiResponse.explanation);
  }
  
  if (aiResponse.message) {
    responseTexts.push(aiResponse.message);
  }

  const combinedText = responseTexts.join(' ');
  return detectAndGenerateFallbackTask(combinedText);
};

/**
 * 기존 할 일 목록에서도 중요한 작업이 있는지 확인
 * @param {Array} existingTasks - 기존 할 일 목록
 * @returns {Object|null} - 가장 중요한 할 일을 기반으로 한 fallback task 또는 null
 */
export const detectFallbackFromExistingTasks = (existingTasks) => {
  if (!Array.isArray(existingTasks) || existingTasks.length === 0) return null;

  // 중요도가 높은 할 일 찾기 (표준화 적용)
  const importantTasks = existingTasks.filter(task =>
    normalizeLevel(task.importance) === 'high'
  );

  if (importantTasks.length > 0) {
    const mostImportant = importantTasks[0];
    return {
      title: mostImportant.title || '중요 작업',
      start: '19:00',
      end: '21:00',
      type: 'task',
      source: 'existing_task_priority',
      originalTaskId: mostImportant.id
    };
  }

  return null;
};

/**
 * 통합 fallback task 감지 (여러 소스에서 종합 판단) - 유연한 키워드 기반
 * 
 * @param {Object} options - 감지 옵션
 * @param {string} options.text - 사용자 입력 텍스트
 * @param {Object} options.aiResponse - AI 응답 객체 (notes, explanation 포함)
 * @param {Array<Object>} options.existingTasks - 기존 할 일 목록
 * @returns {Object|null} 최종 fallback task 또는 null
 * @returns {string} returns.title - 작업 제목
 * @returns {string} returns.start - 시작 시간 (19:00)
 * @returns {string} returns.end - 종료 시간 (난이도 기반 조정)
 * @returns {string} returns.type - 작업 타입 ('task')
 * @returns {string} returns.detectedType - 감지 타입 ('keyword' | 'urgent')
 * @returns {string} returns.source - 감지 소스 ('message:키워드' | 'existingTasks')
 * @returns {string} returns.importance - 중요도 ('상' | '중' | '하')
 * @returns {string} returns.difficulty - 난이도 ('상' | '중' | '하')
 * @returns {number} returns.duration - 지속시간 (분 단위)
 * @returns {boolean} returns.isRepeating - 매일 반복 배치 여부
 * 
 * @example
 * // 긴급한 기존 할 일이 있는 경우
 * detectComprehensiveFallback({
 *   text: "시험 준비",
 *   aiResponse: null,
 *   existingTasks: [{ title: "오픽 시험", deadline: "2024-10-30", importance: "상" }]
 * })
 * // → { title: "오픽 시험", start: "19:00", end: "21:30", importance: "상", isRepeating: true, ... }
 */
export const detectComprehensiveFallback = ({ text, aiResponse, existingTasks }) => {
  if (!text && !existingTasks?.length) return null;

  // 🔍 1. 기존 할 일 중 가장 긴급한 항목 탐색 (마감일 기준, 타입 혼합 지원)
  const now = new Date();
  const urgentTask = (existingTasks || [])
    .filter(t => t.deadline && t.isActive !== false)
    .sort((a, b) => toDate(a.deadline) - toDate(b.deadline))[0];

  // 🔍 2. 사용자가 메시지에 특정 "행동형 키워드"를 포함했는지 탐색
  const matchedKeyword = DYNAMIC_KEYWORDS.find(k => 
    text && text.toLowerCase().includes(k.toLowerCase())
  );

  // 🔍 3. fallback 대상 선택 (우선순위: 긴급한 기존 할 일 > 키워드 매칭)
  const baseTask = urgentTask || (matchedKeyword
    ? { 
        title: `${matchedKeyword} 관련 작업`, 
        deadline: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // 1주일 후
        importance: '상',
        difficulty: '상'
      }
    : null);

  if (!baseTask) return null;

  // 🔍 4. 난이도 기반 duration 자동 조정 (표준화 적용)
  const imp = normalizeLevel(baseTask.importance);
  const diff = normalizeLevel(baseTask.difficulty);
  let durationMin = DURATION_SETTINGS.MEDIUM; // 기본 2시간
  if (diff === 'high' || imp === 'high') {
    durationMin = DURATION_SETTINGS.HIGH; // 2.5시간 (집중 우선 배치형)
  } else if (diff === 'low') {
    durationMin = DURATION_SETTINGS.LOW; // 1.5시간 (유동형)
  }

  // 🔍 5. 집중/유동형 모드 자동 판단 (표준화 적용)
  const focusMode = (diff === 'high' || imp === 'high') 
    ? 'focus'  // 집중 우선 배치형
    : 'flex';  // 유동형

  // 🔍 6. 시험/중요 작업의 경우 매일 반복 배치 힌트 추가 (정확도 향상)
  const isExamOrImportant = 
    imp === 'high' ||
    fallbackTypeFromTitle(baseTask.title) === 'exam' ||
    (text && /시험|테스트|평가|자격증|면접|프로젝트/i.test(text));

  // 🔍 7. 시작 시간 설정 (일관성을 위해 19:00 고정)
  const startTime = "19:00";

  // 🔍 8. fallback task 생성
  const fallbackTask = {
    title: baseTask.title,
    start: startTime,
    end: clampSameDay(hhmmToMin(startTime), durationMin),
    type: "task",
    mode: focusMode, // 집중형/유동형 모드
    detectedType: matchedKeyword ? "keyword" : "urgent",
    source: matchedKeyword ? `message:${matchedKeyword}` : "existingTasks",
    importance: baseTask.importance || '상',
    difficulty: baseTask.difficulty || '상',
    duration: durationMin,
    isRepeating: isExamOrImportant, // 매일 반복 배치 힌트
    originalTaskId: baseTask.id
  };

  // 📊 상세한 fallback 생성 로그 (개발 환경에서만)
  if (process?.env?.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.info('[Fallback Generated]', {
      title: fallbackTask.title,
      source: fallbackTask.source,
      detectedType: fallbackTask.detectedType,
      mode: fallbackTask.mode, // 집중형/유동형 모드
      duration: `${durationMin}분`,
      timeSlot: `${fallbackTask.start}-${fallbackTask.end}`,
      isRepeating: fallbackTask.isRepeating,
      importance: fallbackTask.importance,
      difficulty: fallbackTask.difficulty
    });
  }

  return fallbackTask;
};

// 시간 변환 유틸리티 (기존 함수 재사용)
const hhmmToMin = (s) => {
  const [h,m] = String(s||'').split(':').map(n=>parseInt(n||'0',10));
  return (isNaN(h)?0:h)*60 + (isNaN(m)?0:m);
};

const minToHHMM = (min) => {
  const h = Math.floor(min/60)%24;
  const m = min%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
};

// 자정 넘어가기 방지 함수 (23:59로 클램프)
const clampSameDay = (startMin, durationMin) => {
  const endMin = startMin + durationMin;
  // 23:59로 클램프 (분할은 상위 레이어에서)
  const END_OF_DAY = 24 * 60 - 1;
  return minToHHMM(Math.min(endMin, END_OF_DAY));
};

// 중요도/난이도 표준화 함수 (ko/en 혼용 지원)
const normalizeLevel = (v) => {
  const s = String(v||'').toLowerCase();
  if (['상','high','urgent','important'].includes(s)) return 'high';
  if (['하','low','minor'].includes(s)) return 'low';
  return 'medium';
};

// deadline 타입 혼합 정렬을 위한 안전한 날짜 변환
const toDate = (x) => {
  if (!x) return new Date(8640000000000000); // MAX_DATE (미래로 정렬)
  if (x.toDate) return x.toDate(); // Firestore Timestamp
  return new Date(x);
};

// 제목에서 fallback 타입 추출 (정확도 향상)
const fallbackTypeFromTitle = (t = '') => {
  const s = String(t);
  if (/시험|테스트|평가|자격증/.test(s)) return 'exam';
  if (/프로젝트|개발|코딩|프로그래밍/.test(s)) return 'project';
  return null;
};
