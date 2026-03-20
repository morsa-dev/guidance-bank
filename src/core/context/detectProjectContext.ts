import path from "node:path";
import { promises as fs } from "node:fs";

import { type DetectableStack, type DetectedSignal, type ProjectContext } from "./types.js";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const stackOrder = new Map<DetectableStack, number>(
  ["nodejs", "typescript", "react", "nextjs", "angular"].map((stack, index) => [stack as DetectableStack, index]),
);

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const readJsonFileIfExists = async <T>(filePath: string): Promise<T | null> => {
  if (!(await pathExists(filePath))) {
    return null;
  }

  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as T;
};

const addStack = (stacks: Set<DetectableStack>, signals: DetectedSignal[], stack: DetectableStack, source: string): void => {
  if (stacks.has(stack)) {
    return;
  }

  stacks.add(stack);
  signals.push({
    name: stack,
    source,
  });
};

export const detectProjectContext = async (cwd: string): Promise<ProjectContext> => {
  const resolvedCwd = path.resolve(cwd);
  const stacks = new Set<DetectableStack>();
  const signals: DetectedSignal[] = [];

  const packageJson = await readJsonFileIfExists<PackageJson>(path.join(resolvedCwd, "package.json"));
  const tsconfigExists = await pathExists(path.join(resolvedCwd, "tsconfig.json"));
  const angularConfigExists = await pathExists(path.join(resolvedCwd, "angular.json"));
  const nextConfigExists =
    (await pathExists(path.join(resolvedCwd, "next.config.js"))) ||
    (await pathExists(path.join(resolvedCwd, "next.config.mjs"))) ||
    (await pathExists(path.join(resolvedCwd, "next.config.ts")));

  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };

  if (packageJson) {
    addStack(stacks, signals, "nodejs", "package.json");
  }

  if (tsconfigExists || "typescript" in dependencies) {
    addStack(stacks, signals, "typescript", tsconfigExists ? "tsconfig.json" : "package.json");
  }

  if (angularConfigExists || "@angular/core" in dependencies) {
    addStack(stacks, signals, "angular", angularConfigExists ? "angular.json" : "package.json");
    addStack(stacks, signals, "typescript", angularConfigExists ? "angular.json" : "package.json");
    addStack(stacks, signals, "nodejs", angularConfigExists ? "angular.json" : "package.json");
  }

  if (nextConfigExists || "next" in dependencies) {
    addStack(stacks, signals, "nextjs", nextConfigExists ? "next.config.*" : "package.json");
    addStack(stacks, signals, "react", nextConfigExists ? "next.config.*" : "package.json");
    addStack(stacks, signals, "nodejs", nextConfigExists ? "next.config.*" : "package.json");
  }

  if ("react" in dependencies) {
    addStack(stacks, signals, "react", "package.json");
    addStack(stacks, signals, "nodejs", "package.json");
  }

  const detectedStacks = [...stacks].sort((left, right) => (stackOrder.get(left) ?? 0) - (stackOrder.get(right) ?? 0));

  return {
    cwd: resolvedCwd,
    projectName: path.basename(resolvedCwd),
    detectedStacks,
    detectedSignals: signals,
  };
};
