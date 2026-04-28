import { StopService } from "../../core/stop/stopService.js";

export const runStopCommand = async (): Promise<void> => {
  const stopService = new StopService();
  const result = await stopService.run();

  const removedProviders = result.stoppedProviders
    .filter((integration) => integration.action === "removed")
    .map((integration) => integration.displayName);
  const alreadyAbsentProviders = result.stoppedProviders
    .filter((integration) => integration.action === "already_absent")
    .map((integration) => integration.displayName);

  console.info(`AI Guidance Bank integrations stopped for ${result.bankRoot}.`);

  if (removedProviders.length > 0) {
    console.info(`Disconnected providers: ${removedProviders.join(", ")}.`);
  }

  if (alreadyAbsentProviders.length > 0) {
    console.info(`Already disconnected: ${alreadyAbsentProviders.join(", ")}.`);
  }

  if (result.enabledProviders.length === 0) {
    console.info("No providers are recorded in this bank yet.");
  }

  console.info("");
  console.info("The bank content was kept intact. Run `gbank init` to connect providers again.");
};
