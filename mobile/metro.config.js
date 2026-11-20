// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The AI chat page is a single self-contained `assets/webchat/index.html`
// (built by `npm run sync` in webview/). Metro treats it as an asset so it can
// be `require`d and resolved to a real file:// URI at runtime (src/webchat/bundle.ts).
config.resolver.assetExts = [...config.resolver.assetExts, 'html'];

module.exports = config;
