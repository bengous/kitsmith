import type {
  DependencyTarget,
  GeneratedDependencyConditions,
  GeneratedDependencyEmission,
} from "./generated-dependencies.generated.ts";
import { GENERATED_DEPENDENCY_EMISSIONS_BY_TARGET } from "./generated-dependencies.generated.ts";

export type GeneratedDependencySections = {
  readonly rootDependencies: Readonly<Record<string, string>>;
  readonly rootDevDependencies: Readonly<Record<string, string>>;
  readonly frontendDependencies: Readonly<Record<string, string>>;
  readonly frontendDevDependencies: Readonly<Record<string, string>>;
};

type GeneratedDependencyShape = {
  readonly backend: boolean;
  readonly frontend: NonNullable<GeneratedDependencyConditions["frontend"]> | "none";
  readonly ai: boolean;
  readonly effect: boolean;
};

function conditionMatches(
  conditions: GeneratedDependencyConditions | undefined,
  shape: GeneratedDependencyShape,
): boolean {
  if (conditions === undefined) {
    return true;
  }

  return (
    (conditions.backend === undefined || conditions.backend === shape.backend) &&
    (conditions.frontend === undefined || conditions.frontend === shape.frontend) &&
    (conditions.ai === undefined || conditions.ai === shape.ai) &&
    (conditions.effect === undefined || conditions.effect === shape.effect)
  );
}

function resolveTarget(
  target: DependencyTarget,
  shape: GeneratedDependencyShape,
): Readonly<Record<string, string>> {
  const dependencies: Record<string, string> = {};
  const emissions: readonly GeneratedDependencyEmission[] =
    GENERATED_DEPENDENCY_EMISSIONS_BY_TARGET[target];
  for (const emission of emissions) {
    if (conditionMatches(emission.conditions, shape)) {
      dependencies[emission.packageName] = emission.version;
    }
  }
  return dependencies;
}

export function resolveGeneratedDependencySections(
  shape: GeneratedDependencyShape,
): GeneratedDependencySections {
  return {
    rootDependencies: resolveTarget("root.dependencies", shape),
    rootDevDependencies: resolveTarget("root.devDependencies", shape),
    frontendDependencies: resolveTarget("frontend.dependencies", shape),
    frontendDevDependencies: resolveTarget("frontend.devDependencies", shape),
  };
}
