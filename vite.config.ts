import { defineConfig } from "vite-plus"

export default defineConfig({
  fmt: {
    printWidth: 120,
    semi: false,
    trailingComma: "none",
    embeddedLanguageFormatting: "off",
    sortImports: true,
    ignorePatterns: ["references/*/", ".agents/"]
  },
  lint: {
    plugins: ["typescript", "import", "unicorn", "oxc"],
    categories: {
      correctness: "error",
      suspicious: "error"
    },
    // The plugins' links to the package: no tsconfig includes a path through one, so the type check would
    // read those files without the repo's compiler options. The package is linted at its own path.
    ignorePatterns: ["node_modules/**", "references/*/**", "plugins/*/dw-sdlc"],
    options: {
      denyWarnings: true,
      // The type check needs `typeAware`, which also turns on the type-aware rules of the categories above.
      typeAware: true,
      typeCheck: true
    },
    rules: {
      curly: ["error", "all"],
      // node:test's `it` and `describe` return a Promise the runner awaits itself.
      "typescript/no-floating-promises": [
        "error",
        { allowForKnownSafeCalls: [{ from: "package", name: ["it", "describe"], package: "node:test" }] }
      ],
      // A `parsed as T` follows the schema check that is T's runtime twin; a test casts what JSON.parse returns.
      "typescript/no-unsafe-type-assertion": "off",
      // `[...summary].length` counts a Primitive's summary in code points on purpose.
      "typescript/no-misused-spread": "off",
      // A catch that ends in `fail()`, which returns `never`, needs no `return`; the type check knows it.
      "typescript/consistent-return": "off"
    },
    overrides: [
      {
        files: ["packages/dw-sdlc/src/**"],
        rules: {
          // Processes start through src/exec.ts and src/run-command.ts; references/ is read-only reading.
          "no-restricted-imports": [
            "error",
            {
              paths: [
                { name: "node:child_process", message: "run a process through src/exec.ts or src/run-command.ts" }
              ],
              patterns: [{ group: ["**/references/**"], message: "references/ holds read-only clones" }]
            }
          ],
          // Only src/cli.ts sets the exit code.
          "unicorn/no-process-exit": "error"
        }
      },
      {
        files: ["packages/dw-sdlc/src/exec.ts", "packages/dw-sdlc/src/run-command.ts"],
        rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["**/references/**"] }] }] }
      },
      {
        files: ["packages/dw-sdlc/src/cli.ts"],
        rules: { "unicorn/no-process-exit": "off" }
      }
    ]
  },
  staged: {
    "*.{ts,js,mjs,cjs}": ["vp lint --no-error-on-unmatched-pattern --fix", "vp fmt --no-error-on-unmatched-pattern"],
    "*.{json,jsonc,md,yaml,yml}": "vp fmt --no-error-on-unmatched-pattern"
  }
})
