import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import App, { SearchDialog, WalletModal, RegistryPage, ClaimDetailPage, RegisterPage, NotFoundPage, MainApp, TransactionProgress } from './App';
import { walletManager, EIP1193Provider, EIP6963ProviderDetail } from './wallet';
import { ClaimRecord, LatestAssessmentResponse, AssessmentRecord, OfficialRowObject } from './types';
import * as configModule from './config';
import * as genlayerModule from './genlayer';
import * as officialRowModule from './officialRow';
import * as txModule from './transaction';
import type { TransactionHash } from 'genlayer-js/types';
import type { RowScanResult } from './officialRow';
import { PublicLanding } from './PublicSite';

describe('App Component and Navigation Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  const sampleOfficial: OfficialRowObject = {
    release: '6.0',
    result_id: '6.0-0001',
    submitter: 'Acme Hardware',
    availability: 'available',
    category: 'datacenter',
    suite: 'closed',
    system: 'SuperServer X1',
    platform: 'Ubuntu 24.04',
    used_model: 'resnet50',
    model: 'resnet50',
    scenario: 'Server',
    accuracy: '99%',
    nodes: '1',
    processor: 'Host CPU',
    host_processors_per_node: '2',
    host_processor_core_count: '64',
    accelerator: 'GPU-T1',
    accelerators_per_node: '8',
    total_accelerators: '8',
    software: 'DeepLib v1',
    operating_system: 'Linux',
    performance_result: '5000.5',
    performance_units: 'samples/sec',
    has_power: 'false',
    inferred: 'false',
    compliance: '1',
    errors: '0',
  };

  const sampleClaim: ClaimRecord = {
    id: '1',
    registrant: '0x1234567890abcdef1234567890abcdef12345678',
    source_url: 'https://example.com/announcement',
    exact_claim_text: 'Fastest ResNet50 Server Inference',
    normalized_claim_text: 'Fastest ResNet50 Server Inference',
    claim_fingerprint: 'a'.repeat(64),
    official_result_id: '6.0-0001',
    official_commit: '4d3916ac9cf474b679cdfcf492d43a0559418ad1',
    byte_start: '100',
    byte_end: '500',
    official_row_fingerprint: 'c'.repeat(64),
    official: sampleOfficial,
    supersedes_claim_id: '0',
    created_at: '2026-08-09T00:00:00Z',
  };

  const scanRow = (byteStart: number, identity: Partial<OfficialRowObject> = {}): RowScanResult => ({
    byteStart,
    byteEnd: byteStart + 99,
    sliceLength: 100,
    rowObject: { ...sampleOfficial, ...identity },
  });

  const renderClaimDetail = () => {
    vi.spyOn(genlayerModule, 'fetchClaim').mockResolvedValue(sampleClaim);
    vi.spyOn(genlayerModule, 'fetchLatestAssessment').mockResolvedValue({ latest_attempt: null, latest_resolved: null });
    vi.spyOn(genlayerModule, 'fetchClaimAssessments').mockResolvedValue({ cursor: '0', items: [], next_cursor: null, total: '0' });

    render(
      <MemoryRouter initialEntries={['/claims/1']}>
        <Routes>
          <Route path="/claims/:claimId" element={<ClaimDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders empty registry without fabricated records', () => {
    render(
      <MemoryRouter>
        <RegistryPage
          claims={[]}
          latestAssessments={new Map()}
          onLoadMore={() => {}}
          nextCursor={null}
          loading={false}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/Official Claims Registry/i)).toBeInTheDocument();
    expect(screen.getByText(/No claims have been registered/i)).toBeInTheDocument();
  });

  it.each(['WAITING_FOR_WALLET', 'SUBMITTED', 'WAITING_FOR_FINALITY', 'VERIFYING_EXECUTION', 'VERIFYING_READBACK'] as const)(
    '%s displays explicit status text and a pending spinner',
    (stage) => {
      const { container } = render(<TransactionProgress stage={stage} error={null} hash={null} />);
      expect(container.querySelector(`[data-transaction-phase="${stage}"]`)).toHaveAttribute('role', 'status');
      expect(container.querySelector('.transaction-progress__spinner')).toBeInTheDocument();
    }
  );

  it.each(['SUCCESS', 'REJECTED', 'FAILED', 'RECONCILIATION_REQUIRED'] as const)(
    '%s stops the pending spinner',
    (stage) => {
      const { container } = render(<TransactionProgress stage={stage} error={null} hash={null} />);
      expect(container.querySelector('.transaction-progress__spinner')).not.toBeInTheDocument();
    }
  );

  it('renders no transaction region while idle', () => {
    const { container } = render(<TransactionProgress stage="IDLE" error={null} hash={null} />);
    expect(container.querySelector('[data-transaction-phase]')).not.toBeInTheDocument();
  });

  it('shows copy and Explorer actions whenever a transaction hash exists', () => {
    vi.spyOn(configModule, 'getExplorerTxUrl').mockReturnValue(`https://explorer.example/tx/0x${'a'.repeat(64)}`);
    render(<TransactionProgress stage="SUCCESS" error={null} hash={`0x${'a'.repeat(64)}`} />);
    expect(screen.getByRole('button', { name: 'Copy hash' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View transaction' })).toHaveAttribute('href', expect.stringContaining(`/tx/0x${'a'.repeat(64)}`));
  });

  it('shows honest loading copy instead of a premature UNASSESSED verdict', () => {
    render(
      <MemoryRouter>
        <RegistryPage claims={[sampleClaim]} latestAssessments={new Map()} onLoadMore={() => {}} nextCursor={null} loading={true} />
      </MemoryRouter>
    );
    expect(screen.getByText('Loading records…')).toBeInTheDocument();
    expect(screen.getByText('CHECKING')).toBeInTheDocument();
    expect(screen.queryByText('UNASSESSED')).not.toBeInTheDocument();
  });

  it('declares intrinsic dimensions for public brand images', () => {
    const { container } = render(<MemoryRouter><PublicLanding /></MemoryRouter>);
    for (const image of Array.from(container.querySelectorAll('img'))) {
      expect(image).toHaveAttribute('width');
      expect(image).toHaveAttribute('height');
    }
  });

  it('does not request wallet access on read-only route views', () => {
    const ethMock: EIP1193Provider = { request: vi.fn().mockResolvedValue([]) };
    (window as unknown as { ethereum: EIP1193Provider }).ethereum = ethMock;

    render(<App />);

    expect(ethMock.request).not.toHaveBeenCalled();
  });

  it('visibly discloses when deployment configuration is missing and performs no RPC', () => {
    vi.spyOn(configModule, 'getContractConfig').mockReturnValue({ status: 'missing' });
    const rpcSpy = vi.spyOn(genlayerModule, 'fetchClaims');

    render(
      <MemoryRouter>
        <RegistryPage
          claims={[]}
          latestAssessments={new Map()}
          onLoadMore={() => {}}
          nextCursor={null}
          loading={false}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/Deployment not configured/i)).toBeInTheDocument();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('opens provider choices on Connect wallet click even with one provider and does not auto-request accounts', async () => {
    const requestMock = vi.fn().mockResolvedValue(['0x1111111111111111111111111111111111111111']);
    const dummyProvider: EIP1193Provider = { request: requestMock };

    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <WalletModal isOpen={true} onClose={onClose} />
      </MemoryRouter>
    );

    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: { uuid: 'prov-1', name: 'Mock Alpha Wallet', icon: '', rdns: 'alpha.wallet' },
          provider: dummyProvider,
        },
      })
    );

    expect(requestMock).not.toHaveBeenCalled();

    const providerBtn = await screen.findByText('Mock Alpha Wallet');
    fireEvent.click(providerBtn);

    expect(requestMock).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
  });

  it('closing wallet modal sends no account request', () => {
    const requestMock = vi.fn();
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <WalletModal isOpen={true} onClose={onClose} />
      </MemoryRouter>
    );

    const closeBtn = screen.getByLabelText(/Close dialog/i);
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('selecting second provider uses that provider only and deduplicates provider announcements', async () => {
    const request1 = vi.fn().mockResolvedValue(['0x1111111111111111111111111111111111111111']);
    const request2 = vi.fn().mockResolvedValue(['0x2222222222222222222222222222222222222222']);

    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <WalletModal isOpen={true} onClose={onClose} />
      </MemoryRouter>
    );

    // Dispatch duplicate announcement with same RDNS
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: { uuid: 'prov-1', name: 'Provider 1', icon: '', rdns: 'prov1.rdns' },
          provider: { request: request1 },
        },
      })
    );
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: { uuid: 'prov-1-dup', name: 'Provider 1 Dup', icon: '', rdns: 'prov1.rdns' },
          provider: { request: request1 },
        },
      })
    );
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: { uuid: 'prov-2', name: 'Provider 2', icon: '', rdns: 'prov2.rdns' },
          provider: { request: request2 },
        },
      })
    );

    const btn2 = await screen.findByText('Provider 2');
    fireEvent.click(btn2);

    expect(request2).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    expect(request1).not.toHaveBeenCalled();
  });

  it('account or provider change during active write fails safely and prevents success', async () => {
    const dummyProvider: EIP6963ProviderDetail = {
      info: { uuid: 'prov-1', name: 'Provider 1', icon: '', rdns: 'prov1.rdns' },
      provider: {
        request: vi.fn().mockImplementation((args: { method: string }) => {
          if (args.method === 'eth_requestAccounts') return Promise.resolve(['0x1111111111111111111111111111111111111111']);
          if (args.method === 'eth_chainId') return Promise.resolve('0x1');
          return Promise.resolve(null);
        }),
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    };

    await walletManager.connectProvider(dummyProvider);

    let stageResult = '';
    const executePromise = txModule.executeContractWrite(
      'register_claim',
      ['https://example.com', 'text', '6.0-0001', 'b'.repeat(40), 100n, 500n, 0n],
      {
        source_url: 'https://example.com',
        exact_claim_text: 'text',
        official_result_id: '6.0-0001',
        official_commit: 'b'.repeat(40),
        byte_start: '100',
        byte_end: '500',
        supersedes_claim_id: '0',
      },
      (stage) => {
        stageResult = stage;
      },
      async () => true
    );

    // Simulate provider disconnect/change during signing
    walletManager.disconnect();

    await expect(executePromise).rejects.toThrow();
    expect(stageResult).not.toBe('success');
  });

  it('search dialog opens by click, Ctrl+K, and Cmd+K', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <button id="search-trigger-btn">Search</button>
        <SearchDialog isOpen={true} onClose={onClose} claims={[sampleClaim]} />
      </MemoryRouter>
    );

    expect(screen.getByText(/Search Loaded Claims/i)).toBeInTheDocument();
  });

  it('search dialog navigates with ArrowDown, ArrowUp, Enter, and restores focus on Escape', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <button id="search-trigger-btn">Search</button>
        <SearchDialog isOpen={true} onClose={onClose} claims={[sampleClaim]} />
      </MemoryRouter>
    );

    const searchInput = screen.getByPlaceholderText(/Filter by Claim ID/i);
    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
    fireEvent.keyDown(searchInput, { key: 'ArrowUp' });
    fireEvent.keyDown(searchInput, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('invalidates stale official scan when result ID or commit SHA is edited', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );

    const resultInput = screen.getByLabelText(/Official Result ID/i);
    fireEvent.change(resultInput, { target: { value: '6.0-0002' } });

    // Submit button should not be present without fresh scan
    expect(screen.queryByText(/2\. Register claim on Studio Devnet/i)).not.toBeInTheDocument();

    const commitInput = screen.getByLabelText(/Official Repository Commit SHA/i);
    expect(commitInput).toHaveValue('');
    fireEvent.change(commitInput, { target: { value: 'a'.repeat(40) } });
    expect(screen.queryByText(/2\. Register claim on Studio Devnet/i)).not.toBeInTheDocument();
  });

  it('blocks non-HTTPS source URLs before scanning official evidence', async () => {
    const locateSpy = vi.spyOn(officialRowModule, 'locateOfficialRows');
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText(/Public Source HTTPS URL/i), { target: { value: 'http://example.com/claim' } });
    fireEvent.change(screen.getByLabelText(/Exact Frozen Claim Text/i), { target: { value: 'Exact public claim' } });
    fireEvent.change(screen.getByLabelText(/Official Repository Commit SHA/i), { target: { value: 'a'.repeat(40) } });
    fireEvent.click(screen.getByRole('button', { name: /Locate official row/i }));

    expect(await screen.findByText('Source URL must use HTTPS.')).toHaveAttribute('role', 'alert');
    expect(locateSpy).not.toHaveBeenCalled();
  });

  it('blocks duplicate-ID registration until the user explicitly selects a row', async () => {
    vi.spyOn(officialRowModule, 'locateOfficialRows').mockResolvedValue([
      scanRow(100),
      scanRow(300, { model: 'gpt-oss-120b', scenario: 'Offline' }),
    ]);

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/Public Source HTTPS URL/i), { target: { value: 'https://example.com/claim' } });
    fireEvent.change(screen.getByLabelText(/Exact Frozen Claim Text/i), { target: { value: 'Exact public claim' } });
    fireEvent.change(screen.getByLabelText(/Official Repository Commit SHA/i), { target: { value: 'a'.repeat(40) } });
    fireEvent.click(screen.getByRole('button', { name: /Locate official row/i }));

    const selector = await screen.findByLabelText('Official Result Row');
    expect(selector).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Register claim on Studio Devnet/i })).not.toBeInTheDocument();

    fireEvent.change(selector, { target: { value: '300' } });
    expect(screen.getByRole('button', { name: /Register claim on Studio Devnet/i })).toBeInTheDocument();
  });

  it('defaults reassessment only to the exact system, model, and scenario identity', async () => {
    vi.spyOn(officialRowModule, 'locateOfficialRows').mockResolvedValue([
      scanRow(100, { system: 'Other system' }),
      scanRow(300),
    ]);
    renderClaimDetail();

    fireEvent.change(await screen.findByLabelText(/Newer Official Commit SHA/i), { target: { value: 'b'.repeat(40) } });
    fireEvent.click(screen.getByRole('button', { name: /Locate row in newer commit/i }));

    expect(await screen.findByLabelText('Official Result Row')).toHaveValue('300');
    expect(screen.getByRole('button', { name: /Submit Reassessment/i })).toBeInTheDocument();
  });

  it('blocks reassessment until explicit selection when no exact identity exists', async () => {
    vi.spyOn(officialRowModule, 'locateOfficialRows').mockResolvedValue([
      scanRow(100, { system: 'Other system' }),
      scanRow(300, { model: 'other-model' }),
    ]);
    renderClaimDetail();

    fireEvent.change(await screen.findByLabelText(/Newer Official Commit SHA/i), { target: { value: 'b'.repeat(40) } });
    fireEvent.click(screen.getByRole('button', { name: /Locate row in newer commit/i }));

    const selector = await screen.findByLabelText('Official Result Row');
    expect(selector).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Submit Reassessment/i })).not.toBeInTheDocument();

    fireEvent.change(selector, { target: { value: '100' } });
    expect(screen.getByRole('button', { name: /Submit Reassessment/i })).toBeInTheDocument();
  });

  it('invalidates stale reassessment scan when commit SHA is edited in detail page', () => {
    vi.spyOn(genlayerModule, 'fetchClaim').mockResolvedValue(sampleClaim);
    vi.spyOn(genlayerModule, 'fetchLatestAssessment').mockResolvedValue({ latest_attempt: null, latest_resolved: null });
    vi.spyOn(genlayerModule, 'fetchClaimAssessments').mockResolvedValue({ cursor: '0', items: [], next_cursor: null, total: '0' });

    render(
      <MemoryRouter initialEntries={['/claims/1']}>
        <Routes>
          <Route path="/claims/:claimId" element={<ClaimDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Loading claim details/i)).toBeInTheDocument();
  });

  it('renders one resumed transaction result in the claim actions slot', async () => {
    vi.spyOn(genlayerModule, 'fetchClaim').mockResolvedValue(sampleClaim);
    vi.spyOn(genlayerModule, 'fetchLatestAssessment').mockResolvedValue({ latest_attempt: null, latest_resolved: null });
    vi.spyOn(genlayerModule, 'fetchClaimAssessments').mockResolvedValue({ cursor: '0', items: [], next_cursor: null, total: '0' });

    const { container } = render(
      <MemoryRouter initialEntries={['/claims/1']}>
        <Routes>
          <Route
            path="/claims/:claimId"
            element={<ClaimDetailPage resumeStage="SUCCESS" resumeError={null} resumeHash={`0x${'a'.repeat(64)}`} />}
          />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText(/Assessment History/i);
    expect(screen.getAllByText('Transaction complete')).toHaveLength(1);
    expect(container.querySelector('[data-transaction-slot="claim-actions"]')).toContainElement(
      screen.getByText('Transaction complete')
    );
  });

  it('resumes pending transaction only after user click and never calls writeContract', () => {
    const pendingOp: txModule.PendingOperation = {
      version: 2,
      txHash: ('0x' + 'a'.repeat(64)) as TransactionHash,
      operationKind: 'register_claim',
      chainId: 61997,
      contractAddress: '0x1111111111111111111111111111111111111111',
      account: '0x2222222222222222222222222222222222222222',
      expectedBinding: {
        source_url: 'https://example.com/announcement',
        exact_claim_text: 'Fastest ResNet50 Server Inference',
        official_result_id: '6.0-0001',
        official_commit: '4d3916ac9cf474b679cdfcf492d43a0559418ad1',
        byte_start: '100',
        byte_end: '500',
        supersedes_claim_id: '0',
      },
      timestamp: Date.now(),
    };

    txModule.savePendingOperation(pendingOp);

    render(
      <MemoryRouter>
        <MainApp />
      </MemoryRouter>
    );

    expect(screen.getByText(/Pending transaction:/i)).toBeInTheDocument();
    expect(screen.getByText(/Continue verification/i)).toBeInTheDocument();
  });

  it('separates latest UNRESOLVED attempt from latest substantive resolved result', () => {
    const unresolvedAttempt: AssessmentRecord = {
      id: '2',
      claim_id: '1',
      assessor: '0x2222222222222222222222222222222222222222',
      official_result_id: '6.0-0001',
      official_commit: 'b'.repeat(40),
      byte_start: '100',
      byte_end: '500',
      official_row_fingerprint: '',
      contradiction_mask: '0',
      material_omission_mask: '0',
      incompatible_scope_mask: '0',
      uncertainty_mask: '16',
      outcome: 'UNRESOLVED',
      prior_attempt_id: '1',
      prior_resolved_id: '1',
      created_at: '2026-08-09T00:00:00Z',
    };

    const resolvedAttempt: AssessmentRecord = {
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

    const latestMap = new Map<string, LatestAssessmentResponse>();
    latestMap.set('1', { latest_attempt: unresolvedAttempt, latest_resolved: resolvedAttempt });

    render(
      <MemoryRouter>
        <RegistryPage
          claims={[sampleClaim]}
          latestAssessments={latestMap}
          onLoadMore={() => {}}
          nextCursor={null}
          loading={false}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('SUPPORTED')).toBeInTheDocument();
  });

  it('renders honest not-found page for unknown routes with registry link', () => {
    render(
      <MemoryRouter initialEntries={['/invalid-route']}>
        <Routes>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Page Not Found/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Claims Registry/i })).toBeInTheDocument();
  });
});
