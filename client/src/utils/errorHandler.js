// 에러 처리 유틸리티
export class ErrorHandler {
  static handle(error, context = '') {
    const errorMessage = this.getErrorMessage(error);
    const fullContext = context ? `[${context}] ` : '';
    
    console.error(`${fullContext}${errorMessage}`, error);
    
    // 사용자에게 표시할 메시지
    const userMessage = this.getUserFriendlyMessage(error);
    
    return {
      message: userMessage,
      originalError: error,
      context: fullContext
    };
  }

  static getErrorMessage(error) {
    if (error.response) {
      // API 에러
      return `API 요청 실패: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`;
    } else if (error.request) {
      // 네트워크 에러
      return '네트워크 연결을 확인해주세요.';
    } else if (error.message) {
      // 일반 에러
      return error.message;
    } else {
      return '알 수 없는 오류가 발생했습니다.';
    }
  }

  static getUserFriendlyMessage(error) {
    if (error.response?.status === 404) {
      return '요청한 리소스를 찾을 수 없습니다.';
    } else if (error.response?.status === 500) {
      return '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
    } else if (error.response?.status === 401) {
      return '인증이 필요합니다. 다시 로그인해주세요.';
    } else if (error.code === 'auth/network-request-failed') {
      return '네트워크 연결을 확인해주세요.';
    } else if (error.code === 'auth/too-many-requests') {
      return '너무 많은 요청으로 인해 일시적으로 차단되었습니다.';
    } else {
      return '오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
    }
  }

  static showError(error, context = '') {
    const { message } = this.handle(error, context);
    alert(message);
  }

  static showSuccess(message) {
    // 간단한 성공 메시지 표시 (나중에 토스트로 교체 가능)
    console.log('✅', message);
  }
}

// Firebase 에러 처리
export const handleFirebaseError = (error, context = '') => {
  return ErrorHandler.handle(error, `Firebase ${context}`);
};

// API 에러 처리
export const handleAPIError = (error, context = '') => {
  return ErrorHandler.handle(error, `API ${context}`);
};
