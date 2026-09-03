/**
 * Basics gate (vibe-coders-bible ch.28): structural validation before any
 * render is queued — catch broken state before wasted compute.
 *
 * Checks, in order:
 *  1. format is API (what /prompt takes) — UI format is rejected with guidance
 *  2. every class_type exists on the live server (/object_info)
 *  3. required inputs of each node are present
 *  4. model-file inputs resolve to files on disk in the models tree
 *  5. image inputs resolve to files in the input dir (warn only)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GateVerdict, ValidationIssue, WorkflowFormat } from '../schema/contracts.js';
import { detectFormat } from './workflows.js';
import type { ObjectInfo } from './comfyClient.js';

const MODEL_INPUT_HINTS = [
  'ckpt_name', 'unet_name', 'model_name', 'vae_name', 'clip_name',
  'clip_name1', 'clip_name2', 'clipvision_name', 'lora_name', 'lora_1_name',
  'lora_2_name', 'control_net_name', 'upscale_model', 'model_path',
  'bg_removal_model', 'model_name', 'moge_model',
];

export interface GateContext {
  objectInfo: ObjectInfo;
  modelsDir: string;
  inputDir: string;
}

export function validateWorkflow(
  wf: unknown,
  ctx: GateContext,
): GateVerdict {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const format: WorkflowFormat = detectFormat(wf);
  if (format !== 'api') {
    return {
      format,
      ok: false,
      node_count: 0,
      errors: [
        {
          code: format === 'ui' ? 'ui_format_not_supported' : 'unrecognized_format',
          detail:
            format === 'ui'
              ? 'Workflow is editor (UI) format. Export as API format (Workflow menu -> Export (API)) and submit that; POST /prompt only accepts API format.'
              : 'Workflow JSON is neither API format ({id: {class_type, inputs}}) nor UI format.',
        },
      ],
      warnings,
    };
  }

  const nodes = wf as Record<string, Record<string, unknown>>;
  const nodeIds = Object.keys(nodes);

  for (const [nodeId, node] of Object.entries(nodes)) {
    const classType = String(node.class_type ?? '');
    const def = ctx.objectInfo[classType];
    if (!def) {
      errors.push({
        code: 'unknown_node_type',
        node_id: nodeId,
        detail: `Node "${classType}" does not exist on the server. Run comfy_server status to check installed nodes/custom nodes.`,
      });
      continue;
    }

    const inputs = (node.inputs ?? {}) as Record<string, unknown>;
    const required = (def.input?.required ?? {}) as Record<string, unknown[]>;

    // In API format every required input must be present — widget values as
    // scalars, wire connections as [nodeId, slot]. ComfyUI re-checks at queue
    // time; the gate exists to fail before wasted compute.
    for (const inputName of Object.keys(required)) {
      if (!(inputName in inputs)) {
        errors.push({
          code: 'missing_required_input',
          node_id: nodeId,
          detail: `Input "${inputName}" of ${classType} is missing.`,
        });
      }
    }

    // Model files: verify the referenced file exists somewhere in models dir.
    for (const [inputName, value] of Object.entries(inputs)) {
      if (typeof value !== 'string') continue;
      if (MODEL_INPUT_HINTS.includes(inputName)) {
        if (!modelFileExists(ctx.modelsDir, value)) {
          errors.push({
            code: 'model_file_missing',
            node_id: nodeId,
            detail: `Model "${value}" (input "${inputName}" of ${classType}) not found under ${ctx.modelsDir}. Use comfy_models list to inventory.`,
          });
        }
      }
      if (inputName === 'image' && classType.toLowerCase().includes('loadimage')) {
        if (!inputFileExists(ctx.inputDir, value)) {
          warnings.push({
            code: 'input_image_missing',
            node_id: nodeId,
            detail: `Input image "${value}" not found in the input dir. Upload it or copy it into ${ctx.inputDir} before rendering.`,
          });
        }
      }
    }
  }

  return {
    format,
    ok: errors.length === 0,
    node_count: nodeIds.length,
    errors,
    warnings,
  };
}

function modelFileExists(modelsDir: string, filename: string): boolean {
  if (!fs.existsSync(modelsDir)) return false;
  const base = path.basename(filename);
  return findFile(modelsDir, base);
}

function inputFileExists(inputDir: string, filename: string): boolean {
  const p = path.join(inputDir, path.basename(filename));
  return fs.existsSync(p);
}

function findFile(dir: string, basename: string, depth = 0): boolean {
  if (depth > 4) return false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const ent of entries) {
    if (ent.isFile() && ent.name === basename) return true;
    if (ent.isDirectory() && !ent.name.startsWith('.') && findFile(path.join(dir, ent.name), basename, depth + 1)) {
      return true;
    }
  }
  return false;
}
