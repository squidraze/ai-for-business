# webview

The AI chat page that the mobile app loads in a WebView (React 19 + Vite, built
into one self-contained `index.html`). It talks to the native host over a
postMessage bridge (`src/bridge/protocol.ts`); the host performs every HTTP call.

```bash
npm install
npm run dev     # browser, with the in-repo mock backend (src/dev/)
npm run sync    # build + copy dist/index.html and the bridge protocol into ../mobile
```
