const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    // scripts/ is dev-only Node tooling (see scripts/signal-eval/README.md) — never imported by
    // app code, never bundled, and not meant to follow the app's own React Native lint rules.
    ignores: ['dist/*', 'node_modules/*', '.expo/*', 'scripts/*'],
  },
];
