export const ARC_NETWORKS = {
  testnet: {
    chainId: 5_042_002,
    rpcUrl: 'https://rpc.testnet.arc.io',
    explorerUrl: 'https://explorer.testnet.arc.io',
  },
  mainnet: {
    chainId: 5_042,
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorerUrl: 'https://explorer.arc.io',
  },
} as const;

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
export const USDC_DECIMALS = 6;
export const PQ_VERIFIER_ADDRESS = '0x1800000000000000000000000000000000000004' as const;
