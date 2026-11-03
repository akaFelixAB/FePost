import type { Config } from "prettier";

const config: Config = {
  printWidth: 100,         // Maximum line length before wrapping
  tabWidth: 4,             // Tab width in spaces
  useTabs: false,          // Whether to use tabs for indentation
  semi: true,              // Whether to add semicolons at the end of statements
  singleQuote: true,       // Whether to use single quotes
  trailingComma: "es5",    // Trailing comma setting for objects (es5, all, none)
  bracketSpacing: true,    // Whether to add spaces between brackets in object literals
  arrowParens: "always",   // Arrow functions with a single parameter
};

export default config;
