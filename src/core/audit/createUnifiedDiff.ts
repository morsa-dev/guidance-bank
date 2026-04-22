const splitLines = (content: string | null): string[] => {
  if (content === null || content.length === 0) {
    return [];
  }

  return content.split(/\r?\n/u);
};

type DiffOperation =
  | { type: "equal"; line: string }
  | { type: "delete"; line: string }
  | { type: "insert"; line: string };

const buildLineOperations = (beforeLines: readonly string[], afterLines: readonly string[]): DiffOperation[] => {
  const table = Array.from({ length: beforeLines.length + 1 }, () => Array<number>(afterLines.length + 1).fill(0));

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      table[beforeIndex]![afterIndex] =
        beforeLines[beforeIndex] === afterLines[afterIndex]
          ? table[beforeIndex + 1]![afterIndex + 1]! + 1
          : Math.max(table[beforeIndex + 1]![afterIndex]!, table[beforeIndex]![afterIndex + 1]!);
    }
  }

  const operations: DiffOperation[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      operations.push({ type: "equal", line: beforeLines[beforeIndex]! });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (table[beforeIndex + 1]![afterIndex]! >= table[beforeIndex]![afterIndex + 1]!) {
      operations.push({ type: "delete", line: beforeLines[beforeIndex]! });
      beforeIndex += 1;
      continue;
    }

    operations.push({ type: "insert", line: afterLines[afterIndex]! });
    afterIndex += 1;
  }

  while (beforeIndex < beforeLines.length) {
    operations.push({ type: "delete", line: beforeLines[beforeIndex]! });
    beforeIndex += 1;
  }

  while (afterIndex < afterLines.length) {
    operations.push({ type: "insert", line: afterLines[afterIndex]! });
    afterIndex += 1;
  }

  return operations;
};

const formatRange = (lineCount: number): string => (lineCount === 0 ? "0,0" : `1,${lineCount}`);

export const createUnifiedDiff = ({
  path,
  beforeContent,
  afterContent,
}: {
  path: string;
  beforeContent: string | null;
  afterContent: string | null;
}): string => {
  const beforeLines = splitLines(beforeContent);
  const afterLines = splitLines(afterContent);

  if (beforeContent === afterContent) {
    return `--- a/${path}\n+++ b/${path}\n`;
  }

  const operations = buildLineOperations(beforeLines, afterLines);
  const body = operations
    .map((operation) => {
      switch (operation.type) {
        case "delete":
          return `-${operation.line}`;
        case "insert":
          return `+${operation.line}`;
        case "equal":
          return ` ${operation.line}`;
      }
    })
    .join("\n");

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${formatRange(beforeLines.length)} +${formatRange(afterLines.length)} @@`,
    body,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
};
