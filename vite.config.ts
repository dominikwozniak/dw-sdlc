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
    // The plugin's link to the package: no tsconfig includes a path through it, so the type check would
    // read those files without the repo's compiler options. The package is linted at its own path.
    ignorePatterns: ["node_modules/**", "references/*/**", "plugins/sdlc/dw-sdlc"],
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
    }
  },
  staged: {
    "*.{ts,js,mjs,cjs}": ["vp lint --no-error-on-unmatched-pattern --fix", "vp fmt --no-error-on-unmatched-pattern"],
    "*.{json,jsonc,md,yaml,yml}": "vp fmt --no-error-on-unmatched-pattern"
  }
})
