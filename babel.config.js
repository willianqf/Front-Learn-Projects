module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // IMPORTANTE: Esta linha ativa as otimizações do Reanimated
      // e deve ser o último plugin da lista.
      'react-native-reanimated/plugin',
    ],
  };
};