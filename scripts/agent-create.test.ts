import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep, basename } from 'node:path';
import { createAgent } from './agent-create.js';
let root:string;
beforeEach(()=>{root=mkdtempSync(resolve(tmpdir(),'arcmandate-agent-test-'));});
afterEach(()=>{const target=resolve(root);if(!target.startsWith(resolve(tmpdir())+sep)||!basename(target).startsWith('arcmandate-agent-test-'))throw new Error('Unsafe test cleanup path');rmSync(target,{recursive:true,force:true});});
it('creates a separate local agent key without exposing it in the result or overwriting it',()=>{
  const result=createAgent('test-agent',root);const original=readFileSync(result.path,'utf8');expect(result.address).toMatch(/^0x[0-9a-f]{40}$/i);expect(Object.keys(result).sort()).toEqual(['address','path']);expect(JSON.parse(original).privateKey).toMatch(/^0x[0-9a-f]{64}$/i);
  expect(()=>createAgent('test-agent',root)).toThrow('already exists');expect(readFileSync(result.path,'utf8')).toBe(original);
  if(process.platform!=='win32'){expect(statSync(result.path).mode&0o777).toBe(0o600);expect(statSync(resolve(root,'test-agent')).mode&0o777).toBe(0o700);}
});
it('rejects path traversal and reserved device names without creating an agent directory',()=>{
  for(const name of ['../escape','a/b','C:escape','CON','con','nul','lpt1',''])expect(()=>createAgent(name,root)).toThrow();expect(readdirSync(root)).toEqual([]);
});
