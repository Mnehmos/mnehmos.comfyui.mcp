/**
 * Server-owned randomness (vibe-coders-bible: the model never supplies
 * random values; a deterministic component owns, seeds, and logs them).
 *
 * One master seed per run (crypto-random unless replaying). Per-node sampler
 * seeds derive deterministically from (masterSeed, nodeId) so a run can be
 * reproduced exactly from the recorded provenance.
 */
import { randomInt, createHash } from 'node:crypto';

export const SEED_INPUT_NAMES = ['seed', 'noise_seed'] as const;

export function generateMasterSeed(): number {
  // ComfyUI seeds are int32 (up to 2^31 - 1 in most samplers).
  return randomInt(0, 2 ** 31 - 1);
}

/** Deterministic 32-bit PRNG (mulberry32) seeded from a string. */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deriveSeed(masterSeed: number, nodeId: string): number {
  const h = createHash('sha256').update(`${masterSeed}:${nodeId}`).digest();
  const a = h.readUInt32LE(0);
  const rand = mulberry32(a);
  return Math.floor(rand() * (2 ** 31 - 1));
}

export interface SeedAssignment {
  node_id: string;
  input_name: string;
  seed: number;
}

/**
 * Walk an API-format workflow and overwrite sampler seeds with derived ones.
 * Node ids that reference a seed input but are missing it are still assigned
 * (ComfyUI tolerates explicit seeds on samplers).
 */
export function injectSeeds(
  workflow: Record<string, unknown>,
  masterSeed: number,
): SeedAssignment[] {
  const assignments: SeedAssignment[] = [];
  for (const [nodeId, raw] of Object.entries(workflow)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const node = raw as Record<string, unknown>;
    if (typeof node.class_type !== 'string') continue;
    const inputs = (node.inputs ?? {}) as Record<string, unknown>;

    // Nodes that already carry a seed input: overwrite exactly that input.
    let handled = false;
    for (const inputName of SEED_INPUT_NAMES) {
      if (inputName in inputs) {
        const seed = deriveSeed(masterSeed, `${nodeId}:${inputName}`);
        inputs[inputName] = seed;
        assignments.push({ node_id: nodeId, input_name: inputName, seed });
        handled = true;
      }
    }
    if (handled) {
      node.inputs = inputs;
      continue;
    }

    // Sampler node with no seed input yet (hand-written workflow): give it
    // its conventional seed input based on the node family.
    if (isSamplerNode(node.class_type)) {
      const inputName = node.class_type.toLowerCase().includes('advanced') ? 'noise_seed' : 'seed';
      const seed = deriveSeed(masterSeed, `${nodeId}:${inputName}`);
      inputs[inputName] = seed;
      assignments.push({ node_id: nodeId, input_name: inputName, seed });
      node.inputs = inputs;
    }
  }
  return assignments;
}

function isSamplerNode(classType: string): boolean {
  const lower = classType.toLowerCase();
  return lower.includes('sampler') || lower.endsWith('sde');
}
