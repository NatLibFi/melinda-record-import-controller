// @ts-check
import {defineConfig} from 'eslint/config';

export default defineConfig(
  [
    {
      files: [
        "src/**/*.js"
      ],
      ignores: ['node_modules/**', "**/.*", "**/dist/"],
      linterOptions: {
        reportUnusedInlineConfigs: "error",
        reportUnusedDisableDirectives: true
      },
      rules: {
        "array-callback-return": [
          "error",
          {
            "checkForEach": false
          }
        ],
        "eqeqeq": ["error", "always"],
        "max-depth": ["warn", 4],
        "max-lines": ["warn", 500],
        "max-lines-per-function": ["warn", {"max": 100}],
        "no-console": "warn",
        "no-const-assign": "error",
        "no-else-return": ["error", {allowElseIf: false}],
        "no-plusplus": [
          "error",
          {
            "allowForLoopAfterthoughts": true
          }
        ],
        "no-unused-vars": [
          "error",
          {
            "argsIgnorePattern": "next"
          }
        ],
        "no-var": "error",
        "no-warning-comments": "off",
        "prefer-destructuring": ["error", {
          "array": true,
          "object": true
        }],
        "prefer-const": ["error", {
          "destructuring": "any",
          "ignoreReadBeforeAssign": false
        }],
        "radix": "error"
      }
    }
  ]
);
