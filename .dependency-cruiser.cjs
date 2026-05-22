const recommended = require("./node_modules/dependency-cruiser/configs/recommended-strict.cjs");

const NON_TEST_TS = "\\.(test|e2e\\.test)\\.ts$";
const PRODUCTION_TOOLING_TS =
  "^(src/(?!testing/)|scripts/(?!testing/)|\\.agents/hooks/|\\.codex/hooks/|\\.claude/hooks/).+\\.ts$";
const NATIVE_HOOK_WRAPPER_TS = "^\\.(codex|claude)/hooks/[^/]+\\.ts$";
const NATIVE_HOOK_WRAPPER_ALLOWED_IMPORT = "^\\.agents/hooks/(adapters|runtime)/";
const ORPHAN_EXCEPTIONS = [
  "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$",
  "^src/index\\.ts$",
  "^scripts/",
  "^\\.codex/hooks/(guard-destructive|guard-edit-paths|post-edit-quality|stop-validate)\\.ts$",
  "^\\.claude/hooks/guard-destructive\\.ts$",
].join("|");

module.exports = {
  forbidden: recommended.forbidden
    .map((rule) => {
      if (rule.name === "not-to-unresolvable") {
        return {
          ...rule,
          to: {
            ...rule.to,
            pathNot: "^(bun|react/jsx-runtime)$",
          },
        };
      }
      if (rule.name === "no-orphans") {
        return {
          ...rule,
          from: {
            ...rule.from,
            pathNot: ORPHAN_EXCEPTIONS,
          },
        };
      }
      return { ...rule };
    })
    .concat([
      {
        name: "native-hook-wrappers-stay-thin",
        comment:
          "Native hook wrappers must only import shared hook adapters and runtime entrypoints.",
        severity: "error",
        from: {
          path: NATIVE_HOOK_WRAPPER_TS,
        },
        to: {
          pathNot: NATIVE_HOOK_WRAPPER_ALLOWED_IMPORT,
        },
      },
      {
        name: "no-prod-to-testing",
        comment: "Production code must not depend on test helpers.",
        severity: "error",
        from: {
          path: PRODUCTION_TOOLING_TS,
          pathNot: NON_TEST_TS,
        },
        to: {
          path: "^src/testing/",
        },
      },
    ]),
  options: {
    ...recommended.options,
    moduleSystems: ["cjs", "es6"],
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    builtInModules: {
      add: ["bun"],
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types", "bun"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
