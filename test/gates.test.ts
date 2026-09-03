import { describe, it, expect } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorkflow } from '../src/engine/gates.js';
import type { ObjectInfo } from '../src/engine/comfyClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const objectInfo: ObjectInfo = {
  LoadImage: { input: { required: { image: ['COMBO', []] } } },
  SaveImage: { input: { required: { images: ['IMAGE', {}] }, optional: { filename_prefix: ['STRING', { default: 'ComfyUI' }] } } },
  KSampler: { input: { required: {
    model: ['MODEL', {}], positive: ['CONDITIONING', {}], negative: ['CONDITIONING', {}],
    latent_image: ['LATENT', {}], seed: ['INT', {}], steps: ['INT', {}], cfg: ['FLOAT', {}],
    sampler_name: ['COMBO', []], scheduler: ['COMBO', []], denoise: ['FLOAT', {}],
  } } },
  UNETLoader: { input: { required: { unet_name: ['COMBO', []], weight_dtype: ['COMBO', []] } } },
};

function ctx(overrides: Partial<{ modelsDir: string; inputDir: string }> = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-gate-'));
  fs.mkdirSync(path.join(tmp, 'models', 'diffusion_models'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'models', 'diffusion_models', 'trellis_2_int8_convrot.safetensors'), 'x');
  fs.mkdirSync(path.join(tmp, 'input'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'input', 'viking_wolf_rune_axe.png'), 'x');
  return {
    objectInfo,
    modelsDir: overrides.modelsDir ?? path.join(tmp, 'models'),
    inputDir: overrides.inputDir ?? path.join(tmp, 'input'),
    tmp,
  };
}

const minimalApi = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'minimal-api-workflow.json'), 'utf-8'),
);

describe('basics gate', () => {
  it('passes a valid API-format workflow', () => {
    const c = ctx();
    const v = validateWorkflow(minimalApi, c);
    expect(v.ok).toBe(true);
    expect(v.format).toBe('api');
    expect(v.node_count).toBe(2);
  });

  it('rejects UI-format workflows with actionable guidance', () => {
    const c = ctx();
    const v = validateWorkflow({ nodes: [], links: [] }, c);
    expect(v.ok).toBe(false);
    expect(v.errors[0].code).toBe('ui_format_not_supported');
    expect(v.errors[0].detail).toContain('Export (API)');
  });

  it('flags unknown node types', () => {
    const c = ctx();
    const v = validateWorkflow({ '1': { class_type: 'NotARealNode', inputs: {} } }, c);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.code === 'unknown_node_type')).toBe(true);
  });

  it('flags missing required inputs', () => {
    const c = ctx();
    const v = validateWorkflow({ '1': { class_type: 'SaveImage', inputs: {} } }, c);
    expect(v.errors.some((e) => e.code === 'missing_required_input' && e.node_id === '1')).toBe(true);
  });

  it('errors when a referenced model file is not on disk', () => {
    const c = ctx();
    const wf = { '1': { class_type: 'UNETLoader', inputs: { unet_name: 'ghost.safetensors', weight_dtype: 'default' } } };
    const v = validateWorkflow(wf, c);
    expect(v.errors.some((e) => e.code === 'model_file_missing' && e.detail.includes('ghost.safetensors'))).toBe(true);
  });

  it('warns (not errors) when an input image is missing', () => {
    const c = ctx();
    const wf = { '1': { class_type: 'LoadImage', inputs: { image: 'not_uploaded.png' } } };
    const v = validateWorkflow(wf, c);
    expect(v.ok).toBe(true);
    expect(v.warnings.some((w) => w.code === 'input_image_missing')).toBe(true);
  });
});
