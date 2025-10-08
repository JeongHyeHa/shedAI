// 로컬 스토리지 훅 ::: 브라우저의 로컬 스토리지에 데이터를 저장하고 가져오는 기능을 담당
// 상태가 바뀌면 자동 저장/ 페이지 새로고침해도 데이터 유지/ 저장, 로드 실패 시 기본값 사용
import { useState, useEffect } from 'react';

export const useLocalStorage = (key, initialValue) => {
  // 초기값 설정
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // 값 업데이트 함수
  const setValue = (value) => {
    try {
      // 함수인 경우 현재 값을 전달
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  };

  // 초기 로드 시 localStorage에서 값 읽기
  useEffect(() => {
    try {
      const item = localStorage.getItem(key);
      if (item) {
        setStoredValue(JSON.parse(item));
      }
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
    }
  }, [key]);

  return [storedValue, setValue];
};
