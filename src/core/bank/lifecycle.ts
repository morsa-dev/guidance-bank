import type { ProjectBankManifest, ProjectBankState } from "./types.js";

export type ProjectBankLifecycleStatus =
  | "missing"
  | "creation_declined"
  | "creation_in_progress"
  | "sync_required"
  | "ready";

export const isProjectBankPostponedUntilActive = (
  projectState: ProjectBankState | null,
  now = new Date(),
): boolean => {
  if (!projectState?.postponedUntil) {
    return false;
  }

  return new Date(projectState.postponedUntil).getTime() > now.getTime();
};

export const isProjectBankSyncPostponed = (
  projectState: ProjectBankState | null,
  now = new Date(),
): boolean => isProjectBankPostponedUntilActive(projectState, now);

export const requiresProjectBankSync = (
  projectState: ProjectBankState | null,
  expectedStorageVersion: number,
): boolean => projectState?.lastSyncedStorageVersion !== expectedStorageVersion;

export const getProjectBankContinuationIteration = (projectState: ProjectBankState | null): number =>
  (projectState?.createIteration ?? 0) + 1;

export const resolveProjectBankLifecycleStatus = ({
  projectManifest,
  projectState,
  expectedStorageVersion,
  now = new Date(),
}: {
  projectManifest: ProjectBankManifest | null;
  projectState: ProjectBankState | null;
  expectedStorageVersion: number;
  now?: Date;
}): ProjectBankLifecycleStatus => {
  if (projectState?.creationState === "declined") {
    return "creation_declined";
  }

  if (projectManifest === null) {
    return "missing";
  }

  if (projectState?.creationState === "creating") {
    return "creation_in_progress";
  }

  if (requiresProjectBankSync(projectState, expectedStorageVersion) && !isProjectBankPostponedUntilActive(projectState, now)) {
    return "sync_required";
  }

  return "ready";
};
