import { describe, it, expect, beforeEach, vi } from 'vitest';
import { locateOfficialRows, scanArrayBufferForOfficialRow, scanArrayBufferForOfficialRows } from './officialRow';
import {
  decodeMask,
  CONTRADICTION_AND_OMISSION_KEYS,
  INCOMPATIBLE_SCOPE_KEYS,
  UNCERTAINTY_KEYS,
  ClaimRecord,
  AssessmentRecord,
  OfficialRowObject,
} from './types';
import { chainInfo, getContractConfig } from './config';
import * as genlayerModule from './genlayer';
import {
  validateTransactionHash,
  savePendingOperation,
  loadPendingOperation,
  clearPendingOperation,
  verifyAndReadbackRecord,
  processTransactionFinalityAndReadback,
  executeContractWrite,
  waitForWalletUiReady,
  PendingOperation,
  normalizeSourceUrl,
} from './transaction';
import { walletManager } from './wallet';
import type { TransactionHash, GenLayerTransaction } from 'genlayer-js/types';
import { TransactionStatus, TransactionResult, ExecutionResult } from 'genlayer-js/types';

describe('Official Row Byte Scanner Suite', () => {
  const encoder = new TextEncoder();

  it('fetches the immutable official file through the range-capable GitHub Contents API', async () => {
    const body = encoder.encode('[{"ID":"6.0-0001","Submitter":"Acme"}]');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => body.buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    await locateOfficialRows('a'.repeat(40), '6.0-0001');

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.github.com/repos/mlcommons/inference_results_v6.0/contents/summary_results.json?ref=${'a'.repeat(40)}`,
      { headers: { Accept: 'application/vnd.github.raw+json' } }
    );
  });

  it('scans exact inclusive offsets for single row', () => {
    const jsonStr = '[{"ID": "6.0-0001", "Submitter": "Acme", "Model": "ResNet50"}]';
    const bytes = encoder.encode(jsonStr);
    const result = scanArrayBufferForOfficialRow(bytes, '6.0-0001');

    expect(result.byteStart).toBe(1);
    expect(result.byteEnd).toBe(jsonStr.length - 2);
    expect(result.rowObject.result_id).toBe('6.0-0001');
    expect(result.rowObject.submitter).toBe('Acme');
  });

  it('handles braces, brackets, and escaped quotes inside JSON string fields', () => {
    const jsonStr = `[
      {"ID": "6.0-0001", "Platform": "System with {braces}, [brackets], and \\"escaped quotes\\"", "Submitter": "Acme"}
    ]`;
    const bytes = encoder.encode(jsonStr);
    const result = scanArrayBufferForOfficialRow(bytes, '6.0-0001');

    expect(result.rowObject.result_id).toBe('6.0-0001');
    expect(result.rowObject.platform).toContain('{braces}');
    expect(result.rowObject.platform).toContain('[brackets]');
  });

  it('correctly handles multibyte UTF-8 characters before and inside rows', () => {
    const jsonStr = `[
      {"ID": "6.0-0001", "Submitter": "Accéléré AI ⚡", "Software": "PyTorch 日本語"}
    ]`;
    const bytes = encoder.encode(jsonStr);
    const result = scanArrayBufferForOfficialRow(bytes, '6.0-0001');

    expect(result.rowObject.submitter).toBe('Accéléré AI ⚡');
    expect(result.rowObject.software).toBe('PyTorch 日本語');
  });

  it('correctly matches target row among multiple rows', () => {
    const jsonStr = `[
      {"ID": "6.0-0001", "Submitter": "A"},
      {"ID": "6.0-0002", "Submitter": "TargetCorp"}
    ]`;
    const bytes = encoder.encode(jsonStr);
    const result = scanArrayBufferForOfficialRow(bytes, '6.0-0002');

    expect(result.rowObject.result_id).toBe('6.0-0002');
    expect(result.rowObject.submitter).toBe('TargetCorp');
  });

  it('returns every official row sharing a submission result ID', () => {
    const jsonStr = `[
      {"ID": "6.0-0001", "Submitter": "A"},
      {"ID": "6.0-0001", "Submitter": "B"}
    ]`;
    const bytes = encoder.encode(jsonStr);
    const matches = scanArrayBufferForOfficialRows(bytes, '6.0-0001');
    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.rowObject.submitter)).toEqual(['A', 'B']);
    expect(matches[0].byteStart).not.toBe(matches[1].byteStart);
  });

  it('rejects malformed, non-array, unclosed, or trailing non-whitespace data', () => {
    const nonArray = encoder.encode('{"ID": "6.0-0001"}');
    expect(() => scanArrayBufferForOfficialRow(nonArray, '6.0-0001')).toThrow(/Expected top-level JSON array/);

    const unclosed = encoder.encode('[{"ID": "6.0-0001"}');
    expect(() => scanArrayBufferForOfficialRow(unclosed, '6.0-0001')).toThrow(/Unclosed top-level/);

    const trailing = encoder.encode('[{"ID": "6.0-0001"}] trailing garbage');
    expect(() => scanArrayBufferForOfficialRow(trailing, '6.0-0001')).toThrow(/Unexpected non-whitespace/);
  });

  it('rejects wrong or missing ID and oversized slice (>16384)', () => {
    const missingId = encoder.encode('[{"Submitter": "A"}]');
    expect(() => scanArrayBufferForOfficialRow(missingId, '6.0-0001')).toThrow(/missing an ID field/);

    const wrongId = encoder.encode('[{"ID": "6.0-0002"}]');
    expect(() => scanArrayBufferForOfficialRow(wrongId, '6.0-0001')).toThrow(/was not found/);

    const largePadding = 'x'.repeat(16500);
    const oversized = encoder.encode(`[{"ID": "6.0-0001", "Padding": "${largePadding}"}]`);
    expect(() => scanArrayBufferForOfficialRow(oversized, '6.0-0001')).toThrow(/exceeds maximum allowed length/);
  });
});

describe('Taxonomy Mask Decoding & Explanations', () => {
  it('decodes contradiction and omission bitmasks deterministically', () => {
    // bit 0 = release, bit 2 = submitter (1 | 4 = 5)
    const decoded = decodeMask('5', CONTRADICTION_AND_OMISSION_KEYS);
    expect(decoded).toEqual(['release', 'submitter']);
  });

  it('decodes incompatible scope mask correctly', () => {
    // bit 0 = unreported_metric, bit 4 = comparative_or_superlative (1 | 16 = 17)
    const decoded = decodeMask('17', INCOMPATIBLE_SCOPE_KEYS);
    expect(decoded).toEqual(['unreported_metric', 'comparative_or_superlative']);
  });

  it('decodes uncertainty mask correctly', () => {
    // bit 3 = claim_source_unavailable, bit 4 = official_source_unavailable (8 | 16 = 24)
    const decoded = decodeMask('24', UNCERTAINTY_KEYS);
    expect(decoded).toEqual(['claim_source_unavailable', 'official_source_unavailable']);
  });

  it('handles invalid or non-decimal mask strings gracefully without crashing', () => {
    expect(decodeMask('invalid', CONTRADICTION_AND_OMISSION_KEYS)).toEqual([]);
    expect(decodeMask('-1', CONTRADICTION_AND_OMISSION_KEYS)).toEqual([]);
  });
});

describe('Contract Configuration Parsing & Zero-Address Rejection', () => {
  it('distinguishes missing, valid, invalid, and zero addresses', () => {
    expect(getContractConfig('')).toEqual({ status: 'missing' });
    expect(getContractConfig('   ')).toEqual({ status: 'missing' });

    const validAddr = '0x1234567890123456789012345678901234567890';
    expect(getContractConfig(validAddr)).toEqual({ status: 'configured', address: validAddr });

    const zeroAddr = '0x0000000000000000000000000000000000000000';
    expect(getContractConfig(zeroAddr)).toEqual({ status: 'invalid', raw: zeroAddr });

    expect(getContractConfig('0xinvalid')).toEqual({ status: 'invalid', raw: '0xinvalid' });
    expect(getContractConfig('0x1234')).toEqual({ status: 'invalid', raw: '0x1234' });
  });
});

describe('Strict Contract JSON Parsing Suite', () => {
  const validOfficial: OfficialRowObject = {
    release: '6.0',
    result_id: '6.0-0001',
    submitter: 'Acme',
    availability: 'available',
    category: 'datacenter',
    suite: 'closed',
    system: 'Sys1',
    platform: 'Ubuntu',
    used_model: 'resnet50',
    model: 'resnet50',
    scenario: 'Server',
    accuracy: '99%',
    nodes: '1',
    processor: 'CPU',
    host_processors_per_node: '2',
    host_processor_core_count: '64',
    accelerator: 'GPU',
    accelerators_per_node: '8',
    total_accelerators: '8',
    software: 'SW',
    operating_system: 'Linux',
    performance_result: '5000',
    performance_units: 'samples/sec',
    has_power: 'false',
    inferred: 'false',
    compliance: '1',
    errors: '0',
  };

  const validClaim: ClaimRecord = {
    id: '1',
    registrant: '0x1111111111111111111111111111111111111111',
    source_url: 'https://example.com',
    exact_claim_text: 'Claim',
    normalized_claim_text: 'Claim',
    claim_fingerprint: 'a'.repeat(64),
    official_result_id: '6.0-0001',
    official_commit: 'b'.repeat(40),
    byte_start: '100',
    byte_end: '500',
    official_row_fingerprint: 'c'.repeat(64),
    official: validOfficial,
    supersedes_claim_id: '0',
    created_at: '2026-08-09T00:00:00Z',
  };

  it('parses valid claim record JSON strictly', () => {
    const parsed = genlayerModule.parseClaimRecordJson(JSON.stringify(validClaim));
    expect(parsed.id).toBe('1');
    expect(parsed.official_result_id).toBe('6.0-0001');
  });

  it('rejects numeric, boolean, or malformed types in claim record fields', () => {
    const invalidId = { ...validClaim, id: 100 };
    expect(() => genlayerModule.parseClaimRecordJson(JSON.stringify(invalidId))).toThrow(/canonical unsigned decimal string/);

    const invalidAddress = { ...validClaim, registrant: 'not-an-address' };
    expect(() => genlayerModule.parseClaimRecordJson(JSON.stringify(invalidAddress))).toThrow(/valid 20-byte hex address/);

    const invalidCommit = { ...validClaim, official_commit: 'short' };
    expect(() => genlayerModule.parseClaimRecordJson(JSON.stringify(invalidCommit))).toThrow(/40-character lowercase hex/);
  });

  it('parses valid assessment record JSON strictly and rejects invalid outcomes', () => {
    const validAssessment: AssessmentRecord = {
      id: '1',
      claim_id: '1',
      assessor: '0x2222222222222222222222222222222222222222',
      official_result_id: '6.0-0001',
      official_commit: 'b'.repeat(40),
      byte_start: '100',
      byte_end: '500',
      official_row_fingerprint: 'c'.repeat(64),
      contradiction_mask: '0',
      material_omission_mask: '0',
      incompatible_scope_mask: '0',
      uncertainty_mask: '0',
      outcome: 'SUPPORTED',
      prior_attempt_id: '0',
      prior_resolved_id: '0',
      created_at: '2026-08-09T00:00:00Z',
    };

    const parsed = genlayerModule.parseAssessmentRecordJson(JSON.stringify(validAssessment));
    expect(parsed.outcome).toBe('SUPPORTED');

    const invalidOutcome = { ...validAssessment, outcome: 'INVALID_VERDICT' };
    expect(() => genlayerModule.parseAssessmentRecordJson(JSON.stringify(invalidOutcome))).toThrow(/Invalid assessment outcome/);
  });

  it('parses latest assessment strictly with null checks and paginated claims', () => {
    const latestResp = { latest_attempt: null, latest_resolved: null };
    const parsedLatest = genlayerModule.parseLatestAssessmentJson(JSON.stringify(latestResp));
    expect(parsedLatest.latest_attempt).toBeNull();
    expect(parsedLatest.latest_resolved).toBeNull();

    // Reject non-null falsy or invalid representations
    expect(() => genlayerModule.parseLatestAssessmentJson(JSON.stringify({ latest_attempt: 0, latest_resolved: null }))).toThrow();
    expect(() => genlayerModule.parseLatestAssessmentJson(JSON.stringify({ latest_attempt: false, latest_resolved: null }))).toThrow();
    expect(() => genlayerModule.parseLatestAssessmentJson(JSON.stringify({ latest_attempt: '', latest_resolved: null }))).toThrow();

    const paginated = { cursor: '0', items: [validClaim], next_cursor: '1', total: '1' };
    const parsedPaginated = genlayerModule.parsePaginatedClaimsJson(JSON.stringify(paginated));
    expect(parsedPaginated.items.length).toBe(1);
  });
});

describe('Transaction Hash & URL Normalization', () => {
  it('yields one browser task so the wallet-wait UI can render before provider invocation', async () => {
    vi.useFakeTimers();
    let resolved = false;
    const pending = waitForWalletUiReady().then(() => { resolved = true; });

    await Promise.resolve();
    expect(resolved).toBe(false);
    await vi.runAllTimersAsync();
    await pending;
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });

  it('validates 66-character TransactionHash strictly', () => {
    const validHash = ('0x' + 'f'.repeat(64)) as TransactionHash;
    expect(validateTransactionHash(validHash)).toBe(validHash);

    expect(() => validateTransactionHash('0x1234')).toThrow(/Invalid transaction hash/);
    expect(() => validateTransactionHash('not-a-hash')).toThrow();
  });

  it('normalizes source URL exactly like contract', () => {
    expect(normalizeSourceUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeSourceUrl('https://EXAMPLE.COM:443/path?query=1#frag')).toBe('https://example.com/path?query=1');
    expect(() => normalizeSourceUrl('http://insecure.com')).toThrow(/HTTPS/);
    expect(() => normalizeSourceUrl('https://user:pass@example.com')).toThrow(/credentials/);
    expect(() => normalizeSourceUrl('https://127.0.0.1')).toThrow(/IP literals/);
  });
});

describe('Finality Pipeline & Readback Validation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv('VITE_CONTRACT_ADDRESS', '0x1c955908BFE8E157F5a78131E8D04654eD3EA6E8');
    vi.restoreAllMocks();
  });

  const sampleOp: PendingOperation = {
    version: 2,
    txHash: ('0x' + 'a'.repeat(64)) as TransactionHash,
    operationKind: 'register_claim',
    chainId: chainInfo.id,
    contractAddress: '0x1c955908BFE8E157F5a78131E8D04654eD3EA6E8',
    account: '0x2222222222222222222222222222222222222222',
    expectedBinding: {
      source_url: 'https://example.com/',
      exact_claim_text: 'Claim',
      official_result_id: '6.0-0001',
      official_commit: 'b'.repeat(40),
      byte_start: '100',
      byte_end: '500',
      supersedes_claim_id: '0',
    },
    timestamp: Date.now(),
  };

  it('submits through the explicitly selected provider without invoking SDK snap connect', async () => {
    const providerRequest = vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return Promise.resolve([sampleOp.account]);
      if (method === 'eth_chainId') return Promise.resolve(`0x${chainInfo.id.toString(16)}`);
      return Promise.reject(new Error(`Unexpected provider method: ${method}`));
    });
    await walletManager.connectProvider({
      info: { uuid: 'selected-provider', name: 'Selected Provider', icon: '', rdns: 'selected.provider' },
      provider: { request: providerRequest },
    });

    const txHash = ('0x' + 'c'.repeat(64)) as TransactionHash;
    const connectMock = vi.fn();
    const writeContractMock = vi.fn().mockResolvedValue(txHash);
    const estimateMock = vi.fn().mockResolvedValue({ feeValue: 12n, distribution: { appealRounds: 1n } });
    vi.spyOn(walletManager, 'getWriteClient').mockReturnValue({
      connect: connectMock,
      writeContract: writeContractMock,
      estimateTransactionFees: estimateMock,
    } as unknown as ReturnType<typeof walletManager.getWriteClient>);
    vi.spyOn(genlayerModule.readClient, 'waitForTransactionReceipt').mockResolvedValue({
      lifecycle: { state: 'finalized', outcome: 'accepted' },
      status: TransactionStatus.FINALIZED,
      statusName: TransactionStatus.FINALIZED,
      resultName: TransactionResult.MAJORITY_AGREE,
      txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
    });
    vi.spyOn(genlayerModule.readClient, 'getTransaction').mockResolvedValue({
      lifecycle: { state: 'finalized', outcome: 'accepted' },
      hash: txHash,
      to_address: sampleOp.contractAddress,
      from_address: sampleOp.account,
    });
    const traceMock = vi.spyOn(genlayerModule.readClient, 'debugTraceTransaction').mockRejectedValue(new Error('Method not found'));
    const assessmentRecord: AssessmentRecord = {
      id: '7',
      claim_id: '1',
      assessor: sampleOp.account,
      official_result_id: '6.0-0001',
      official_commit: 'b'.repeat(40),
      byte_start: '100',
      byte_end: '500',
      official_row_fingerprint: 'c'.repeat(64),
      contradiction_mask: '0',
      material_omission_mask: '0',
      incompatible_scope_mask: '0',
      uncertainty_mask: '0',
      outcome: 'SUPPORTED',
      prior_attempt_id: '0',
      prior_resolved_id: '0',
      created_at: new Date(Date.now() + 1_000).toISOString(),
    };
    vi.spyOn(genlayerModule, 'fetchLatestAssessment').mockResolvedValue({
      latest_attempt: assessmentRecord,
      latest_resolved: assessmentRecord,
    });
    vi.spyOn(genlayerModule, 'fetchAssessment').mockResolvedValue(assessmentRecord);

    const stages: string[] = [];
    const result = await executeContractWrite(
      'assess_claim',
      [1n],
      {
        claim_id: '1',
        official_result_id: '6.0-0001',
        official_commit: 'b'.repeat(40),
        byte_start: '100',
        byte_end: '500',
      },
      (stage) => stages.push(stage),
      async (quote) => quote.feeValue === 12n
    );

    expect(result.txHash).toBe(txHash);
    expect(stages).toEqual([
      'WAITING_FOR_WALLET',
      'SUBMITTED',
      'WAITING_FOR_FINALITY',
      'VERIFYING_EXECUTION',
      'VERIFYING_READBACK',
      'SUCCESS',
    ]);
    expect(connectMock).not.toHaveBeenCalled();
    expect(writeContractMock).toHaveBeenCalledOnce();
    expect(estimateMock).toHaveBeenCalledWith({ executionBudgetPerRound: 155153100000000n });
    expect(writeContractMock).toHaveBeenCalledWith(expect.objectContaining({
      fees: { distribution: { appealRounds: 1n }, feeValue: 12n },
    }));
    expect(traceMock).not.toHaveBeenCalled();
    expect(providerRequest).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'wallet_getSnaps' }));
    walletManager.disconnect();
  });

  it('requires fee review before signing and never submits a cancelled quote', async () => {
    await walletManager.connectProvider({
      info: { uuid: 'fee-provider', name: 'Fee Provider', icon: '', rdns: 'fee.provider' },
      provider: { request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve([sampleOp.account]);
        if (method === 'eth_chainId') return Promise.resolve(`0x${chainInfo.id.toString(16)}`);
        return Promise.reject(new Error(`Unexpected provider method: ${method}`));
      }) },
    });
    const writeContract = vi.fn();
    vi.spyOn(walletManager, 'getWriteClient').mockReturnValue({
      estimateTransactionFees: vi.fn().mockResolvedValue({ feeValue: 42n, distribution: { appealRounds: 1n } }),
      writeContract,
    } as unknown as ReturnType<typeof walletManager.getWriteClient>);

    await expect(executeContractWrite(
      'assess_claim',
      [1n],
      { claim_id: '1', official_result_id: '6.0-0001', official_commit: 'b'.repeat(40), byte_start: '100', byte_end: '500' },
      () => {},
      async (quote) => {
        expect(quote.feeValue).toBe(42n);
        return false;
      }
    )).rejects.toThrow(/Fee review cancelled/);
    expect(writeContract).not.toHaveBeenCalled();
    expect(localStorage.getItem('lumen_pending_op_v2')).toBeNull();
    walletManager.disconnect();
  });

  it('retains an ambiguous pre-hash wallet lock and blocks duplicate submission', async () => {
    await walletManager.connectProvider({
      info: { uuid: 'ambiguous-provider', name: 'Ambiguous Provider', icon: '', rdns: 'ambiguous.provider' },
      provider: { request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve([sampleOp.account]);
        if (method === 'eth_chainId') return Promise.resolve(`0x${chainInfo.id.toString(16)}`);
        return Promise.reject(new Error(`Unexpected provider method: ${method}`));
      }) },
    });
    const writeContract = vi.fn().mockRejectedValue(new Error('transport interrupted'));
    const estimate = vi.fn().mockResolvedValue({ feeValue: 42n, distribution: { appealRounds: 1n } });
    vi.spyOn(walletManager, 'getWriteClient').mockReturnValue({
      estimateTransactionFees: estimate,
      writeContract,
    } as unknown as ReturnType<typeof walletManager.getWriteClient>);
    const stages: string[] = [];
    const invoke = () => executeContractWrite(
      'assess_claim',
      [1n],
      { claim_id: '1', official_result_id: '6.0-0001', official_commit: 'b'.repeat(40), byte_start: '100', byte_end: '500' },
      (stage) => stages.push(stage),
      async () => true
    );

    await expect(invoke()).rejects.toThrow(/transport interrupted/);
    expect(stages.at(-1)).toBe('RECONCILIATION_REQUIRED');
    expect(localStorage.getItem('lumen_pending_op_v2')).toContain('awaitingWalletResult');
    await expect(invoke()).rejects.toThrow(/pending reconciliation/);
    expect(writeContract).toHaveBeenCalledOnce();
    clearPendingOperation();
    walletManager.disconnect();
  });

  it('persists and loads pending operations across session-storage resets', () => {
    savePendingOperation(sampleOp);
    sessionStorage.clear();
    expect(loadPendingOperation()).toEqual(sampleOp);

    clearPendingOperation();
    expect(loadPendingOperation()).toBeNull();
  });

  it('rejects malformed, zero-address, or unversioned pending operations in storage', () => {
    localStorage.setItem('lumen_pending_op_v2', JSON.stringify({ version: 1 }));
    expect(loadPendingOperation()).toBeNull();

    localStorage.setItem(
      'lumen_pending_op_v2',
      JSON.stringify({ ...sampleOp, contractAddress: '0x0000000000000000000000000000000000000000' })
    );
    expect(loadPendingOperation()).toBeNull();

    localStorage.setItem(
      'lumen_pending_op_v2',
      JSON.stringify({ ...sampleOp, chainId: chainInfo.id + 1 })
    );
    expect(loadPendingOperation()).toBeNull();
  });

  it('enforces FINALIZED, MAJORITY_AGREE, and FINISHED_WITH_RETURN gate in pipeline', async () => {
    // 1. Rejects non-finalized
    const nonFinalizedReceipt: GenLayerTransaction = {
      lifecycle: { state: 'processing', phase: 'pending' },
      status: TransactionStatus.PENDING,
      statusName: TransactionStatus.PENDING,
      resultName: TransactionResult.MAJORITY_AGREE,
      txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
    };

    vi.spyOn(genlayerModule.readClient, 'waitForTransactionReceipt').mockResolvedValue(nonFinalizedReceipt);
    await expect(processTransactionFinalityAndReadback(sampleOp.txHash, sampleOp, () => {})).rejects.toThrow(/Non-finalized status/);

    // A legacy FINALIZED status cannot override the SDK's current lifecycle.
    vi.spyOn(genlayerModule.readClient, 'waitForTransactionReceipt').mockResolvedValue({
      ...nonFinalizedReceipt,
      status: TransactionStatus.FINALIZED,
      statusName: TransactionStatus.FINALIZED,
    });
    await expect(processTransactionFinalityAndReadback(sampleOp.txHash, sampleOp, () => {})).rejects.toThrow(/Non-finalized status/);

    // 2. Rejects consensus disagreement
    const disagreeReceipt: GenLayerTransaction = {
      lifecycle: { state: 'finalized', outcome: 'accepted' },
      status: TransactionStatus.FINALIZED,
      statusName: TransactionStatus.FINALIZED,
      resultName: TransactionResult.DISAGREE,
      txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
    };

    vi.spyOn(genlayerModule.readClient, 'waitForTransactionReceipt').mockResolvedValue(disagreeReceipt);
    await expect(processTransactionFinalityAndReadback(sampleOp.txHash, sampleOp, () => {})).rejects.toThrow(/Consensus disagreement/);

    // 3. Rejects FINISHED_WITH_ERROR
    const errorReceipt: GenLayerTransaction = {
      lifecycle: { state: 'finalized', outcome: 'accepted' },
      status: TransactionStatus.FINALIZED,
      statusName: TransactionStatus.FINALIZED,
      resultName: TransactionResult.MAJORITY_AGREE,
      txExecutionResultName: ExecutionResult.FINISHED_WITH_ERROR,
    };

    vi.spyOn(genlayerModule.readClient, 'waitForTransactionReceipt').mockResolvedValue(errorReceipt);
    await expect(processTransactionFinalityAndReadback(sampleOp.txHash, sampleOp, () => {})).rejects.toThrow(/Execution finished with error/);

    // 4. A missing execution result is uncertainty, never success. Retain the
    // recovery lock so the same hash can be reconciled without resubmission.
    const missingExecutionReceipt: GenLayerTransaction = {
      lifecycle: { state: 'finalized', outcome: 'accepted' },
      status: TransactionStatus.FINALIZED,
      statusName: TransactionStatus.FINALIZED,
      resultName: TransactionResult.MAJORITY_AGREE,
    };
    const stages: string[] = [];
    savePendingOperation(sampleOp);
    vi.spyOn(genlayerModule.readClient, 'waitForTransactionReceipt').mockResolvedValue(missingExecutionReceipt);
    vi.spyOn(genlayerModule.readClient, 'getTransaction').mockResolvedValue({
      lifecycle: { state: 'finalized', outcome: 'accepted' },
      hash: sampleOp.txHash,
      to_address: sampleOp.contractAddress,
      from_address: sampleOp.account,
      resultName: TransactionResult.MAJORITY_AGREE,
    });
    await expect(processTransactionFinalityAndReadback(sampleOp.txHash, sampleOp, stage => stages.push(stage))).rejects.toThrow(/Execution result unavailable/);
    expect(stages).toContain('RECONCILIATION_REQUIRED');
    expect(stages).not.toContain('SUCCESS');
    expect(loadPendingOperation()?.txHash).toBe(sampleOp.txHash);
  });

  it('verifies exact readback binding for registration and detects mismatches', async () => {
    const claimData: ClaimRecord = {
      id: '5',
      registrant: sampleOp.account,
      source_url: 'https://example.com/',
      exact_claim_text: 'Claim',
      normalized_claim_text: 'Claim',
      claim_fingerprint: 'a'.repeat(64),
      official_result_id: '6.0-0001',
      official_commit: 'b'.repeat(40),
      byte_start: '100',
      byte_end: '500',
      official_row_fingerprint: 'c'.repeat(64),
      official: {} as OfficialRowObject,
      supersedes_claim_id: '0',
      created_at: '2026-08-09T00:00:00Z',
    };

    vi.spyOn(genlayerModule, 'fetchClaim').mockResolvedValue(claimData);

    const result = await verifyAndReadbackRecord(sampleOp, '5');
    expect(result.recordId).toBe('5');

    // Mismatch on registrant
    const mismatchOp: PendingOperation = { ...sampleOp, account: '0x3333333333333333333333333333333333333333' };
    await expect(verifyAndReadbackRecord(mismatchOp, '5')).rejects.toThrow(/registrant address does not match/);

    // Mismatch on source_url
    const urlMismatchOp: PendingOperation = {
      ...sampleOp,
      expectedBinding: { ...sampleOp.expectedBinding, source_url: 'https://other.com/' },
    };
    await expect(verifyAndReadbackRecord(urlMismatchOp, '5')).rejects.toThrow(/Readback mismatch on source_url/);
  });

  it('verifies exact readback binding for assessment and detects mismatches', async () => {
    const assessOp: PendingOperation = {
      version: 2,
      txHash: ('0x' + 'b'.repeat(64)) as TransactionHash,
      operationKind: 'assess_claim',
      chainId: chainInfo.id,
      contractAddress: '0x1111111111111111111111111111111111111111',
      account: '0x2222222222222222222222222222222222222222',
      expectedBinding: {
        claim_id: '1',
        official_result_id: '6.0-0001',
        official_commit: 'b'.repeat(40),
        byte_start: '100',
        byte_end: '500',
      },
      timestamp: Date.now(),
    };

    const assessData: AssessmentRecord = {
      id: '8',
      claim_id: '1',
      assessor: assessOp.account,
      official_result_id: '6.0-0001',
      official_commit: 'b'.repeat(40),
      byte_start: '100',
      byte_end: '500',
      official_row_fingerprint: 'c'.repeat(64),
      contradiction_mask: '0',
      material_omission_mask: '0',
      incompatible_scope_mask: '0',
      uncertainty_mask: '0',
      outcome: 'SUPPORTED',
      prior_attempt_id: '0',
      prior_resolved_id: '0',
      created_at: '2026-08-09T00:00:00Z',
    };

    vi.spyOn(genlayerModule, 'fetchAssessment').mockResolvedValue(assessData);

    const result = await verifyAndReadbackRecord(assessOp, '8');
    expect(result.recordId).toBe('8');

    // Mismatch on claim_id
    const mismatchAssessOp: PendingOperation = {
      ...assessOp,
      expectedBinding: { ...assessOp.expectedBinding, claim_id: '99' },
    };
    await expect(verifyAndReadbackRecord(mismatchAssessOp, '8')).rejects.toThrow(/Readback mismatch on claim_id/);
  });

  it('rejects stale config and wrong-contract reuse, then reconciles the exact transaction idempotently', async () => {
    vi.stubEnv('VITE_CONTRACT_ADDRESS', '0x3333333333333333333333333333333333333333');
    await expect(processTransactionFinalityAndReadback(sampleOp.txHash, sampleOp, () => {})).rejects.toThrow(/configured deployment/);

    vi.stubEnv('VITE_CONTRACT_ADDRESS', sampleOp.contractAddress);
    const finalizedReceipt: GenLayerTransaction = {
      lifecycle: { state: 'finalized', outcome: 'accepted' },
      status: 7,
    };
    vi.spyOn(genlayerModule.readClient, 'waitForTransactionReceipt').mockResolvedValue(finalizedReceipt);
    vi.spyOn(genlayerModule.readClient, 'getTransaction').mockResolvedValue({
      lifecycle: { state: 'finalized', outcome: 'accepted' },
      hash: sampleOp.txHash,
      to_address: '0x3333333333333333333333333333333333333333',
      from_address: sampleOp.account,
      resultName: TransactionResult.MAJORITY_AGREE,
      txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
    });
    await expect(processTransactionFinalityAndReadback(sampleOp.txHash, sampleOp, () => {})).rejects.toThrow(/target/);

    vi.mocked(genlayerModule.readClient.getTransaction).mockResolvedValue({
      lifecycle: { state: 'finalized', outcome: 'accepted' },
      hash: sampleOp.txHash,
      to_address: sampleOp.contractAddress,
      from_address: sampleOp.account,
      resultName: TransactionResult.MAJORITY_AGREE,
      txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
    });
    const traceMock = vi.spyOn(genlayerModule.readClient, 'debugTraceTransaction').mockRejectedValue(new Error('Method not found'));
    const claimRecord: ClaimRecord = {
      id: '5',
      registrant: sampleOp.account,
      source_url: 'https://example.com/',
      exact_claim_text: 'Claim',
      normalized_claim_text: 'Claim',
      claim_fingerprint: 'a'.repeat(64),
      official_result_id: '6.0-0001',
      official_commit: 'b'.repeat(40),
      byte_start: '100',
      byte_end: '500',
      official_row_fingerprint: 'c'.repeat(64),
      official: {} as OfficialRowObject,
      supersedes_claim_id: '0',
      created_at: new Date(sampleOp.timestamp + 1_000).toISOString(),
    };
    vi.spyOn(genlayerModule, 'fetchClaims').mockResolvedValue({
      cursor: '0',
      items: [claimRecord],
      next_cursor: null,
      total: '1',
    });
    vi.spyOn(genlayerModule, 'fetchClaim').mockResolvedValue(claimRecord);

    savePendingOperation(sampleOp);
    const first = await processTransactionFinalityAndReadback(sampleOp.txHash, sampleOp, () => {});
    const duplicate = await processTransactionFinalityAndReadback(sampleOp.txHash, sampleOp, () => {});
    expect(first.recordId).toBe('5');
    expect(duplicate.recordId).toBe('5');
    expect(traceMock).not.toHaveBeenCalled();
    expect(loadPendingOperation()).toBeNull();
  });
});
