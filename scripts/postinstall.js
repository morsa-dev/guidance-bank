const run = async () => {
  try {
    const { runPostinstall } = await import("../dist/cli/postinstall.js");
    await runPostinstall();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes("Cannot find module") ||
      message.includes("ERR_MODULE_NOT_FOUND") ||
      message.includes("dist/cli/postinstall.js")
    ) {
      return;
    }

    console.warn(`[AI Guidance Bank] postinstall launcher refresh skipped: ${message}`);
  }
};

await run();
