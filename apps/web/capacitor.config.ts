import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tally.light',
  appName: 'Tally Light',
  webDir: 'dist',
  server: {
    cleartext: true,
    androidScheme: 'http',
    allowNavigation: ['*'],
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
