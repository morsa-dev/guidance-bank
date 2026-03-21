import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RecentProjectCommit = {
  shortHash: string;
  subject: string;
};

export const discoverRecentCommits = async (projectPath: string): Promise<RecentProjectCommit[]> => {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", projectPath, "log", "-n", "5", "--pretty=format:%h%x09%s"],
      {
        cwd: projectPath,
      },
    );

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): RecentProjectCommit | null => {
        const [shortHash, ...subjectParts] = line.split("\t");
        if (!shortHash) {
          return null;
        }

        return {
          shortHash,
          subject: subjectParts.join("\t"),
        };
      })
      .filter((commit): commit is RecentProjectCommit => commit !== null && commit.subject.length > 0);
  } catch {
    return [];
  }
};
