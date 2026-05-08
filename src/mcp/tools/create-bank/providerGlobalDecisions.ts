import type { ResolvedCreateBankFlowContext } from "../../../core/projects/create-flow/createBankFlow.js";
import type { McpServerRuntimeOptions } from "../../registerTools.js";
import type { ResolvedProviderSession } from "../../providerSessionResolver.js";
import type { CreateBankArgs } from "./schemas.js";

export const shouldPersistProviderGlobalDecisions = ({
  args,
  flowContext,
}: {
  args: CreateBankArgs;
  flowContext: ResolvedCreateBankFlowContext;
}): boolean => args.sourceReviewDecision === "keep_external" && flowContext.resolvedReviewBucket === "provider-global";

export const persistProviderGlobalGuidanceDecisions = async ({
  options,
  providerSession,
}: {
  options: McpServerRuntimeOptions;
  providerSession: ResolvedProviderSession;
}): Promise<void> => {
  const state = await options.repository.readExternalGuidanceDecisionState();
  const decidedAt = new Date().toISOString();

  state.updatedAt = decidedAt;
  state.providerGlobal = {
    keepExternal: true,
    decidedAt,
    providerSessionId: providerSession.providerSessionId,
    providerSessionSource: providerSession.providerSessionSource,
    note: "User chose to keep provider-global guidance outside AI Guidance Bank.",
  };

  await options.repository.writeExternalGuidanceDecisionState(state);
};
