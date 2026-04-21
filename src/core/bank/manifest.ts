import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  CURRENT_STORAGE_VERSION,
  PROVIDER_IDS,
  type MemoryBankManifest,
  type ProviderId,
  type StorageVersion,
} from "./types.js";

const ProviderIdSchema = z.enum(PROVIDER_IDS);
const StorageVersionSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const MemoryBankManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    storageVersion: StorageVersionSchema,
    bankId: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    enabledProviders: z.array(ProviderIdSchema),
    defaultMcpTransport: z.literal("stdio"),
  })
  .strict();

const providerOrder = new Map<ProviderId, number>(PROVIDER_IDS.map((providerId, index) => [providerId, index]));

export const sortProviders = (providerIds: readonly ProviderId[]): ProviderId[] =>
  [...new Set(providerIds)].sort((left, right) => (providerOrder.get(left) ?? 0) - (providerOrder.get(right) ?? 0));

export const createManifest = (enabledProviders: readonly ProviderId[], now = new Date()): MemoryBankManifest => {
  const timestamp = now.toISOString();

  return {
    schemaVersion: 1,
    storageVersion: CURRENT_STORAGE_VERSION,
    bankId: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    enabledProviders: sortProviders(enabledProviders),
    defaultMcpTransport: "stdio",
  };
};

export const updateManifest = (
  manifest: MemoryBankManifest,
  enabledProviders: readonly ProviderId[],
  now = new Date(),
  options?: { storageVersion?: StorageVersion },
): MemoryBankManifest => ({
  ...manifest,
  ...(options?.storageVersion ? { storageVersion: options.storageVersion } : {}),
  updatedAt: now.toISOString(),
  enabledProviders: sortProviders(enabledProviders),
});

export const parseManifest = (value: unknown): MemoryBankManifest => MemoryBankManifestSchema.parse(value);

export const isCurrentStorageVersion = (storageVersion: StorageVersion): boolean => storageVersion === CURRENT_STORAGE_VERSION;
