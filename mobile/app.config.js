// Dynamic additions on top of app.json (Expo passes its contents as `config`).
// The Google Sign-In config plugin needs the reversed iOS client id as a URL scheme,
// which lives in .env, so it is only added when EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME is set.
// Android does not need the plugin: the native module is autolinked.
module.exports = ({ config }) => {
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME?.trim();
  const plugins = [...(config.plugins ?? [])];
  if (iosUrlScheme) {
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }]);
  }
  return { ...config, plugins };
};
