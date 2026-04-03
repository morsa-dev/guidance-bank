import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { detectProjectContext } from "../src/core/context/detectProjectContext.js";
import { writeProjectFiles } from "./helpers/mcpTestUtils.js";
import { createInitializedBank } from "./helpers/mcpTestUtils.js";

test("detectProjectContext detects ios projects from common native project files", async () => {
  const { tempDirectoryPath } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "ios-app");

  await writeProjectFiles(projectRoot, {
    "Package.swift": "// swift package\n",
    "App.xcodeproj/project.pbxproj": "// xcode project\n",
  });

  const context = await detectProjectContext(projectRoot);

  assert.deepEqual(context.detectedStacks, ["ios"]);
  assert.deepEqual(
    context.detectedSignals.map((signal) => signal.name),
    ["ios"],
  );
});

test("detectProjectContext falls back to other when no specific stack signals are found", async () => {
  const { tempDirectoryPath } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "misc-project");

  await writeProjectFiles(projectRoot, {
    "README.md": "# Misc Project\n",
  });

  const context = await detectProjectContext(projectRoot);

  assert.deepEqual(context.detectedStacks, ["other"]);
  assert.deepEqual(
    context.detectedSignals.map((signal) => ({ name: signal.name, source: signal.source })),
    [{ name: "other", source: "fallback" }],
  );
});
