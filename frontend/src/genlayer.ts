import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { contractConfig } from './config';
import {
  ClaimRecord,
  AssessmentRecord,
  LatestAssessmentResponse,
  PaginatedResponse,
  OfficialRowObject,
  VALID_OUTCOMES,
} from './types';

export const readClient = createClient({ chain: studioDevnet });

const DECIMAL_REGEX = /^(0|[1-9][0-9]*)$/;
const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const COMMIT_REGEX = /^[0-9a-f]{40}$/;
const HEX64_REGEX = /^[0-9a-f]{64}$/;
const RESULT_ID_REGEX = /^6\.0-[0-9]{4}$/;

function validateDecimalString(val: unknown, fieldName: string): string {
  if (typeof val !== 'string' || !DECIMAL_REGEX.test(val)) {
    throw new Error(`Field '${fieldName}' must be a canonical unsigned decimal string; received '${String(val)}'.`);
  }
  return val;
}

function validateAddressString(val: unknown, fieldName: string): string {
  if (typeof val !== 'string' || !ADDRESS_REGEX.test(val)) {
    throw new Error(`Field '${fieldName}' must be a valid 20-byte hex address; received '${String(val)}'.`);
  }
  return val;
}

function validateCommitString(val: unknown, fieldName: string): string {
  if (typeof val !== 'string' || !COMMIT_REGEX.test(val)) {
    throw new Error(`Field '${fieldName}' must be a 40-character lowercase hex commit; received '${String(val)}'.`);
  }
  return val;
}

function validateHex64String(val: unknown, fieldName: string, allowEmpty = false): string {
  if (allowEmpty && val === '') return '';
  if (typeof val !== 'string' || !HEX64_REGEX.test(val)) {
    throw new Error(`Field '${fieldName}' must be a 64-character lowercase hex string; received '${String(val)}'.`);
  }
  return val;
}

function validateResultIdString(val: unknown, fieldName: string): string {
  if (typeof val !== 'string' || !RESULT_ID_REGEX.test(val)) {
    throw new Error(`Field '${fieldName}' must match format 6.0-NNNN; received '${String(val)}'.`);
  }
  return val;
}

function validateStringField(val: unknown, fieldName: string): string {
  if (typeof val !== 'string') {
    throw new Error(`Field '${fieldName}' must be a string; received '${typeof val}'.`);
  }
  return val;
}

export function parseOfficialRowObject(raw: unknown): OfficialRowObject {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Official row data must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;

  const keys = [
    'release',
    'result_id',
    'submitter',
    'availability',
    'category',
    'suite',
    'system',
    'platform',
    'used_model',
    'model',
    'scenario',
    'accuracy',
    'nodes',
    'processor',
    'host_processors_per_node',
    'host_processor_core_count',
    'accelerator',
    'accelerators_per_node',
    'total_accelerators',
    'software',
    'operating_system',
    'performance_result',
    'performance_units',
    'has_power',
    'inferred',
    'compliance',
    'errors',
  ] as const;

  const result: Partial<OfficialRowObject> = {};
  for (const k of keys) {
    if (typeof obj[k] !== 'string') {
      throw new Error(`Official row field '${k}' must be a string; received '${typeof obj[k]}'.`);
    }
    result[k] = obj[k] as string;
  }

  if (result.release !== '6.0') {
    throw new Error(`Invalid official row release: '${result.release}'. Expected '6.0'.`);
  }
  validateResultIdString(result.result_id, 'result_id');

  return result as OfficialRowObject;
}

