import { describe, it, expect } from '@jest/globals';
import { generateMasterSeed, deriveSeed, injectSeeds } from '../src/engine/seedService.js';

describe('seed service (server-owned randomness)', () => {
  it('generates master seeds in int32 range', () => {
    for (let i = 0; i < 100; i++) {
      const s = generateMasterSeed();
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 31);
      expect(Number.isInteger(s)).toBe(true);
    }
  });

  it('derives deterministically from (masterSeed, nodeId)', () => {
    expect(deriveSeed(42, '3:seed')).toBe(deriveSeed(42, '3:seed'));
    expect(deriveSeed(42, '3:seed')).not.toBe(deriveSeed(43, '3:seed'));
    expect(deriveSeed(42, '3:seed')).not.toBe(deriveSeed(42, '4:seed'));
  });

  it('overwrites sampler seeds in a workflow', () => {
    const wf = {
      '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 20 } },
      '4': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: 2 } },
      '5': { class_type: 'SaveImage', inputs: { filename_prefix: 'x' } },
    };
    const assignments = injectSeeds(wf, 999);
    expect(assignments).toHaveLength(2);
    expect((wf['3'] as { inputs: { seed: number } }).inputs.seed).not.toBe(1);
    expect((wf['4'] as { inputs: { noise_seed: number } }).inputs.noise_seed).not.toBe(2);
    const replay = injectSeeds(JSON.parse(JSON.stringify(wf)), 999);
    expect(replay.map((a) => a.seed)).toEqual(assignments.map((a) => a.seed));
  });

  it('does not touch non-sampler nodes', () => {
    const wf = { '5': { class_type: 'SaveImage', inputs: { filename_prefix: 'x' } } };
    expect(injectSeeds(wf, 7)).toHaveLength(0);
  });
});
