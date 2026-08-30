import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "drizzle/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: "readonly", console: "readonly", __dirname: "readonly" },
    },
    rules: {
      // NestJS controllers and DTOs rely on decorators and definite assignment.
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
