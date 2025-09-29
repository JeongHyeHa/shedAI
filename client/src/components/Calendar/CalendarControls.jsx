// 달력 페이지의 버튼들을 관리하는 컴포넌트 
// 다른 페이지에서 같은 버튼 사용// 버튼 추가,수정 시 이 파일만// 책임 분리: 버튼 UI만 담당 
import React from 'react';
import FloatingButtons from '../UI/FloatingButtons';

const CalendarControls = ({
  onPlusClick,    // 할 일 버튼을 클릭했을 때 실행할 함수
  onPencilClick,  // 생활패턴 버튼을 클릭했을 때 실행할 함수
  onAdviceClick,  // 조언 버튼을 클릭했을 때 실행할 함수
  onResetClick   // 캘린더 초기화 버튼을 클릭했을 때 실행할 함수
}) => {
  return (
    <>
      <button className="reset-button" onClick={onResetClick}>
        캘린더 초기화
      </button>

      <FloatingButtons
        onClickPlus={onPlusClick}     // 할 일 버튼 클릭 시 실행할 함수 전달 
        onClickPencil={onPencilClick}
        onClickAdvice={onAdviceClick}
      />
    </>
  );
};

export default CalendarControls;
