import { getAddress, isAddress, type Address, type Hex } from 'viem';
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected evidence object'); return v as ObjectValue; };
const hash = (v: unknown): Hex => { if (typeof v !== 'string' || !/^0x[0-9a-f]{64}$/i.test(v)) throw new Error('Invalid evidence hash'); return v as Hex; };
const uint = (v: unknown): string => { if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v)) throw new Error('Invalid evidence integer'); return v; };
export type EvidenceStep = { label: string; kind: 'receipt' | 'simulation'; hash?: Hex; blockNumber: string; status?: 'success' | 'reverted'; error?: string; blockHash?: Hex; gasUsed?: string; effectiveGasPrice?: string };
export function normalizeEvidence(value: unknown, expectedVault?: Address) {
  const m = object(value);
  if (![1,2,3].includes(Number(m.schemaVersion)) || m.chainId !== 5042002 || typeof m.vault !== 'string' || !isAddress(m.vault)) throw new Error('Invalid evidence schema, chain or vault');
  const vault = getAddress(m.vault);
  if (expectedVault && getAddress(expectedVault) !== vault) throw new Error('Evidence vault mismatch');
  const raw = m.steps ?? m.transactions;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Missing evidence steps');
  const labels = new Set<string>();
  const steps: EvidenceStep[] = raw.map((value) => {
    const s = object(value);
    if (typeof s.label !== 'string' || !s.label || labels.has(s.label)) throw new Error('Invalid or duplicate evidence label');
    labels.add(s.label);
    if (s.txHash || s.hash) {
      if (!['success','reverted'].includes(String(s.receiptStatus))) throw new Error('Missing receipt status');
      return { label: s.label, kind: 'receipt', hash: hash(s.txHash ?? s.hash), blockNumber: uint(s.blockNumber), status: s.receiptStatus as 'success' | 'reverted',
        ...(s.blockHash ? { blockHash: hash(s.blockHash) } : {}), ...(s.gasUsed ? { gasUsed: uint(s.gasUsed) } : {}), ...(s.effectiveGasPrice ? { effectiveGasPrice: uint(s.effectiveGasPrice) } : {}) };
    }
    if (!['simulation_rejection','simulation'].includes(String(s.evidenceType)) || typeof s.decodedError !== 'string' || !s.decodedError) throw new Error('Missing simulation evidence');
    if (typeof s.to !== 'string' || !isAddress(s.to) || getAddress(s.to) !== vault) throw new Error('Simulation target does not match vault');
    return { label: s.label, kind: 'simulation', blockNumber: uint(s.block), error: s.decodedError };
  });
  const deployment = steps.find((s) => /deploy/i.test(s.label));
  if (!deployment?.hash || deployment.status !== 'success') throw new Error('Missing successful deployment evidence');
  if (m.deploymentTxHash && hash(m.deploymentTxHash) !== deployment.hash) throw new Error('Deployment hash mismatch');
  if (m.deploymentBlock && uint(m.deploymentBlock) !== deployment.blockNumber) throw new Error('Deployment block mismatch');
  return { schemaVersion: 3 as const, chainId: 5042002, vault,
    deploymentTxHash: deployment.hash, deploymentBlock: deployment.blockNumber,
    provenance: m.provenance ?? { historicalSource: m.sourceCommit ?? m.sourceState ?? 'unknown', exactSourceTreeAvailable: false, dirty: m.sourceTreeDirty ?? m.sourceCommit === 'working-tree' }, steps };
}
