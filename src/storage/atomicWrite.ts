import { promises as fs } from "node:fs";
import path from "node:path";

export const atomicWriteFile = async (filePath: string, content: string): Promise<void> => {
  const directoryPath = path.dirname(filePath);
  const temporaryFilePath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );

  const handle = await fs.open(temporaryFilePath, "wx", 0o600);

  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  await fs.rename(temporaryFilePath, filePath);
};
