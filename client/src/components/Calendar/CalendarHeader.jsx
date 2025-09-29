// 달력 페이지의 상단 부분을 담당하는 컴포넌트 (제목, 로딩 스피너)
// 코드의 단순함/ 컴포넌트 재사용성/ 추후 유지보수성(제목, 로딩 스피너 수정은 여기서)
import React from 'react';
import LoadingSpinner from '../UI/LoadingSpinner';

const CalendarHeader = ({ isLoading, loadingProgress }) => {
  return (
    <div style={{ position: 'relative' }}>  {/*다른 요소들의 위치 기준*/}
      <h1 className="calendar-title">나만의 시간표 캘린더</h1>
      <LoadingSpinner isLoading={isLoading} progress={loadingProgress} />
    </div>
  );
};

export default CalendarHeader;