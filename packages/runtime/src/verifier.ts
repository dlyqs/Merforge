import {
  ACCEPTANCE_VERSION,
  submissionSchema,
  type VerificationResult,
} from '@merforge/contracts';

export interface Verifier {
  verify(
    payload: unknown,
    acceptanceVersion: string,
  ): Promise<VerificationResult>;
}
// Only checks the versioned example JSON contract, never business correctness.
// Reason codes are fixed strings and contain no original submission values.
export class SubmissionVerifier implements Verifier {
  async verify(
    payload: unknown,
    acceptanceVersion: string,
  ): Promise<VerificationResult> {
    if (acceptanceVersion !== ACCEPTANCE_VERSION) {
      return {
        acceptanceVersion,
        verdict: 'FAIL',
        reasons: ['UNSUPPORTED_ACCEPTANCE_VERSION'],
      };
    }
    const parsed = submissionSchema.safeParse(payload);
    return parsed.success
      ? { acceptanceVersion, verdict: 'PASS', reasons: ['SUMMARY_NON_EMPTY'] }
      : {
          acceptanceVersion,
          verdict: 'FAIL',
          reasons: ['SUMMARY_REQUIRED_NON_EMPTY_STRING'],
        };
  }
}
