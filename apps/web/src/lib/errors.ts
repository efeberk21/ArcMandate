import { errorMessage } from './transactions';
export function explainError(error: unknown): { message: string; advice: string } {
  const message = errorMessage(error);
  const cases: [RegExp,string][] = [
    [/SessionExpired/, 'The owner can replace the session, or freeze it before withdrawing.'],
    [/SessionInactive|SessionMismatch/, 'Refresh the vault. This payment remains tied to its original session.'],
    [/BudgetExceeded|PerPaymentLimitExceeded/, 'Choose an amount within the remaining budget and per-payment limit.'],
    [/RecipientNotAllowed/, 'Choose a recipient allowed by the current session.'],
    [/PaymentAlreadyUsed/, 'Recheck the existing payment receipt. Do not create a new payment ID to retry this request.'],
    [/InvalidNonce|AuthorizationExpired|ContextChanged|context changed|Authorization changed/i, 'Read the current state and review this action again.'],
    [/4001|user rejected|user denied|rejection/i, 'Wallet approval was declined. Review again when ready.'],
    [/Wrong password|damaged keyfile/, 'Check the password and original encrypted backup. There is no password reset.'],
    [/keyfile|backup.*match/i, 'Select the backup with this vault’s full public key, then verify it.'],
    [/quota|storage|history|locks/i, 'Export your local records and check wallet activity before recovery. Do not clear browser storage.'],
    [/429|rate|limit.*request|RPC|fetch|timeout/i, 'Retry the read or recheck the saved receipt. Do not resend an unknown transaction.'],
    [/owner|account|network/i, 'Check the connected wallet account and displayed Arc network.'],
  ];
  return { message, advice: cases.find(([pattern]) => pattern.test(message))?.[1] ?? 'Check the action details and current vault state before reviewing again.' };
}
