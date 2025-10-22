// 달력 페이지의 버튼들을 관리하는 컴포넌트 
// 다른 페이지에서 같은 버튼 사용// 버튼 추가,수정 시 이 파일만// 책임 분리: 버튼 UI만 담당 
import React from 'react';
import FloatingButtons from '../UI/FloatingButtons';

const CalendarControls = ({
  onPlusClick,    // 할 일 버튼을 클릭했을 때 실행할 함수
  onPencilClick,  // 생활패턴 버튼을 클릭했을 때 실행할 함수
  onAdviceClick,  // 조언 버튼을 클릭했을 때 실행할 함수
  onReportClick,  // 월말 레포트 버튼을 클릭했을 때 실행할 함수
  onResetClick,  // 캘린더 초기화 버튼을 클릭했을 때 실행할 함수
  showLifestyleInMonth,  // 월간 뷰에서 lifestyle 표시 여부
  onToggleLifestyle      // lifestyle 표시 토글 함수
}) => {
  return (
    <>
      <button className="reset-button" onClick={onResetClick}>
        캘린더 초기화
      </button>

      <button 
        className="lifestyle-toggle-button" 
        onClick={onToggleLifestyle}
        style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 1000,
          padding: '8px 12px',
          backgroundColor: showLifestyleInMonth ? '#4CAF50' : '#f44336',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px'
        }}
      >
        {showLifestyleInMonth ? '생활패턴 숨기기' : '생활패턴 보기'}
      </button>

      <FloatingButtons
        onClickPlus={onPlusClick}     // 할 일 버튼 클릭 시 실행할 함수 전달 
        onClickPencil={onPencilClick}
        onClickAdvice={onAdviceClick}
        onClickReport={onReportClick} // 월말 레포트 버튼 클릭 시 실행할 함수 전달
      />
    </>
  );
};

export default CalendarControls;
