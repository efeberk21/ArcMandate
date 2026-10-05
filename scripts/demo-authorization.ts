import type { Authorization } from '../packages/core/src/digest.js';
export async function freshAuthorization(lastReceiptBlock: bigint, port: {
  head(): Promise<bigint>;
  state(block: bigint): Promise<{ nonce: bigint; sessionId: bigint; timestamp: bigint }>;
}): Promise<Authorization> {
  const head = await port.head();
  const at = head > lastReceiptBlock ? head : lastReceiptBlock;
  const state = await port.state(at);
  return { nonce: state.nonce, sessionId: state.sessionId, deadline: state.timestamp + 600n };
}
