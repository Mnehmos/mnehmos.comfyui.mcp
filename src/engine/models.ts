/**
 * Model inventory by direct disk scan (ground truth, independent of the
 * server's combo cache).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ModelEntry {
  folder: string;
  filename: string;
  size_bytes: number;
}

const WEIGHT_EXT = new Set(['.safetensors', '.pt', '.pth', '.ckpt', '.bin', '.gguf', '.sft', '.onnx']);

export function listModels(modelsDir: string, folder?: string): ModelEntry[] {
  const out: ModelEntry[] = [];
  if (!fs.existsSync(modelsDir)) return out;
  const dirs = folder ? [folder] : fs.readdirSync(modelsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);
  for (const d of dirs) {
    const dirPath = path.join(modelsDir, d);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    walk(dirPath, d, out);
  }
  out.sort((a, b) => (a.folder + a.filename).localeCompare(b.folder + b.filename));
  return out;
}

function walk(dir: string, folder: string, out: ModelEntry[], depth = 0): void {
  if (depth > 3) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory() && !ent.name.startsWith('.')) {
      walk(full, folder, out, depth + 1);
    } else if (ent.isFile() && WEIGHT_EXT.has(path.extname(ent.name).toLowerCase())) {
      out.push({ folder, filename: ent.name, size_bytes: fs.statSync(full).size });
    }
  }
}