export function parseClaimRecordJson(jsonStr: unknown): ClaimRecord {
  if (typeof jsonStr !== 'string' || !jsonStr.trim()) {
    throw new Error('Claim record response must be a non-empty JSON string.');
  }
  let obj: unknown;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse claim record JSON.');
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Claim record must be a JSON object.');
  }
  const r = obj as Record<string, unknown>;

  return {
    id: validateDecimalString(r.id, 'id'),
    registrant: validateAddressString(r.registrant, 'registrant'),
    source_url: validateStringField(r.source_url, 'source_url'),
    exact_claim_text: validateStringField(r.exact_claim_text, 'exact_claim_text'),
    normalized_claim_text: validateStringField(r.normalized_claim_text, 'normalized_claim_text'),
    claim_fingerprint: validateHex64String(r.claim_fingerprint, 'claim_fingerprint'),
    official_result_id: validateResultIdString(r.official_result_id, 'official_result_id'),
    official_commit: validateCommitString(r.official_commit, 'official_commit'),
    byte_start: validateDecimalString(r.byte_start, 'byte_start'),
    byte_end: validateDecimalString(r.byte_end, 'byte_end'),
    official_row_fingerprint: validateHex64String(r.official_row_fingerprint, 'official_row_fingerprint'),
    official: parseOfficialRowObject(r.official),
    supersedes_claim_id: validateDecimalString(r.supersedes_claim_id, 'supersedes_claim_id'),
    created_at: validateStringField(r.created_at, 'created_at'),
  };
}

export function parseAssessmentRecordJson(jsonStr: unknown): AssessmentRecord {
  if (typeof jsonStr !== 'string' || !jsonStr.trim()) {
    throw new Error('Assessment record response must be a non-empty JSON string.');
  }
  let obj: unknown;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse assessment record JSON.');
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Assessment record must be a JSON object.');
  }
  const r = obj as Record<string, unknown>;

  const outcomeStr = validateStringField(r.outcome, 'outcome');
  if (!VALID_OUTCOMES.includes(outcomeStr as (typeof VALID_OUTCOMES)[number])) {
    throw new Error(`Invalid assessment outcome: '${outcomeStr}'.`);
  }

  return {
    id: validateDecimalString(r.id, 'id'),
    claim_id: validateDecimalString(r.claim_id, 'claim_id'),
    assessor: validateAddressString(r.assessor, 'assessor'),
    official_result_id: validateResultIdString(r.official_result_id, 'official_result_id'),
    official_commit: validateCommitString(r.official_commit, 'official_commit'),
    byte_start: validateDecimalString(r.byte_start, 'byte_start'),
    byte_end: validateDecimalString(r.byte_end, 'byte_end'),
    official_row_fingerprint: validateHex64String(r.official_row_fingerprint, 'official_row_fingerprint', true),
    contradiction_mask: validateDecimalString(r.contradiction_mask, 'contradiction_mask'),
    material_omission_mask: validateDecimalString(r.material_omission_mask, 'material_omission_mask'),
    incompatible_scope_mask: validateDecimalString(r.incompatible_scope_mask, 'incompatible_scope_mask'),
    uncertainty_mask: validateDecimalString(r.uncertainty_mask, 'uncertainty_mask'),
    outcome: outcomeStr as (typeof VALID_OUTCOMES)[number],
    prior_attempt_id: validateDecimalString(r.prior_attempt_id, 'prior_attempt_id'),
    prior_resolved_id: validateDecimalString(r.prior_resolved_id, 'prior_resolved_id'),
    created_at: validateStringField(r.created_at, 'created_at'),
  };
}

export function parseLatestAssessmentJson(jsonStr: unknown): LatestAssessmentResponse {
  if (typeof jsonStr !== 'string' || !jsonStr.trim()) {
    throw new Error('Latest assessment response must be a non-empty JSON string.');
  }
  let obj: unknown;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse latest assessment JSON.');
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Latest assessment response must be a JSON object.');
  }
  const r = obj as Record<string, unknown>;

  if (!('latest_attempt' in r) || !('latest_resolved' in r)) {
    throw new Error("Latest assessment response must contain 'latest_attempt' and 'latest_resolved'.");
  }

  let latest_attempt: AssessmentRecord | null = null;
  if (r.latest_attempt === null) {
    latest_attempt = null;
  } else if (typeof r.latest_attempt === 'object' && r.latest_attempt !== null && !Array.isArray(r.latest_attempt)) {
    latest_attempt = parseAssessmentRecordJson(JSON.stringify(r.latest_attempt));
  } else {
    throw new Error("Field 'latest_attempt' must be literal null or an assessment object.");
  }

  let latest_resolved: AssessmentRecord | null = null;
  if (r.latest_resolved === null) {
    latest_resolved = null;
  } else if (typeof r.latest_resolved === 'object' && r.latest_resolved !== null && !Array.isArray(r.latest_resolved)) {
    latest_resolved = parseAssessmentRecordJson(JSON.stringify(r.latest_resolved));
  } else {
    throw new Error("Field 'latest_resolved' must be literal null or an assessment object.");
  }

  return { latest_attempt, latest_resolved };
}

