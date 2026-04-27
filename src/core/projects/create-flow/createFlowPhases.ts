export const CREATE_FLOW_PHASES = [
  "sync_required",
  "ready_to_improve",
  "kickoff",
  "review_existing_guidance",
  "derive_from_project",
  "finalize",
  "completed",
] as const;

export type CreateFlowPhase = (typeof CREATE_FLOW_PHASES)[number];

export const CREATE_ITERATION_PHASES = [
  "kickoff",
  "review_existing_guidance",
  "derive_from_project",
  "finalize",
  "completed",
] as const satisfies readonly CreateFlowPhase[];

export const CREATE_FLOW_COMPLETED_ITERATION = CREATE_ITERATION_PHASES.length - 1;

const CREATE_FLOW_OUTCOME_REQUIRED_PHASES = [
  "derive_from_project",
  "finalize",
] as const satisfies readonly CreateFlowPhase[];

export const getCreateFlowPhase = (iteration: number): CreateFlowPhase =>
  CREATE_ITERATION_PHASES[Math.min(Math.max(iteration, 0), CREATE_FLOW_COMPLETED_ITERATION)]!;

export const getNextCreateFlowIteration = (iteration: number): number | null =>
  iteration < CREATE_FLOW_COMPLETED_ITERATION ? iteration + 1 : null;

export const isCreateFlowComplete = (iteration: number): boolean => iteration >= CREATE_FLOW_COMPLETED_ITERATION;

export const requiresCreateFlowStepOutcome = (iteration: number): boolean =>
  CREATE_FLOW_OUTCOME_REQUIRED_PHASES.includes(getCreateFlowPhase(iteration) as (typeof CREATE_FLOW_OUTCOME_REQUIRED_PHASES)[number]);
