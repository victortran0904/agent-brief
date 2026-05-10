import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

const MAX_DEPTH = 3;
const MAX_FILE_BYTES = 200_000;
const BINARY_SAMPLE_BYTES = 512;
const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".doc", ".json", ".yaml", ".yml", ".toml"]);

export type WorkspaceScanFile = {
  path: string;
  sourceLabel: string;
  extension: string;
  sizeBytes: number;
  content: string;
  truncated: boolean;
};

export type WorkspaceScanResult = {
  rootPath: string;
  maxDepth: number;
  files: WorkspaceScanFile[];
};

export async function scanWorkspace(rootPath: string): Promise<WorkspaceScanResult> {
  const files: WorkspaceScanFile[] = [];
  const root = path.resolve(rootPath);

  await scanDirectory(root, root, 0, files);

  return {
    rootPath: root,
    maxDepth: MAX_DEPTH,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

async function scanDirectory(root: string, directory: string, depth: number, files: WorkspaceScanFile[]) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryDepth = depth + 1;

    if (entry.isDirectory()) {
      if (entryDepth > MAX_DEPTH || SKIPPED_DIRS.has(entry.name)) {
        continue;
      }

      await scanDirectory(root, path.join(directory, entry.name), entryDepth, files);
      continue;
    }

    if (!entry.isFile() || entryDepth > MAX_DEPTH || !isSupportedFile(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const fileStat = await stat(absolutePath);
    const buffer = await readPreviewBuffer(absolutePath, fileStat.size);

    if (isBinary(buffer)) {
      continue;
    }

    const relativePath = path.relative(root, absolutePath);
    const truncated = fileStat.size > MAX_FILE_BYTES;
    const content = buffer.subarray(0, MAX_FILE_BYTES).toString("utf8");

    files.push({
      path: relativePath,
      sourceLabel: relativePath,
      extension: path.extname(entry.name) || entry.name,
      sizeBytes: fileStat.size,
      content,
      truncated,
    });
  }
}

async function readPreviewBuffer(filePath: string, size: number) {
  const bytesToRead = Math.min(size, MAX_FILE_BYTES + BINARY_SAMPLE_BYTES);
  const buffer = Buffer.alloc(bytesToRead);
  const file = await open(filePath, "r");

  try {
    const { bytesRead } = await file.read(buffer, 0, bytesToRead, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

function isSupportedFile(fileName: string) {
  if (fileName === ".env.example") {
    return true;
  }

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return false;
  }

  return SUPPORTED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  return sample.includes(0);
}
