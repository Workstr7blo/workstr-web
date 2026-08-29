import type { WorkoutProgramZapAttempt, WorkoutProgramZapStatus } from '../core/types';
import type { WorkstrStore } from '../db/store';
import type { WorkoutProgramZapSource } from './zaps';
import { executeWorkoutProgramZap, type ExecuteWorkoutProgramZapOptions, type WorkoutProgramZapInput, type WorkoutProgramZapResult } from './program-zap';

export interface WorkoutProgramZapStatusUpdate {
  attempt: WorkoutProgramZapAttempt;
  result?: WorkoutProgramZapResult;
}

export interface ExecuteWorkoutProgramZapWithStatusOptions extends ExecuteWorkoutProgramZapOptions {
  onStatus?: (update: WorkoutProgramZapStatusUpdate) => void;
}

export interface WorkoutProgramZapStatusResult {
  attempt: WorkoutProgramZapAttempt;
  result: WorkoutProgramZapResult;
}

function newAttemptId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `program-zap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function programMetadata(program: WorkoutProgramZapSource): Pick<WorkoutProgramZapAttempt, 'programAddress' | 'programName' | 'programEventId' | 'programPubkey'> {
  return {
    programAddress: program.address || `local:${program.slug || 'program'}`,
    programName: program.name || 'Workout program',
    programEventId: program.eventId,
    programPubkey: program.pubkey
  };
}

export function createWorkoutProgramZapAttempt(input: WorkoutProgramZapInput, now = new Date()): WorkoutProgramZapAttempt {
  const createdAt = now.toISOString();
  return {
    id: newAttemptId(),
    status: 'pending',
    ...programMetadata(input.program as WorkoutProgramZapSource),
    amountSats: input.amountSats,
    comment: input.comment?.trim() || undefined,
    createdAt,
    updatedAt: createdAt
  };
}

export function statusForWorkoutProgramZapResult(result: WorkoutProgramZapResult): WorkoutProgramZapStatus {
  if (result.ok) return 'succeeded';
  if (result.error.code === 'signing-failed' && /cancel|reject|denied/i.test(result.error.message)) return 'cancelled';
  return 'failed';
}

function completedAttempt(base: WorkoutProgramZapAttempt, result: WorkoutProgramZapResult, now = new Date()): WorkoutProgramZapAttempt {
  const updatedAt = now.toISOString();
  if (result.ok) {
    return {
      ...base,
      status: 'succeeded',
      programAddress: result.value.programAddress || base.programAddress,
      recipientPubkey: result.value.recipient.pubkey,
      recipientLnurl: result.value.recipient.lnurl,
      invoice: result.value.invoice,
      paymentHash: result.value.payment.paymentHash,
      feesPaidMsat: result.value.payment.feesPaidMsat,
      errorCode: undefined,
      errorMessage: undefined,
      nwcCode: undefined,
      nwcKind: undefined,
      updatedAt,
      completedAt: updatedAt
    };
  }
  return {
    ...base,
    status: statusForWorkoutProgramZapResult(result),
    errorCode: result.error.code,
    errorMessage: result.error.message,
    nwcCode: result.error.nwcCode,
    nwcKind: result.error.nwcKind,
    updatedAt,
    completedAt: updatedAt
  };
}

function unknownFailureResult(message: string): WorkoutProgramZapResult {
  return { ok: false, error: { code: 'payment-failed', message } };
}

// Persist a pending attempt before the wallet/signing work starts, then persist the final
// state. Callers can update UI from `onStatus` immediately and can recover the latest state
// from WorkstrStore after navigation or refresh.
export async function executeWorkoutProgramZapWithStatus(
  store: WorkstrStore,
  input: WorkoutProgramZapInput,
  options: ExecuteWorkoutProgramZapWithStatusOptions = {}
): Promise<WorkoutProgramZapStatusResult> {
  const { onStatus, ...executeOptions } = options;
  const pending = createWorkoutProgramZapAttempt(input);
  await store.saveWorkoutProgramZapAttempt(pending);
  onStatus?.({ attempt: pending });

  let result: WorkoutProgramZapResult;
  try {
    result = await executeWorkoutProgramZap(input, executeOptions);
  } catch {
    result = unknownFailureResult('Wallet status is unknown. Check your wallet before retrying.');
  }

  const finalAttempt = completedAttempt(pending, result);
  await store.saveWorkoutProgramZapAttempt(finalAttempt);
  onStatus?.({ attempt: finalAttempt, result });
  return { attempt: finalAttempt, result };
}
