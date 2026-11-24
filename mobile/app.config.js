// Dynamic additions on top of app.json (Expo passes its contents as `config`).
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const plugins = [...(config.plugins ?? [])];
  const android = { ...(config.android ?? {}) };

  // The Google Sign-In config plugin needs the reversed iOS client id as a URL scheme,
  // which lives in .env, so it is only added when EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME is set.
  // Android does not need the plugin: the native module is autolinked.
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME?.trim();
  if (iosUrlScheme) {
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }]);
  }

  // Push notifications (FCM) need Firebase's google-services.json (kept out of git, see README).
  // Without it the app builds and runs; it just gets no push token.
  if (fs.existsSync(path.join(__dirname, 'google-services.json'))) {
    android.googleServicesFile = './google-services.json';
  }

  return { ...config, android, plugins };
};
