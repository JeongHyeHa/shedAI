import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hajeonghye.shedai.dev',
  appName: 'shedAI',
  webDir: 'client/build',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    url: 'http://192.168.219.102:3000',
    cleartext: true
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    }
  }
};

export default config;

