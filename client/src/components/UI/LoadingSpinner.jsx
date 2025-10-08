// 로딩 스피너 컴포넌트
import React from 'react';

const LoadingSpinner = ({ isLoading, progress = 0 }) => {
  if (!isLoading) return null;

  return (
    <div className="loading-container">
      <div className="circular-spinner">
        <div className="spinner-ring">
          <div className="spinner-background"></div>
          <div className="spinner-progress"></div>
          {progress > 0 && (
            <div className="loading-progress">
              {progress}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoadingSpinner;
