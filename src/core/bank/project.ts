import { z } from "zod";

import {
  PROJECT_CREATION_STATES,
  type ProjectBankManifest,
  type ProjectBankState,
  type ProjectCreationState,
} from "./types.js";

const ProjectCreationStateSchema = z.enum(PROJECT_CREATION_STATES);

export const ProjectBankManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    projectPath: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const ProjectBankStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    creationState: ProjectCreationStateSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();

export const createProjectBankManifest = (
  projectId: string,
  projectName: string,
  projectPath: string,
  now = new Date(),
): ProjectBankManifest => {
  const timestamp = now.toISOString();

  return {
    schemaVersion: 1,
    projectId,
    projectName,
    projectPath,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const createProjectBankState = (
  creationState: ProjectCreationState,
  now = new Date(),
): ProjectBankState => ({
  schemaVersion: 1,
  creationState,
  updatedAt: now.toISOString(),
});

export const updateProjectBankState = (
  state: ProjectBankState,
  creationState: ProjectCreationState,
  now = new Date(),
): ProjectBankState => ({
  ...state,
  creationState,
  updatedAt: now.toISOString(),
});

export const parseProjectBankManifest = (value: unknown): ProjectBankManifest => ProjectBankManifestSchema.parse(value);
export const parseProjectBankState = (value: unknown): ProjectBankState => ProjectBankStateSchema.parse(value);
