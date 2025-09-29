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
        "이 이미지에서 시간표나 일정 정보를 텍스트로 추출해주세요. 요일, 시간, 과목명 등을 정확히 인식하여 정리해주세요."
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
