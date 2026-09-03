import { describe, it, expect } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listWorkflows, readWorkflow, detectFormat, workflowHash } from '../src/engine/workflows.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-wf-'));
}

describe('workflow library', () => {
  it('lists json files with format detection', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'a_api.json'), JSON.stringify({ '1': { class_type: 'X', inputs: {} } }));
    fs.writeFileSync(path.join(dir, 'b_ui.json'), JSON.stringify({ nodes: [], links: [] }));
    fs.writeFileSync(path.join(dir, 'ignore.txt'), 'x');
    const list = listWorkflows(dir);
    expect(list.map((w) => w.name)).toEqual(['a_api.json', 'b_ui.json']);
    expect(list[0].format).toBe('api');
    expect(list[1].format).toBe('ui');
  });

  it('returns empty for a missing dir', () => {
    expect(listWorkflows(path.join(tmpDir(), 'nope'))).toEqual([]);
  });

  it('reads a workflow by bare name and rejects traversal', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'w.json'), JSON.stringify({ hello: 1 }));
    expect(readWorkflow(dir, 'w.json')).toEqual({ hello: 1 });
    expect(() => readWorkflow(dir, '../w.json')).toThrow();
    expect(() => readWorkflow(dir, 'missing.json')).toThrow(/not found/);
  });

  it('hashes workflows stably (whitespace-insensitive to pretty-print width)', () => {
    const a = { '1': { class_type: 'X', inputs: { seed: 3 } } };
    const b = JSON.parse('{"1":{"class_type":"X","inputs":{"seed":3}}}');
    expect(workflowHash(a)).toBe(workflowHash(b));
  });
});

describe('detectFormat', () => {
  it('classifies api / ui / unknown', () => {
    expect(detectFormat({ '1': { class_type: 'A', inputs: {} } })).toBe('api');
    expect(detectFormat({ nodes: [], links: [] })).toBe('ui');
    expect(detectFormat({ foo: 'bar' })).toBe('unknown');
    expect(detectFormat([1, 2])).toBe('unknown');
  });
});
