import { networkLabel } from './release';
import { ARC_NETWORKS } from '@arcmandate/core';
import { addressInput } from '@arcmandate/core/policy';
import { capability, walletRole, type CapabilityState } from './capabilities';
import { pendingOperationsFor } from './operations';
export type AppState = CapabilityState & { agentAddress?:string };
export type StepAction = 'connect' | 'switch' | 'key' | 'deploy' | 'fund' | 'session' | 'agent' | 'freeze' | 'pending' | 'refresh' | 'diagnostics';
export type NextStep = { id: StepAction; title: string; body: string; primaryAction: string; blockedBy: string[] };
export function deriveNextStep(state: AppState): NextStep {
  const step = (id: StepAction, title: string, body: string, primaryAction: string, blockedBy: string[] = []): NextStep => ({ id,title,body,primaryAction,blockedBy });
  if (state.historyError || pendingOperationsFor(state.network,state.account,state.vault,state.operations).length) return step('pending','Check the existing transaction','Unknown or submitted is not a success. Check wallet activity and the saved receipt before retrying. Emergency freeze remains available with a distinct sender.','Resolve operation');
  if (state.vault && (!state.snapshot || state.snapshot.chainId !== ARC_NETWORKS[state.network].chainId || state.readError)) return step('refresh', state.readError ? 'Vault state is unavailable' : 'Reading your vault', 'Refreshing this page does not delete a session. Read the selected vault again to recover its current onchain state.', 'Refresh vault');
  if (state.snapshot && !state.snapshot.trusted) return step('diagnostics','Unverified contract build','Keep the address and your backup. This build is not approved for transactions. Export its public diagnostic details; do not send funds.','Export details');
  if (!state.account) return step('connect','Connect your wallet','Use your owner account to manage the vault or the agent account to pay. Saved vaults remain available without a connection.',state.provider?'Connect wallet':'How to connect a wallet');
  if (state.walletChain !== ARC_NETWORKS[state.network].chainId) return step('switch',`Switch to ${networkLabel(state.network)}`,'Your wallet account remains yours; management and payments require the displayed network.','Switch network');
  if (!state.vault) {
    if (state.phase === 'locked') return step('key','Create or restore your Vault Key','Create your second management key, or unlock an existing backup. Keep the encrypted file and its password.','Set up Vault Key');
    if (state.phase === 'generated') return step('key','Verify your encrypted backup','Download the backup, then select the downloaded file and restore it. This proves you can recover the key before funding.','Verify backup');
    const result=capability('deploy',state); return step('deploy','Create your empty vault','Your wallet owns the vault. Creation deposits 0 USDC and opens no spending session.','Review vault creation',result.reasons);
  }
  const snapshot=state.snapshot!;
  if (snapshot.active && (snapshot.timestamp >= snapshot.policy.expiresAt || snapshot.spent >= snapshot.policy.totalBudget)) return step('session',snapshot.timestamp >= snapshot.policy.expiresAt ? 'Session expired' : 'Session budget used','The owner can replace the session to grant new authority, or freeze it before withdrawing. A deposit does not renew a used budget.','Review session options');
  if (snapshot.active && snapshot.balance > 0n) return step('agent','The session permits payments','Connect the configured agent account to make a payment within these limits. Opening a session does not start a bot.','Open agent console');
  if (walletRole(state) !== 'Owner') return step('agent','Prepare the agent or view this vault','Payments use the configured agent. To change spending limits, connect the owner wallet. Freeze options remain available below.','View agent setup');
  if (state.phase !== 'restored' || state.publicKey?.toLowerCase() !== snapshot.publicKey.toLowerCase()) return step('key','Unlock this vault’s management key','Select the matching encrypted backup. The owner can freeze an active session without unlocking it.','Unlock Vault Key');
  let agentChosen=false;
  try { const agent=addressInput(state.agentAddress??'','Agent');agentChosen=agent.toLowerCase()!==snapshot.owner.toLowerCase()&&agent.toLowerCase()!==snapshot.address.toLowerCase(); } catch { /* Incomplete setup stays actionable. */ }
  if(!agentChosen&&!snapshot.active) return step('agent','Prepare your agent account','Choose a separate payment account and check its fee balance before opening a timed session. Your owner wallet keeps management access.','Prepare agent');
  if (snapshot.balance === 0n) return step('fund','Deposit USDC into your vault','Add USDC to the vault. The agent pays recipients from here; its own wallet only needs network fees.','View deposit');
  return step('session','Choose your agent’s spending limits','Check the agent account and its fee balance, then choose recipients, budget and duration. Open the session last; time spent waiting for wallet approval reduces its usable duration.','Set spending limits');
}
