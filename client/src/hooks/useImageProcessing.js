// 이미지 처리 훅 ::: 이미지를 처리하고 GPT-4o로 텍스트를 추출하는 기능을 담당
// 이미지 압축-> 서버 전송 속도 향상, Base64로 변환-> 이미지를 텍스트 형태로 변환해서 서버에 전송
// OCR 처리: GPT-4o Vision으로 이미지에서 텍스트 추출 
import { useState, useCallback } from 'react';
import apiService from '../services/apiService';

export const useImageProcessing = () => {
  const [isConverting, setIsConverting] = useState(false);

  // 이미지 압축 함수
  const compressImage = useCallback((file, maxWidth = 1920, quality = 0.8) => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }, []);

  // 이미지를 Base64로 변환
  const convertImageToBase64 = useCallback(async (file) => {
    try {
      const maxSize = 20 * 1024 * 1024; // 20MB
      
      if (file.size > maxSize) {
        console.log('이미지가 너무 커서 압축합니다...');
        const compressedImage = await compressImage(file, 2560, 0.8);
        const base64Data = compressedImage.split(',')[1];
        const sizeInBytes = (base64Data.length * 3) / 4;
        
        if (sizeInBytes > maxSize) {
          console.log('여전히 크므로 더 강하게 압축합니다...');
          const moreCompressedImage = await compressImage(file, 1920, 0.6);
          const moreCompressedData = moreCompressedImage.split(',')[1];
          const moreCompressedSize = (moreCompressedData.length * 3) / 4;
          
          if (moreCompressedSize > maxSize) {
            throw new Error('이미지 파일이 너무 큽니다. 더 작은 이미지를 선택해주세요.');
          }
          
          return moreCompressedImage;
        }
        
        return compressedImage;
      } else {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
    } catch (error) {
      throw new Error(`이미지 처리 실패: ${error.message}`);
    }
  }, [compressImage]);

  // GPT-4o를 사용한 이미지 처리
  const convertImageToText = useCallback(async (imageFile) => {
    try {
      setIsConverting(true);
      console.log('GPT-4o 이미지 처리 시작...');
      
      const base64Image = await convertImageToBase64(imageFile);
      console.log('Base64 변환 완료, 크기:', Math.round(base64Image.length / 1024), 'KB');
      
      const result = await apiService.processImage(
        base64Image,
        `당신은 시간표와 일정 정보를 정확히 인식하고 텍스트로 변환하는 전문가입니다.

이 이미지에서 다음 정보를 정확히 추출하여 구조화된 텍스트로 변환해주세요:

1. **시간표 정보**:
   - 요일 (월요일, 화요일, 수요일, 목요일, 금요일, 토요일, 일요일)
   - 시간 (시:분 형식으로 정확히 인식)
   - 과목명, 활동명, 일정명

2. **일정 정보**:
   - 날짜 (구체적인 날짜 또는 상대적 표현)
   - 시간대
   - 일정 내용

3. **출력 형식**:
   - 요일별로 구분하여 정리
   - 시간 순서대로 정렬
   - 각 항목을 명확하게 구분
   - 불필요한 설명이나 해석은 제외하고 순수한 정보만 추출

예시:
월요일
09:00-10:30 수학
10:45-12:15 영어
...

화요일
14:00-15:30 회의
...

정확하고 간결하게 정보를 추출해주세요.`
      );
      
      console.log('GPT-4o 이미지 처리 결과:', result.text);
      return result.text;
    } catch (error) {
      console.error('GPT-4o 이미지 처리 실패:', error);
      let errorMessage = '이미지 처리에 실패했습니다.';
      if (error.message.includes('너무 큽니다')) {
        errorMessage = error.message;
      } else if (error.message.includes('413')) {
        errorMessage = '이미지 파일이 너무 큽니다. 더 작은 이미지를 선택해주세요.';
      } else if (error.message.includes('404')) {
        errorMessage = '서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.';
      }
      
      alert(errorMessage);
      throw error;
    } finally {
      setIsConverting(false);
    }
  }, [convertImageToBase64]);

  return {
    isConverting,
    compressImage,
    convertImageToBase64,
    convertImageToText
  };
};