export function parsePaginatedClaimsJson(jsonStr: unknown): PaginatedResponse<ClaimRecord> {
  if (typeof jsonStr !== 'string' || !jsonStr.trim()) {
    throw new Error('Paginated claims response must be a non-empty JSON string.');
  }
  let obj: unknown;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse paginated claims JSON.');
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Paginated claims response must be a JSON object.');
  }
  const r = obj as Record<string, unknown>;

  const cursor = validateDecimalString(r.cursor, 'cursor');
  const total = validateDecimalString(r.total, 'total');
  const next_cursor =
    r.next_cursor !== null && r.next_cursor !== undefined
      ? validateDecimalString(r.next_cursor, 'next_cursor')
      : null;

  if (!Array.isArray(r.items)) {
    throw new Error("Paginated claims response 'items' must be an array.");
  }

  const items = r.items.map((item) => parseClaimRecordJson(JSON.stringify(item)));
  return { cursor, items, next_cursor, total };
}

export function parsePaginatedAssessmentsJson(jsonStr: unknown): PaginatedResponse<AssessmentRecord> {
  if (typeof jsonStr !== 'string' || !jsonStr.trim()) {
    throw new Error('Paginated assessments response must be a non-empty JSON string.');
  }
  let obj: unknown;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse paginated assessments JSON.');
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Paginated assessments response must be a JSON object.');
  }
  const r = obj as Record<string, unknown>;

  const cursor = validateDecimalString(r.cursor, 'cursor');
  const total = validateDecimalString(r.total, 'total');
  const next_cursor =
    r.next_cursor !== null && r.next_cursor !== undefined
      ? validateDecimalString(r.next_cursor, 'next_cursor')
      : null;

  if (!Array.isArray(r.items)) {
    throw new Error("Paginated assessments response 'items' must be an array.");
  }

  const items = r.items.map((item) => parseAssessmentRecordJson(JSON.stringify(item)));
  return { cursor, items, next_cursor, total };
}

export async function fetchClaim(claimId: bigint): Promise<ClaimRecord> {
  if (contractConfig.status !== 'configured') {
    throw new Error('Contract address is not configured.');
  }

  const result = await readClient.readContract({
    address: contractConfig.address,
    functionName: 'get_claim',
    args: [claimId],
  });

  return parseClaimRecordJson(result);
}

export async function fetchAssessment(assessmentId: bigint): Promise<AssessmentRecord> {
  if (contractConfig.status !== 'configured') {
    throw new Error('Contract address is not configured.');
  }

  const result = await readClient.readContract({
    address: contractConfig.address,
    functionName: 'get_assessment',
    args: [assessmentId],
  });

  return parseAssessmentRecordJson(result);
}

export async function fetchLatestAssessment(claimId: bigint): Promise<LatestAssessmentResponse> {
  if (contractConfig.status !== 'configured') {
    throw new Error('Contract address is not configured.');
  }

  const result = await readClient.readContract({
    address: contractConfig.address,
    functionName: 'get_latest_assessment',
    args: [claimId],
  });

  return parseLatestAssessmentJson(result);
}

export async function fetchClaimAssessments(
  claimId: bigint,
  cursor: bigint,
  limit: number
): Promise<PaginatedResponse<AssessmentRecord>> {
  if (contractConfig.status !== 'configured') {
    throw new Error('Contract address is not configured.');
  }

  const result = await readClient.readContract({
    address: contractConfig.address,
    functionName: 'get_claim_assessments',
    args: [claimId, cursor, limit],
  });

  return parsePaginatedAssessmentsJson(result);
}

export async function fetchClaims(
  cursor: bigint,
  limit: number
): Promise<PaginatedResponse<ClaimRecord>> {
  if (contractConfig.status !== 'configured') {
    throw new Error('Contract address is not configured.');
  }

  const result = await readClient.readContract({
    address: contractConfig.address,
    functionName: 'get_claims',
    args: [cursor, limit],
  });

  return parsePaginatedClaimsJson(result);
}
