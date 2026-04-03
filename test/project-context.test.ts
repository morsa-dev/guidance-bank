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
