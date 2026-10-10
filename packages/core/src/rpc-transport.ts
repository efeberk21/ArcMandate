import { BaseError, HttpRequestError, TimeoutError, fallback, http, type Transport } from 'viem';

class RpcChainMismatchError extends Error {
  // EIP-1193 wrong-network errors are permanent, rather than retryable failures.
  readonly code = 4901;
  constructor() { super('RPC chain does not match the selected network'); this.name = 'RpcChainMismatchError'; }
}

function transient(error: Error): boolean {
  const cause = error instanceof BaseError ? error.walk((item) =>
    item instanceof HttpRequestError || item instanceof TimeoutError ||
    (typeof item === 'object' && item !== null && 'code' in item && [-32005, -32007, -32014, 429].includes(Number(item.code)))) : error;
  if (cause instanceof TimeoutError) return true;
  if (cause instanceof HttpRequestError) return cause.status === undefined || [408, 429, 500, 502, 503, 504].includes(cause.status);
  return typeof cause === 'object' && cause !== null && 'code' in cause && [-32005, -32007, -32014, 429].includes(Number(cause.code));
}

function checkedHttp(url: string, chainId: number, timeout: number): Transport {
  const transport = http(url, { batch: { batchSize: 20, wait: 25 }, timeout, retryCount: 0 });
  let validating: Promise<void> | undefined;
  const check = (value: unknown) => {
    if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value) || BigInt(value) !== BigInt(chainId)) throw new RpcChainMismatchError();
  };
  return (options) => {
    const instance = transport(options);
    return { ...instance, request: (async (args, requestOptions) => {
      if (args.method === 'eth_chainId') {
        const value = await instance.request(args, requestOptions); check(value); return value;
      }
      // Coalesce concurrent identity checks, but verify again for each new burst.
      if (!validating) {
        const pending = instance.request({ method: 'eth_chainId' }).then(check);
        validating = pending;
        void pending.finally(() => { if (validating === pending) validating = undefined; }).catch(() => {});
      }
      await validating;
      return instance.request(args, requestOptions);
    }) as typeof instance.request };
  };
}

export function publicRpcTransport(urls: string[], chainId: number, options: { timeout?: number; retryCount?: number } = {}) {
  return fallback(urls.map((url) => checkedHttp(url, chainId, options.timeout ?? 20_000)), {
    rank: false, retryCount: options.retryCount ?? 2, retryDelay: 1_000,
    // Contract reverts and authorization/identity errors must propagate immediately.
    shouldThrow: (error) => !transient(error),
  });
}
