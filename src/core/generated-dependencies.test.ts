import type { ProjectShapeInput } from "./generated-project-contract.ts";
import { expect, test } from "bun:test";
import { GENERATED_DEPENDENCY_PACKAGES } from "./generated-dependencies.generated.ts";
import { resolveGeneratedDependencySections } from "./generated-dependencies.ts";
import { resolveProjectShape } from "./generated-project-contract.ts";

function shape(overrides: Partial<ProjectShapeInput> = {}) {
  return resolveProjectShape({
    backend: true,
    frontend: "none",
    ai: false,
    effect: false,
    ...overrides,
  });
}

test("resolves unconditional root tooling without optional project-shape dependencies", () => {
  const sections = resolveGeneratedDependencySections(shape());

  expect(sections.rootDependencies).toEqual({});
  expect(sections.rootDevDependencies["@commitlint/cli"]).toBe(
    GENERATED_DEPENDENCY_PACKAGES["@commitlint/cli"].version,
  );
  expect(sections.rootDevDependencies["@effect/language-service"]).toBeUndefined();
  expect(sections.frontendDependencies).toEqual({});
  expect(sections.frontendDevDependencies).toEqual({});
});

test("resolves Effect dependencies only for Effect project shapes", () => {
  const sections = resolveGeneratedDependencySections(shape({ effect: true }));

  expect(sections.rootDependencies).toEqual({
    "@effect/platform": GENERATED_DEPENDENCY_PACKAGES["@effect/platform"].version,
    "@effect/platform-bun": GENERATED_DEPENDENCY_PACKAGES["@effect/platform-bun"].version,
    effect: GENERATED_DEPENDENCY_PACKAGES.effect.version,
  });
  expect(sections.rootDevDependencies["@effect/language-service"]).toBe(
    GENERATED_DEPENDENCY_PACKAGES["@effect/language-service"].version,
  );
});

test("resolves TanStack frontend sections and shared frontend tooling", () => {
  const sections = resolveGeneratedDependencySections(shape({ frontend: "tanstack" }));

  expect(sections.frontendDependencies).toEqual({
    "@tanstack/react-router": GENERATED_DEPENDENCY_PACKAGES["@tanstack/react-router"].version,
    react: GENERATED_DEPENDENCY_PACKAGES.react.version,
    "react-dom": GENERATED_DEPENDENCY_PACKAGES["react-dom"].version,
  });
  expect(sections.rootDevDependencies["oxlint"]).toBe(GENERATED_DEPENDENCY_PACKAGES.oxlint.version);
  expect(sections.frontendDevDependencies["oxlint"]).toBe(
    GENERATED_DEPENDENCY_PACKAGES.oxlint.version,
  );
  expect(sections.frontendDevDependencies["typescript"]).toBe(
    GENERATED_DEPENDENCY_PACKAGES.typescript.version,
  );
});
