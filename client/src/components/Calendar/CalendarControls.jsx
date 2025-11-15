// CalenderControls.jsx: 달력 페이지의 버튼들을 관리하는 컴포넌트 
// 다른 페이지에서 같은 버튼 사용// 버튼 추가,수정 시 이 파일만// 책임 분리: 버튼 UI만 담당 
import React from 'react';
import FloatingButtons from '../UI/FloatingButtons';

const CalendarControls = ({
  onPlusClick,    // 할 일 버튼을 클릭했을 때 실행할 함수
  onPencilClick,  // 생활패턴 버튼을 클릭했을 때 실행할 함수
  onAdviceClick,  // 조언 버튼을 클릭했을 때 실행할 함수
  onReportClick,  // 월말 레포트 버튼을 클릭했을 때 실행할 함수
  onResetClick,   // 캘린더 초기화 버튼을 클릭했을 때 실행할 함수
  onSaveClick,    // 스케줄 저장 버튼을 클릭했을 때 실행할 함수
  onExportToGoogleCalendar  // Google Calendar로 보내기 버튼을 클릭했을 때 실행할 함수
}) => {
  return (
    <>
      {onSaveClick && (
        <button className="save-button" onClick={onSaveClick}>
          캘린더 수정
        </button>
      )}
      {onExportToGoogleCalendar && (
        <button 
          className="export-google-calendar-button" 
          onClick={onExportToGoogleCalendar}
        >
          Google Calendar 전송
        </button>
      )}
      <button className="reset-button" onClick={onResetClick}>
        캘린더 초기화
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
