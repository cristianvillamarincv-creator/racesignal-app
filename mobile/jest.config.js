module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // jest-expo's own default (see node_modules/jest-expo/jest-preset.js), extended with the
  // RevenueCat packages — react-native-purchases-ui ships ESM that needs Babel transform like
  // every other RN library here; without this, importing PAYWALL_RESULT (Step 8 monetization)
  // into a test file fails with "Jest encountered an unexpected token".
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|react-native-purchases|react-native-purchases-ui|@revenuecat))',
    '/node_modules/react-native-reanimated/plugin/',
  ],
};
