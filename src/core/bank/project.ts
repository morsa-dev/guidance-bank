import { z } from "zod";

import {
  PROJECT_CREATION_STATES,
  type ProjectBankManifest,
  type ProjectBankState,
  type ProjectCreationState,
} from "./types.js";
import { DETECTABLE_STACKS, type DetectableStack } from "../context/types.js";
import { GUIDANCE_SOURCE_STRATEGIES, type ConfirmedGuidanceSourceStrategy } from "../projects/create-flow/guidanceStrategies.js";
import { SOURCE_REVIEW_BUCKETS } from "../projects/create-flow/sourceReviewBuckets.js";

const ProjectCreationStateSchema = z.enum(PROJECT_CREATION_STATES);
const DetectableStackSchema = z.enum(DETECTABLE_STACKS);
const GuidanceSourceStrategySchema = z.enum(GUIDANCE_SOURCE_STRATEGIES);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ConfirmedGuidanceSourceStrategySchema = z
  .object({
    sourceRef: z.string().trim().min(1),
    strategy: GuidanceSourceStrategySchema,
    note: z.string().trim().min(1).nullable(),
    fingerprint: z.string().trim().min(1).optional(),
    reviewBucket: z.enum(SOURCE_REVIEW_BUCKETS).optional(),
  })
  .strict();

export const DEFAULT_PROJECT_BANK_POSTPONE_DAYS = 1;

export const computeProjectBankPostponedUntil = (now: Date, postponeDays = DEFAULT_PROJECT_BANK_POSTPONE_DAYS): string =>
  new Date(now.getTime() + postponeDays * MS_PER_DAY).toISOString();

export const ProjectBankManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    projectPath: z.string().min(1),
    detectedStacks: z.array(DetectableStackSchema).default([]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const ProjectBankStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    creationState: ProjectCreationStateSchema,
    createIteration: z.number().int().nonnegative().nullable().default(null),
    sourceStrategies: z.array(ConfirmedGuidanceSourceStrategySchema).default([]),
    postponedUntil: z.iso.datetime().nullable(),
    lastSyncedAt: z.iso.datetime().nullable(),
    lastSyncedStorageVersion: z.number().int().positive().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const createProjectBankManifest = (
  projectId: string,
  projectName: string,
  projectPath: string,
  detectedStacks: readonly DetectableStack[],
  now = new Date(),
): ProjectBankManifest => {
  const timestamp = now.toISOString();

  return {
    schemaVersion: 1,
    projectId,
    projectName,
    projectPath,
    detectedStacks: [...detectedStacks],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const createProjectBankState = (
  creationState: ProjectCreationState,
  options?: {
    createIteration?: number | null;
    sourceStrategies?: ConfirmedGuidanceSourceStrategy[];
    postponedUntil?: string | null;
    lastSyncedAt?: string | null;
    lastSyncedStorageVersion?: number | null;
  },
  now = new Date(),
): ProjectBankState => ({
  schemaVersion: 1,
  creationState,
  createIteration: options?.createIteration ?? null,
  sourceStrategies: options?.sourceStrategies ?? [],
  postponedUntil:
    creationState === "postponed"
      ? (options?.postponedUntil ?? computeProjectBankPostponedUntil(now))
      : (options?.postponedUntil ?? null),
  lastSyncedAt: options?.lastSyncedAt ?? null,
  lastSyncedStorageVersion: options?.lastSyncedStorageVersion ?? null,
  updatedAt: now.toISOString(),
});

export const updateProjectBankState = (
  state: ProjectBankState,
  creationState: ProjectCreationState,
  options?: {
    postponedUntil?: string | null;
  },
  now = new Date(),
): ProjectBankState => ({
  ...state,
  creationState,
  postponedUntil:
    creationState === "postponed"
      ? (options?.postponedUntil ?? computeProjectBankPostponedUntil(now))
      : null,
  updatedAt: now.toISOString(),
});

export const setProjectBankCreateIteration = (
  state: ProjectBankState,
  createIteration: number | null,
  now = new Date(),
): ProjectBankState => ({
  ...state,
  createIteration,
  updatedAt: now.toISOString(),
});

export const setProjectBankSourceStrategies = (
  state: ProjectBankState,
  sourceStrategies: ConfirmedGuidanceSourceStrategy[],
  now = new Date(),
): ProjectBankState => ({
  ...state,
  sourceStrategies,
  updatedAt: now.toISOString(),
});

export const markProjectBankSynced = (
  state: ProjectBankState,
  storageVersion: number,
  now = new Date(),
): ProjectBankState => ({
  ...state,
  postponedUntil: null,
  lastSyncedAt: now.toISOString(),
  lastSyncedStorageVersion: storageVersion,
  updatedAt: now.toISOString(),
});

export const postponeProjectBankSync = (
  state: ProjectBankState,
  postponeDays: number,
  now = new Date(),
): ProjectBankState => {
  const postponedUntil = new Date(now);
  postponedUntil.setDate(postponedUntil.getDate() + postponeDays);

  return {
    ...state,
    postponedUntil: postponedUntil.toISOString(),
    updatedAt: now.toISOString(),
  };
};

export const updateProjectBankManifest = (
  manifest: ProjectBankManifest,
  detectedStacks: readonly DetectableStack[],
  now = new Date(),
): ProjectBankManifest => ({
  ...manifest,
  detectedStacks: [...detectedStacks],
  updatedAt: now.toISOString(),
});

export const parseProjectBankManifest = (value: unknown): ProjectBankManifest => ProjectBankManifestSchema.parse(value);
export const parseProjectBankState = (value: unknown): ProjectBankState => ProjectBankStateSchema.parse(value);
