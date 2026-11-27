module.exports = function (api) {
  api.cache(true);
  return {
    // NativeWind compiles `className` through its own JSX runtime.
    // babel-preset-expo adds the worklets (Reanimated 4) plugin on its own,
    // so it is not listed here.
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
