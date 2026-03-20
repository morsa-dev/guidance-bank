import { InitService } from "../../core/init/initService.js";
import { promptForProviders } from "../prompts/initPrompts.js";

export const runInitCommand = async (): Promise<void> => {
  const selectedProviders = await promptForProviders();
  const initService = new InitService();
  const result = await initService.run({
    selectedProviders,
  });

  console.info(`${result.alreadyExisted ? "Updated" : "Initialized"} Memory Bank at ${result.bankRoot}`);
  console.info(`Enabled providers: ${result.manifest.enabledProviders.join(", ")}`);
  console.info(`MCP runtime config: ${result.mcpServerConfig.command} ${result.mcpServerConfig.args.join(" ")}`);

  for (const integration of result.integrations) {
    const verb =
      integration.action === "skipped"
        ? "Skipped existing global integration for"
        : integration.action === "reconfigured"
          ? "Reconfigured global integration for"
          : "Configured global integration for";
    console.info(`${verb}: ${integration.descriptor.provider}`);
  }
};
