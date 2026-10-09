import { ARC_NETWORKS } from '@arcmandate/core';

declare const __ARC_RELEASE_NETWORK__: keyof typeof ARC_NETWORKS;
// Build choice only: a URL parameter cannot enable mainnet transactions.
export const releaseNetwork = typeof __ARC_RELEASE_NETWORK__ === 'undefined' ? 'testnet' : __ARC_RELEASE_NETWORK__;
export const networkLabel = (network: keyof typeof ARC_NETWORKS) => network === 'mainnet' ? 'Arc Mainnet' : 'Arc Testnet';
