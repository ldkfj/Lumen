// Domain types and taxonomy definitions for Lumen

export const CONTRADICTION_AND_OMISSION_KEYS = [
  'release',
  'result_id',
  'submitter',
  'system_type',
  'division',
  'availability',
  'system_platform',
  'model',
  'accuracy_tier',
  'scenario',
  'metric_value',
  'metric_unit',
  'node_count',
  'processor',
  'accelerator_type',
  'accelerator_count',
  'power_basis',
  'inferred_measured',
  'claim_scope',
] as const;

export type ContradictionKey = typeof CONTRADICTION_AND_OMISSION_KEYS[number];

export const INCOMPATIBLE_SCOPE_KEYS = [
  'unreported_metric',
  'cross_scenario',
  'cross_model',
  'cross_system',
  'comparative_or_superlative',
  'derived_metric',
  'general_quality_claim',
  'multi_result_claim',
] as const;

export type IncompatibleScopeKey = typeof INCOMPATIBLE_SCOPE_KEYS[number];

export const UNCERTAINTY_KEYS = [
  'claim_subject_ambiguous',
  'metric_ambiguous',
  'scope_ambiguous',
  'claim_source_unavailable',
  'official_source_unavailable',
  'semantic_evidence_insufficient',
] as const;

export type UncertaintyKey = typeof UNCERTAINTY_KEYS[number];

export const VALID_OUTCOMES = [
  'UNRESOLVED',
  'NOT_COMPARABLE',
  'OVERSTATED',
  'QUALIFICATION_REQUIRED',
  'SUPPORTED',
] as const;

export type Outcome = typeof VALID_OUTCOMES[number] | 'UNASSESSED';

export interface OfficialRowObject {
  release: string;
  result_id: string;
  submitter: string;
  availability: string;
  category: string;
  suite: string;
  system: string;
  platform: string;
  used_model: string;
  model: string;
  scenario: string;
  accuracy: string;
  nodes: string;
  processor: string;
  host_processors_per_node: string;
  host_processor_core_count: string;
  accelerator: string;
  accelerators_per_node: string;
  total_accelerators: string;
  software: string;
  operating_system: string;
  performance_result: string;
  performance_units: string;
  has_power: string;
  inferred: string;
  compliance: string;
  errors: string;
}

export interface ClaimRecord {
  id: string;
  registrant: string;
  source_url: string;
  exact_claim_text: string;
  normalized_claim_text: string;
  claim_fingerprint: string;
  official_result_id: string;
  official_commit: string;
  byte_start: string;
  byte_end: string;
  official_row_fingerprint: string;
  official: OfficialRowObject;
  supersedes_claim_id: string;
  created_at: string;
}

export interface AssessmentRecord {
  id: string;
  claim_id: string;
  assessor: string;
  official_result_id: string;
  official_commit: string;
  byte_start: string;
  byte_end: string;
  official_row_fingerprint: string;
  contradiction_mask: string;
  material_omission_mask: string;
  incompatible_scope_mask: string;
  uncertainty_mask: string;
  outcome: typeof VALID_OUTCOMES[number];
  prior_attempt_id: string;
  prior_resolved_id: string;
  created_at: string;
}

export interface LatestAssessmentResponse {
  latest_attempt: AssessmentRecord | null;
  latest_resolved: AssessmentRecord | null;
}

export interface PaginatedResponse<T> {
  cursor: string;
  items: T[];
  next_cursor: string | null;
  total: string;
}

// Taxonomy Explanations
export const TAXONOMY_EXPLANATIONS: Record<string, string> = {
  // Contradiction & Omission keys
  release: 'Release version mismatch or discrepancy with MLPerf Inference 6.0',
  result_id: 'Result ID does not match the official entry',
  submitter: 'Vendor or submitter entity mismatch',
  system_type: 'System classification (datacenter vs edge) discrepancy',
  division: 'Benchmark division (closed vs open vs network) mismatch',
  availability: 'Availability tier (available, preview, research) mismatch',
  system_platform: 'System platform or hardware name mismatch',
  model: 'Model architecture does not match official test specification',
  accuracy_tier: 'Accuracy target (e.g. 99% vs 99.9%) target mismatch',
  scenario: 'Execution scenario (Server, Offline, SingleStream, MultiStream) mismatch',
  metric_value: 'Reported throughput or latency value differs from official record',
  metric_unit: 'Metric units (samples/sec, queries/sec, latency ms) discrepancy',
  node_count: 'Number of compute nodes mismatch',
  processor: 'Host processor (CPU) specification differs from measured record',
  accelerator_type: 'Accelerator hardware model differs from official configuration',
  accelerator_count: 'Accelerator hardware count discrepancy',
  power_basis: 'Power measurement basis or inclusion mismatch',
  inferred_measured: 'Inferred vs directly measured metric status discrepancy',
  claim_scope: 'Claim asserts broad or unqualified performance scope not substantiated by this row',

  // Incompatible scope keys
  unreported_metric: 'Claim cites a metric not published in the official summary',
  cross_scenario: 'Claim blends or compares multiple separate benchmark scenarios',
  cross_model: 'Claim blends or compares across different model architectures',
  cross_system: 'Claim blends or compares across different hardware systems',
  comparative_or_superlative: 'Claim asserts relative or superlative comparison (e.g., fastest, #1) not provable from a single row',
  derived_metric: 'Claim uses calculated or derived figures not present in official summary',
  general_quality_claim: 'Claim asserts general product quality or superiority beyond benchmark measurement',
  multi_result_claim: 'Claim requires multiple independent benchmark results to substantiate',

  // Uncertainty keys
  claim_subject_ambiguous: 'Subject or hardware configuration of the marketing claim is ambiguous',
  metric_ambiguous: 'Metric value or comparison basis in claim text is ambiguous',
  scope_ambiguous: 'Scope or environment in claim text is ambiguous',
  claim_source_unavailable: 'Claim source URL was unavailable or did not contain the claim text during verification',
  official_source_unavailable: 'Official repository summary slice was unavailable during verification',
  semantic_evidence_insufficient: 'Information is insufficient to establish conclusive mapping',
};

export function decodeMask(maskStr: string, keyList: readonly string[]): string[] {
  if (!/^(0|[1-9][0-9]*)$/.test(maskStr)) {
    return [];
  }
  const mask = BigInt(maskStr);
  const result: string[] = [];
  for (let i = 0; i < keyList.length; i++) {
    if ((mask & (1n << BigInt(i))) !== 0n) {
      result.push(keyList[i]);
    }
  }
  return result;
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'Unknown error occurred.';
}
