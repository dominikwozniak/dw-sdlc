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
      // The type check needs `typeAware`, which also turns on the type-aware rules of the categories
      // above; `rules` switches each of them off.
      typeAware: true,
      typeCheck: true
    },
    rules: {
      curly: ["error", "all"],
      "typescript/await-thenable": "off",
      "typescript/consistent-return": "off",
      "typescript/no-array-delete": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-duplicate-type-constituents": "off",
      "typescript/no-floating-promises": "off",
      "typescript/no-for-in-array": "off",
      "typescript/no-generated-empty-object-type": "off",
      "typescript/no-implied-eval": "off",
      "typescript/no-meaningless-void-operator": "off",
      "typescript/no-misused-spread": "off",
      "typescript/no-redundant-type-constituents": "off",
      "typescript/no-unnecessary-boolean-literal-compare": "off",
      "typescript/no-unnecessary-template-expression": "off",
      "typescript/no-unnecessary-type-arguments": "off",
      "typescript/no-unnecessary-type-assertion": "off",
      "typescript/no-unnecessary-type-conversion": "off",
      "typescript/no-unnecessary-type-parameters": "off",
      "typescript/no-unsafe-enum-comparison": "off",
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/no-unsafe-unary-minus": "off",
      "typescript/no-useless-default-assignment": "off",
      "typescript/require-array-sort-compare": "off",
      "typescript/restrict-template-expressions": "off",
      "typescript/unbound-method": "off"
    }
  }
})
