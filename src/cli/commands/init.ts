import { InitService } from "../../core/init/initService.js";
import { promptForProviders } from "../prompts/initPrompts.js";

export const runInitCommand = async (): Promise<void> => {
  const selectedProviders = await promptForProviders();
  const initService = new InitService();
  const result = await initService.run({
    selectedProviders,
  });

  const configuredProviders = result.integrations
    .filter((integration) => integration.action === "installed" || integration.action === "reconfigured")
    .map((integration) => integration.descriptor.displayName);
  const reusedProviders = result.integrations
    .filter((integration) => integration.action === "skipped")
    .map((integration) => integration.descriptor.displayName);

  console.info(
    result.alreadyExisted
      ? `AI Guidance Bank is ready at ${result.bankRoot}.`
      : `AI Guidance Bank initialized successfully at ${result.bankRoot}.`,
  );

  if (configuredProviders.length > 0) {
    console.info(`Connected providers: ${configuredProviders.join(", ")}.`);
  }

  if (reusedProviders.length > 0) {
    console.info(`Existing provider connections kept: ${reusedProviders.join(", ")}.`);
  }

  console.info("");
  console.info("Next step:");
  console.info(
    "Open any project in your agent. The agent can use the AI Guidance Bank MCP to load durable rules and skills, detect when a project bank is missing, and guide you through creating or updating it.",
  );
};
