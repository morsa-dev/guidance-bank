import {
  createExternalGuidanceSourceKey,
  type ExternalGuidanceDecision,
} from "../../../core/bank/externalGuidanceDecisions.js";
import { getCreateFlowPhase } from "../../../core/projects/create-flow/createFlowPhases.js";
import type { ExistingGuidanceSource } from "../../../core/projects/discoverExistingGuidance.js";
import type { ConfirmedGuidanceSourceStrategy, GuidanceSourceStrategy } from "../../../core/projects/create-flow/guidanceStrategies.js";
import type { ResolvedCreateBankFlowContext } from "../../../core/projects/create-flow/createBankFlow.js";
import type { McpServerRuntimeOptions } from "../../registerTools.js";
import type { CreateBankArgs } from "./schemas.js";

const toExternalGuidanceDecision = (strategy: GuidanceSourceStrategy): ExternalGuidanceDecision => {
  switch (strategy) {
    case "copy":
    case "keep_source_fill_gaps":
      return "copy_to_shared_keep_source";
    case "move":
      return "move_to_bank_cleanup_allowed";
    case "keep_provider_native":
      return "keep_provider_native";
    case "ignore":
      return "ignore";
  }
};

export const shouldPersistProviderGlobalDecisions = ({
  args,
  flowContext,
}: {
  args: CreateBankArgs;
  flowContext: ResolvedCreateBankFlowContext;
}): boolean =>
  (args.sourceReviewDecision === "keep_external" && args.sourceReviewBucket === "provider-global") ||
  (getCreateFlowPhase(flowContext.existingState?.createIteration ?? flowContext.effectiveIteration) ===
    "import_selected_guidance" &&
    (args.apply !== undefined || args.stepOutcome !== undefined));

export const persistProviderGlobalGuidanceDecisions = async ({
  options,
  discoveredSources,
  confirmedSourceStrategies,
  sessionRef,
}: {
  options: McpServerRuntimeOptions;
  discoveredSources: readonly ExistingGuidanceSource[];
  confirmedSourceStrategies: readonly ConfirmedGuidanceSourceStrategy[];
  sessionRef: string | null;
}): Promise<void> => {
  const strategiesBySourceRef = new Map(
    confirmedSourceStrategies.map((strategy) => [strategy.sourceRef, strategy]),
  );
  const providerGlobalSources = discoveredSources.filter(
    (source) => source.scope === "provider-global" && source.provider !== null,
  );

  if (providerGlobalSources.length === 0) {
    return;
  }

  const state = await options.repository.readExternalGuidanceDecisionState();
  const decidedAt = new Date().toISOString();

  for (const source of providerGlobalSources) {
    if (source.provider === null) {
      continue;
    }

    const strategy = strategiesBySourceRef.get(source.relativePath);
    if (!strategy) {
      continue;
    }

    const sourceKey = createExternalGuidanceSourceKey({
      scope: "provider-global",
      provider: source.provider,
      relativePath: source.relativePath,
    });

    state.sources[sourceKey] = {
      sourceKey,
      sourceRef: source.relativePath,
      scope: "provider-global",
      provider: source.provider,
      kind: source.kind,
      entryType: source.entryType,
      fingerprint: source.fingerprint,
      decision: toExternalGuidanceDecision(strategy.strategy),
      strategy: strategy.strategy,
      decidedAt,
      sessionRef,
      note: strategy.note,
    };
  }

  state.updatedAt = decidedAt;
  await options.repository.writeExternalGuidanceDecisionState(state);
};
