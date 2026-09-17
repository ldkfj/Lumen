import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { contractConfig, chainInfo, getExplorerTxUrl, getExplorerAddressUrl } from './config';
import {
  ClaimRecord,
  AssessmentRecord,
  LatestAssessmentResponse,
  Outcome,
  decodeMask,
  CONTRADICTION_AND_OMISSION_KEYS,
  INCOMPATIBLE_SCOPE_KEYS,
  UNCERTAINTY_KEYS,
  TAXONOMY_EXPLANATIONS,
  getErrorMessage,
} from './types';
import { fetchClaims, fetchClaim, fetchLatestAssessment, fetchClaimAssessments } from './genlayer';
import { walletManager, EIP6963ProviderDetail, WalletState } from './wallet';
import { locateOfficialRows, RowScanResult } from './officialRow';
import {
  TxStage,
  executeContractWrite,
  loadPendingOperation,
  hasPendingWriteLock,
  clearPendingOperation,
  processTransactionFinalityAndReadback,
  PendingOperation,
  FeeQuote,
} from './transaction';

// --- Helper Functions ---
function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function rowOptionLabel(row: RowScanResult): string {
  const o = row.rowObject;
  return `${o.system} · ${o.model} · ${o.scenario} · ${o.performance_result} ${o.performance_units}`;
}

function copyToClipboard(text: string, onCopied: () => void): void {
  navigator.clipboard.writeText(text).then(onCopied).catch(() => {});
}

function formatGen(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '').slice(0, 6);
  return `${whole}${fraction ? `.${fraction}` : ''} GEN`;
}

function isTxBusy(stage: TxStage): boolean {
  return ['WAITING_FOR_WALLET', 'SUBMITTED', 'WAITING_FOR_FINALITY', 'VERIFYING_EXECUTION', 'VERIFYING_READBACK'].includes(stage);
}

const TX_COPY: Record<TxStage, { title: string; detail: string }> = {
  IDLE: { title: 'Ready', detail: 'No transaction is in progress.' },
  WAITING_FOR_WALLET: { title: 'Confirm in your wallet', detail: 'Review and confirm or reject the request in your selected wallet.' },
  SUBMITTED: { title: 'Transaction submitted', detail: 'Your wallet returned a transaction hash.' },
  WAITING_FOR_FINALITY: { title: 'Waiting for finality', detail: 'Studio Devnet is reaching consensus on this transaction.' },
  VERIFYING_EXECUTION: { title: 'Verifying execution', detail: 'The transaction is finalized; its execution result is being checked.' },
  VERIFYING_READBACK: { title: 'Verifying the result', detail: 'The finalized result is being compared with authoritative contract state.' },
  SUCCESS: { title: 'Transaction complete', detail: 'Finality, execution, and contract state were verified.' },
  REJECTED: { title: 'Request rejected', detail: 'No transaction was submitted.' },
  FAILED: { title: 'Transaction failed', detail: 'The transaction or pre-submit validation failed.' },
  RECONCILIATION_REQUIRED: { title: 'Verification interrupted', detail: 'Do not submit again. Continue verification of the existing wallet request or transaction.' },
};

export function TransactionProgress({ stage, error, hash }: { stage: TxStage; error: string | null; hash: string | null }) {
  if (stage === 'IDLE') return null;
  const pending = isTxBusy(stage);
  const alert = stage === 'FAILED' || stage === 'REJECTED';
  const copy = TX_COPY[stage];
  return (
    <section className={`transaction-progress transaction-progress--${stage.toLowerCase()}`} data-transaction-phase={stage} role={alert ? 'alert' : 'status'} aria-live={alert ? 'assertive' : 'polite'} aria-atomic="true">
      <div className="transaction-progress__heading">
        {pending && <span className="transaction-progress__spinner" aria-hidden="true" />}
        <div><strong>{copy.title}</strong><p>{error || copy.detail}</p></div>
      </div>
      {hash && <div className="transaction-progress__hash"><span>Transaction hash</span><code>{hash}</code>{getExplorerTxUrl(hash) && <a href={getExplorerTxUrl(hash)!} target="_blank" rel="noreferrer">View transaction</a>}</div>}
    </section>
  );
}

function useFeeReview() {
  const [quote, setQuote] = useState<FeeQuote | null>(null);
  const resolver = useRef<((approved: boolean) => void) | null>(null);
  const request = (next: FeeQuote) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setQuote(next);
  });
  const decide = (approved: boolean) => {
    resolver.current?.(approved);
    resolver.current = null;
    setQuote(null);
  };
  return { quote, request, decide };
}

function FeeReviewDialog({ quote, onDecision }: { quote: FeeQuote | null; onDecision: (approved: boolean) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (quote && !dialog.open) dialog.showModal();
    if (!quote && dialog.open) dialog.close();
  }, [quote]);
  return (
    <dialog ref={dialogRef} aria-labelledby="fee-review-title" onCancel={(event) => { event.preventDefault(); onDecision(false); }}>
      <div className="dialog-header"><h2 id="fee-review-title">Review protocol fee</h2></div>
      {quote && <>
        <p className="fee-total">Maximum wallet fee deposit <strong>{formatGen(quote.feeValue)}</strong></p>
        <p className="form-helper">Estimated from the verified fee profile and current Studio Devnet policy. Unused fee is settled by the protocol; no GEN is sent to this non-payable contract.</p>
        <div className="fee-actions">
          <button type="button" className="btn btn-secondary" onClick={() => onDecision(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onDecision(true)}>Continue to wallet signature</button>
        </div>
      </>}
    </dialog>
  );
}

// --- App Navigation Header ---
export function AppHeader({
  onOpenSearch,
  onOpenWalletModal,
}: {
  onOpenSearch: () => void;
  onOpenWalletModal: () => void;
}) {
  const [walletState, setWalletState] = useState<WalletState>(walletManager.getWalletState());
  const [copiedAddr, setCopiedAddr] = useState(false);
  const location = useLocation();

  useEffect(() => {
    return walletManager.subscribeState(setWalletState);
  }, []);

  const handleCopy = () => {
    if (walletState.address) {
      copyToClipboard(walletState.address, () => {
        setCopiedAddr(true);
        setTimeout(() => setCopiedAddr(false), 2000);
      });
    }
  };

  return (
    <header className="app-header">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <div className="header-inner">
        <Link to="/app" className="header-brand">
          <span className="brand-title">Lumen</span>
          <span className="brand-badge">MLPerf v6.0</span>
        </Link>

        <nav className="header-nav" aria-label="Main Navigation">
          <Link to="/app" className={`nav-link ${location.pathname === '/app' ? 'active' : ''}`}>
            Registry
          </Link>
          <Link to="/app/register" className={`nav-link ${location.pathname === '/app/register' ? 'active' : ''}`}>
            Register
          </Link>
          <Link to="/app/about" className={`nav-link ${location.pathname === '/app/about' ? 'active' : ''}`}>
            About
          </Link>

          <button
            type="button"
            className="search-pill-btn"
            onClick={onOpenSearch}
            aria-label="Search registry (Ctrl+K)"
            id="search-trigger-btn"
          >
            <span>Search claims</span>
            <kbd className="search-pill-kbd">⌘K</kbd>
          </button>

          {walletState.isConnected && walletState.address ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="wallet-btn connected"
                onClick={handleCopy}
                title={walletState.address}
                aria-label={`Connected address ${walletState.address}. Click to copy.`}
              >
                <span>{shortenAddress(walletState.address)}</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>{copiedAddr ? 'Copied' : 'Copy'}</span>
              </button>

              {!walletState.isStudioDevnet && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}
                  onClick={() => walletManager.switchToStudioDevnet()}
                >
                  Switch to Studio Devnet
                </button>
              )}

              <button
                type="button"
                className="btn btn-secondary"
                onClick={onOpenWalletModal}
                title="Switch wallet provider"
              >
                Switch
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => walletManager.disconnect()}
                title="Disconnect application"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button type="button" className="wallet-btn" onClick={onOpenWalletModal}>
              Connect wallet
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}

// --- Provider Selection Dialog ---
export function WalletModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [providers, setProviders] = useState<EIP6963ProviderDetail[]>(walletManager.getDiscoveredProviders());
  const [connecting, setConnecting] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    return walletManager.subscribeProviders(setProviders);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const handleSelect = async (detail: EIP6963ProviderDetail) => {
    setConnecting(detail.info.name);
    setErrorMsg(null);
    try {
      await walletManager.connectProvider(detail);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setConnecting(null);
    }
  };

  return (
    <dialog ref={dialogRef} onClose={onClose} aria-labelledby="wallet-dialog-title" aria-modal="true">
      <div className="dialog-header">
        <h2 id="wallet-dialog-title">Connect Wallet</h2>
        <button type="button" className="dialog-close-btn" onClick={onClose} aria-label="Close dialog">
          ✕
        </button>
      </div>

      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '16px' }}>
        Select an available wallet provider to submit transactions on GenLayer Studio Devnet.
      </p>

      {errorMsg && (
        <div className="banner danger" style={{ marginBottom: '16px' }} role="alert">
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="provider-list">
        {providers.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)' }}>
            No EIP-6963 or injected wallets detected in this browser.
          </div>
        ) : (
          providers.map((p) => (
            <button
              key={p.info.uuid}
              type="button"
              className="provider-item-btn"
              onClick={() => handleSelect(p)}
              disabled={connecting !== null}
            >
              <span>{p.info.name}</span>
              {connecting === p.info.name ? (
                <span className="mono">Connecting...</span>
              ) : (
                <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                  {p.info.rdns}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </dialog>
  );
}

// --- Search Dialog ---
export function SearchDialog({
  isOpen,
  onClose,
  claims,
}: {
  isOpen: boolean;
  onClose: () => void;
  claims: ClaimRecord[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();

  const filtered = claims.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.id.includes(q) ||
      c.official_result_id.toLowerCase().includes(q) ||
      c.registrant.toLowerCase().includes(q) ||
      c.exact_claim_text.toLowerCase().includes(q) ||
      (c.official.submitter && c.official.submitter.toLowerCase().includes(q)) ||
      (c.official.system && c.official.system.toLowerCase().includes(q)) ||
      (c.official.platform && c.official.platform.toLowerCase().includes(q))
    );
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < filtered.length ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        navigate(`/app/claims/${filtered[selectedIndex].id}`);
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="search-dialog"
      onClose={onClose}
      aria-label="Search loaded claims"
      aria-modal="true"
    >
      <div className="dialog-header">
        <h2>Search Loaded Claims</h2>
        <button type="button" className="dialog-close-btn" onClick={onClose} aria-label="Close search">
          ✕
        </button>
      </div>

      <div className="search-input-wrap">
        <input
          ref={inputRef}
          type="search"
          className="search-dialog-input"
          placeholder="Filter by Claim ID, Result ID, Submitter, System, or text..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div className="search-results-list" role="listbox">
        {filtered.length === 0 ? (
          <div style={{ padding: '16px', color: 'var(--muted)', textAlign: 'center' }}>
            No loaded claims match &quot;{searchQuery}&quot;.
          </div>
        ) : (
          filtered.map((c, idx) => (
            <Link
              key={c.id}
              to={`/app/claims/${c.id}`}
              className={`search-result-item ${idx === selectedIndex ? 'selected' : ''}`}
              onClick={onClose}
              role="option"
              aria-selected={idx === selectedIndex}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="mono" style={{ fontWeight: 600 }}>
                  Claim #{c.id} · {c.official_result_id}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{shortenAddress(c.registrant)}</span>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>{c.exact_claim_text}</div>
            </Link>
          ))
        )}
      </div>
    </dialog>
  );
}

// --- Dark Graphite Official Row Inspector ---
export function OfficialRowInspector({
  official,
  officialCommit,
  byteStart,
  byteEnd,
}: {
  official: ClaimRecord['official'];
  officialCommit: string;
  byteStart?: string;
  byteEnd?: string;
}) {
  return (
    <section className="official-inspector" aria-label="Official MLPerf Result Row Inspector">
      <div className="inspector-header">
        <span className="inspector-title">Official MLPerf Result Row</span>
        <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--inspector-label)' }}>
          Commit: {officialCommit ? shortenAddress(officialCommit) : 'Unknown'} · Range: {byteStart}-{byteEnd}
        </span>
      </div>

      <div className="inspector-grid">
        <div className="inspector-field">
          <span className="inspector-field-label">Result ID</span>
          <span className="inspector-field-val">{official.result_id || '—'}</span>
        </div>
        <div className="inspector-field">
          <span className="inspector-field-label">Submitter</span>
          <span className="inspector-field-val">{official.submitter || '—'}</span>
        </div>
        <div className="inspector-field">
          <span className="inspector-field-label">System / Platform</span>
          <span className="inspector-field-val">
            {official.system || '—'} {official.platform ? `(${official.platform})` : ''}
          </span>
        </div>
        <div className="inspector-field">
          <span className="inspector-field-label">Model / Scenario</span>
          <span className="inspector-field-val">
            {official.model || '—'} / {official.scenario || '—'}
          </span>
        </div>
        <div className="inspector-field">
          <span className="inspector-field-label">Performance Result</span>
          <span className="inspector-field-val">
            {official.performance_result || '—'} {official.performance_units || ''}
          </span>
        </div>
        <div className="inspector-field">
          <span className="inspector-field-label">Availability / Division</span>
          <span className="inspector-field-val">
            {official.availability || '—'} / {official.category || '—'}
          </span>
        </div>
        <div className="inspector-field">
          <span className="inspector-field-label">Host Processor / Cores</span>
          <span className="inspector-field-val">
            {official.processor || '—'} ({official.host_processors_per_node || '1'} node, {official.host_processor_core_count || '—'} cores)
          </span>
        </div>
        <div className="inspector-field">
          <span className="inspector-field-label">Accelerators / Count</span>
          <span className="inspector-field-val">
            {official.accelerator || '—'} (a#: {official.accelerators_per_node || '0'}, Total: {official.total_accelerators || '0'})
          </span>
        </div>
        <div className="inspector-field">
          <span className="inspector-field-label">Operating System</span>
          <span className="inspector-field-val">{official.operating_system || '—'}</span>
        </div>
        <div className="inspector-field">
          <span className="inspector-field-label">Power / Inferred</span>
          <span className="inspector-field-val">
            Power: {official.has_power || 'false'} · Inferred: {official.inferred || 'false'}
          </span>
        </div>
      </div>
    </section>
  );
}

// --- Page: Registry Index (`/`) ---
export function RegistryPage({
  claims,
  latestAssessments,
  onLoadMore,
  nextCursor,
  loading,
}: {
  claims: ClaimRecord[];
  latestAssessments: Map<string, LatestAssessmentResponse>;
  onLoadMore: () => void;
  nextCursor: string | null;
  loading: boolean;
}) {
  return (
    <div className="registry-section">
      <div className="registry-header">
        <h1>Official Claims Registry</h1>
        <span className="registry-count">{claims.length} records loaded</span>
      </div>

      {contractConfig.status !== 'configured' && (
        <div className="banner warning" role="alert">
          <div>
            <strong>Deployment not configured:</strong> Contract address is missing or invalid. Set{' '}
            <code>VITE_CONTRACT_ADDRESS</code> to an active 40-hex Studio Devnet deployment to enable RPC queries and submissions.
          </div>
        </div>
      )}

      {claims.length === 0 && !loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>
          No claims have been registered on this contract deployment yet.
        </div>
      ) : (
        <div className="registry-table">
          {claims.map((claim) => {
            const latestInfo = latestAssessments.get(claim.id);
            const verdict: Outcome =
              latestInfo?.latest_resolved?.outcome || latestInfo?.latest_attempt?.outcome || 'UNASSESSED';

            return (
              <Link key={claim.id} to={`/app/claims/${claim.id}`} className="registry-row">
                <div>
                  <span className={`verdict-badge ${verdict}`}>{verdict}</span>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '4px' }}>
                    Claim #{claim.id}
                  </div>
                </div>

                <div className="row-claim-text">&ldquo;{claim.exact_claim_text}&rdquo;</div>

                <div className="row-metadata">
                  <div>
                    <strong>Result:</strong> {claim.official_result_id}
                  </div>
                  <div>
                    <strong>Commit:</strong> {shortenAddress(claim.official_commit)}
                  </div>
                </div>

                <div className="row-spec">
                  <div>{claim.official.submitter || '—'}</div>
                  <div>
                    {claim.official.system || '—'} · {claim.official.scenario || '—'}
                  </div>
                </div>

                <div style={{ fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'right' }}>
                  <div>{shortenAddress(claim.registrant)}</div>
                  <div style={{ marginTop: '4px' }}>Details →</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {nextCursor && (
        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <button type="button" className="btn btn-secondary" onClick={onLoadMore} disabled={loading}>
            {loading ? 'Loading more...' : 'Load more claims'}
          </button>
        </div>
      )}
    </div>
  );
}

// --- Page: Register Claim (`/register`) ---
export function RegisterPage() {
  const feeReview = useFeeReview();
  const [sourceUrl, setSourceUrl] = useState('');
  const [claimText, setClaimText] = useState('');
  const [resultId, setResultId] = useState('6.0-0001');
  const [commitSha, setCommitSha] = useState('');
  const [supersedesId, setSupersedesId] = useState('0');

  const [scanResult, setScanResult] = useState<RowScanResult | null>(null);
  const [scanMatches, setScanMatches] = useState<RowScanResult[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [txStage, setTxStage] = useState<TxStage>('IDLE');
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [createdClaimId, setCreatedClaimId] = useState<string | null>(null);

  const handleResultIdChange = (val: string) => {
    setResultId(val);
    setScanResult(null);
    setScanMatches([]);
    setScanError(null);
  };

  const handleCommitShaChange = (val: string) => {
    setCommitSha(val);
    setScanResult(null);
    setScanMatches([]);
    setScanError(null);
  };

  const handleLocateRow = async (e: React.FormEvent) => {
    e.preventDefault();
    setScanLoading(true);
    setScanError(null);
    setScanResult(null);
    setScanMatches([]);
    try {
      const matches = await locateOfficialRows(commitSha, resultId);
      setScanMatches(matches);
      setScanResult(matches.length === 1 ? matches[0] : null);
    } catch (err: unknown) {
      setScanError(getErrorMessage(err));
    } finally {
      setScanLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!scanResult) return;
    setTxError(null);
    setTxHash(null);
    try {
      const supersedesBigInt = BigInt(supersedesId.trim() || '0');
      const res = await executeContractWrite(
        'register_claim',
        [
          sourceUrl.trim(),
          claimText.trim(),
          resultId.trim(),
          commitSha.trim().toLowerCase(),
          BigInt(scanResult.byteStart),
          BigInt(scanResult.byteEnd),
          supersedesBigInt,
        ],
        {
          source_url: sourceUrl.trim(),
          exact_claim_text: claimText.trim(),
          official_result_id: resultId.trim(),
          official_commit: commitSha.trim().toLowerCase(),
          byte_start: String(scanResult.byteStart),
          byte_end: String(scanResult.byteEnd),
          supersedes_claim_id: String(supersedesBigInt),
        },
        (stage, err, hash) => {
          setTxStage(stage);
          if (err) setTxError(err);
          if (hash) setTxHash(hash);
        },
        feeReview.request
      );
      setTxHash(res.txHash);
      setCreatedClaimId(res.recordId);
    } catch {
      // Stage already updated
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <FeeReviewDialog quote={feeReview.quote} onDecision={feeReview.decide} />
      <h1 style={{ marginBottom: '16px' }}>Register Performance Claim</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '24px' }}>
        Submit a frozen public marketing claim and cite an exact official MLPerf Inference v6.0 result row.
      </p>

      {contractConfig.status !== 'configured' && (
        <div className="banner danger" role="alert">
          <div>
            <strong>Writes disabled:</strong> Contract address is not configured.
          </div>
        </div>
      )}

      <TransactionProgress stage={txStage} error={txError} hash={txHash} />
      {createdClaimId && (
        <div style={{ marginBottom: '24px' }}>
          <Link to={`/app/claims/${createdClaimId}`} className="btn btn-primary" style={{ display: 'inline-flex' }}>
            View Created Claim #{createdClaimId} →
          </Link>
        </div>
      )}

      <form className="form-card" onSubmit={handleLocateRow}>
        <div className="form-group">
          <label className="form-label" htmlFor="sourceUrl">
            Public Source HTTPS URL
          </label>
          <input
            id="sourceUrl"
            className="form-input"
            type="url"
            required
            placeholder="https://vendor.com/blog/benchmark-announcement"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
          />
          <span className="form-helper">Must be HTTPS. No IP literals or non-standard ports.</span>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="claimText">
            Exact Frozen Claim Text
          </label>
          <textarea
            id="claimText"
            className="form-textarea"
            required
            placeholder="Copy exact marketing assertion (1-2000 characters)..."
            value={claimText}
            onChange={(e) => setClaimText(e.target.value)}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="resultId">
              Official Result ID
            </label>
            <input
              id="resultId"
              className="form-input mono"
              required
              pattern="^6\.0-[0-9]{4}$"
              placeholder="6.0-0001"
              value={resultId}
              onChange={(e) => handleResultIdChange(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="commitSha">
              Official Repository Commit SHA
            </label>
            <input
              id="commitSha"
              className="form-input mono"
              required
              pattern="^[0-9a-fA-F]{40}$"
              placeholder="40-character commit SHA"
              value={commitSha}
              onChange={(e) => handleCommitShaChange(e.target.value)}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="supersedesId">
            Supersedes Claim ID (Optional)
          </label>
          <input
            id="supersedesId"
            className="form-input mono"
            type="number"
            min="0"
            placeholder="0"
            value={supersedesId}
            onChange={(e) => setSupersedesId(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button type="submit" className="btn btn-secondary" disabled={scanLoading}>
            {scanLoading ? 'Locating row...' : '1. Locate official row & compute byte range'}
          </button>
        </div>

        {scanError && <div className="form-error" role="alert">{scanError}</div>}
      </form>

      {scanMatches.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="officialRowSelection">Official Result Row</label>
            <select
              id="officialRowSelection"
              className="form-input"
              value={scanResult?.byteStart ?? ''}
              onChange={(e) => setScanResult(scanMatches.find((row) => row.byteStart === Number(e.target.value)) ?? null)}
            >
              <option value="" disabled>Select the exact system, model, and scenario row</option>
              {scanMatches.map((row) => (
                <option key={row.byteStart} value={row.byteStart}>{rowOptionLabel(row)}</option>
              ))}
            </select>
          </div>

          {scanResult && (
            <>
              <div className="banner info" style={{ marginBottom: '16px' }}>
                <div>
                  <strong>Row located in summary_results.json:</strong> Bytes {scanResult.byteStart}-{scanResult.byteEnd}{' '}
                  ({scanResult.sliceLength} bytes). This byte range is an untrusted locator that contract validators independently verify.
                </div>
              </div>

              <OfficialRowInspector
                official={scanResult.rowObject}
                officialCommit={commitSha}
                byteStart={String(scanResult.byteStart)}
                byteEnd={String(scanResult.byteEnd)}
              />

              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '16px', minHeight: '48px' }}
                disabled={contractConfig.status !== 'configured' || isTxBusy(txStage)}
                onClick={handleRegister}
              >
                2. Register claim on Studio Devnet
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- Page: Claim Detail & Revision History (`/claims/:claimId`) ---
export function ClaimDetailPage() {
  const feeReview = useFeeReview();
  const { claimId } = useParams<{ claimId: string }>();
  const [claim, setClaim] = useState<ClaimRecord | null>(null);
  const [latestInfo, setLatestInfo] = useState<LatestAssessmentResponse | null>(null);
  const [history, setHistory] = useState<AssessmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reassessment form state
  const [reassessCommit, setReassessCommit] = useState('');
  const [reassessScanResult, setReassessScanResult] = useState<RowScanResult | null>(null);
  const [reassessMatches, setReassessMatches] = useState<RowScanResult[]>([]);
  const [reassessLoading, setReassessLoading] = useState(false);
  const [reassessError, setReassessError] = useState<string | null>(null);

  // Tx state
  const [txStage, setTxStage] = useState<TxStage>('IDLE');
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    if (!claimId) return;
    let isCancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const idBigInt = BigInt(claimId || '0');
        const c = await fetchClaim(idBigInt);
        const l = await fetchLatestAssessment(idBigInt);
        const h = await fetchClaimAssessments(idBigInt, 0n, 20);

        if (!isCancelled) {
          setClaim(c);
          setLatestInfo(l);
          setHistory(h.items);
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setErrorMsg(getErrorMessage(err));
        }
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }

    load();
    return () => {
      isCancelled = true;
    };
  }, [claimId]);

  const handleAssessClaim = async () => {
    if (!claim) return;
    setTxError(null);
    setTxHash(null);
    try {
      await executeContractWrite(
        'assess_claim',
        [BigInt(claim.id)],
        {
          claim_id: claim.id,
          official_result_id: claim.official_result_id,
          official_commit: claim.official_commit,
          byte_start: claim.byte_start,
          byte_end: claim.byte_end,
        },
        (stage, err, hash) => {
          setTxStage(stage);
          if (err) setTxError(err);
          if (hash) setTxHash(hash);
        },
        feeReview.request
      );
      // Reload details after success
      const idBigInt = BigInt(claim.id);
      const l = await fetchLatestAssessment(idBigInt);
      const h = await fetchClaimAssessments(idBigInt, 0n, 20);
      setLatestInfo(l);
      setHistory(h.items);
    } catch {
      // Handled in stage change
    }
  };

  const handleReassessCommitChange = (val: string) => {
    setReassessCommit(val);
    setReassessScanResult(null);
    setReassessMatches([]);
    setReassessError(null);
  };

  const handleLocateReassessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claim) return;
    setReassessLoading(true);
    setReassessError(null);
    setReassessScanResult(null);
    setReassessMatches([]);
    try {
      const matches = await locateOfficialRows(reassessCommit, claim.official_result_id);
      setReassessMatches(matches);
      const sameIdentity = matches.find((row) =>
        row.rowObject.system === claim.official.system &&
        row.rowObject.model === claim.official.model &&
        row.rowObject.scenario === claim.official.scenario
      );
      setReassessScanResult(sameIdentity ?? null);
    } catch (err: unknown) {
      setReassessError(getErrorMessage(err));
    } finally {
      setReassessLoading(false);
    }
  };

  const handleRequestReassessment = async () => {
    if (!claim || !reassessScanResult) return;
    setTxError(null);
    setTxHash(null);
    try {
      await executeContractWrite(
        'request_reassessment',
        [
          BigInt(claim.id),
          reassessCommit.trim().toLowerCase(),
          BigInt(reassessScanResult.byteStart),
          BigInt(reassessScanResult.byteEnd),
        ],
        {
          claim_id: claim.id,
          official_result_id: claim.official_result_id,
          official_commit: reassessCommit.trim().toLowerCase(),
          byte_start: String(reassessScanResult.byteStart),
          byte_end: String(reassessScanResult.byteEnd),
        },
        (stage, err, hash) => {
          setTxStage(stage);
          if (err) setTxError(err);
          if (hash) setTxHash(hash);
        },
        feeReview.request
      );
      // Reload details
      const idBigInt = BigInt(claim.id);
      const l = await fetchLatestAssessment(idBigInt);
      const h = await fetchClaimAssessments(idBigInt, 0n, 20);
      setLatestInfo(l);
      setHistory(h.items);
      setReassessScanResult(null);
    } catch {
      // Handled
    }
  };

  if (loading) {
    return <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>Loading claim details...</div>;
  }

  if (errorMsg || !claim) {
    return (
      <div className="banner danger" role="alert">
        <div>
          <strong>Error:</strong> {errorMsg || 'Claim not found.'}
        </div>
      </div>
    );
  }

  const latestResolved = latestInfo?.latest_resolved;
  const latestAttempt = latestInfo?.latest_attempt;
  const displayedVerdict: Outcome = latestResolved?.outcome || latestAttempt?.outcome || 'UNASSESSED';

  // Decode mask explanations for latest assessment
  const activeAssessment = latestResolved || latestAttempt;
  const contradictions = activeAssessment
    ? decodeMask(activeAssessment.contradiction_mask, CONTRADICTION_AND_OMISSION_KEYS)
    : [];
  const omissions = activeAssessment
    ? decodeMask(activeAssessment.material_omission_mask, CONTRADICTION_AND_OMISSION_KEYS)
    : [];
  const incompatibleScopes = activeAssessment
    ? decodeMask(activeAssessment.incompatible_scope_mask, INCOMPATIBLE_SCOPE_KEYS)
    : [];
  const uncertainties = activeAssessment ? decodeMask(activeAssessment.uncertainty_mask, UNCERTAINTY_KEYS) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <FeeReviewDialog quote={feeReview.quote} onDecision={feeReview.decide} />
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <span className={`verdict-badge ${displayedVerdict}`}>{displayedVerdict}</span>
          <span className="mono" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
            Claim #{claim.id}
          </span>
        </div>
        <h1 style={{ fontSize: '1.4rem', lineHeight: 1.4 }}>&ldquo;{claim.exact_claim_text}&rdquo;</h1>
        <div style={{ marginTop: '8px', fontSize: '0.85rem', color: 'var(--muted)' }}>
          Public Source URL:{' '}
          <a href={claim.source_url} target="_blank" rel="noreferrer">
            {claim.source_url} ↗
          </a>
        </div>
        <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--muted)' }}>
          Registrant: <span className="mono">{claim.registrant}</span> (Registration does not establish vendor ownership or authorization).
        </div>
      </div>

      <TransactionProgress stage={txStage} error={txError} hash={txHash} />

      {/* Semantic Mismatch & Verdict Explanations */}
      {activeAssessment && (
        <section className="form-card" aria-label="Structured Assessment Findings">
          <h2>Semantic Assessment Breakdown</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            Assessment #{activeAssessment.id} derived by consensus on Studio Devnet. Explanations correspond to exact on-chain mask bits:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
            {contradictions.length > 0 && (
              <div>
                <strong style={{ color: 'var(--danger)' }}>Contradictions:</strong>
                <ul style={{ paddingLeft: '20px', marginTop: '4px', fontSize: '0.85rem' }}>
                  {contradictions.map((k) => (
                    <li key={k}>
                      <code>{k}</code>: {TAXONOMY_EXPLANATIONS[k] || k}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {omissions.length > 0 && (
              <div>
                <strong style={{ color: 'var(--warning)' }}>Material Omissions:</strong>
                <ul style={{ paddingLeft: '20px', marginTop: '4px', fontSize: '0.85rem' }}>
                  {omissions.map((k) => (
                    <li key={k}>
                      <code>{k}</code>: {TAXONOMY_EXPLANATIONS[k] || k}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {incompatibleScopes.length > 0 && (
              <div>
                <strong style={{ color: 'var(--verdict-not-comparable)' }}>Incompatible Scopes:</strong>
                <ul style={{ paddingLeft: '20px', marginTop: '4px', fontSize: '0.85rem' }}>
                  {incompatibleScopes.map((k) => (
                    <li key={k}>
                      <code>{k}</code>: {TAXONOMY_EXPLANATIONS[k] || k}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {uncertainties.length > 0 && (
              <div>
                <strong style={{ color: 'var(--muted)' }}>Uncertainties / Retries:</strong>
                <ul style={{ paddingLeft: '20px', marginTop: '4px', fontSize: '0.85rem' }}>
                  {uncertainties.map((k) => (
                    <li key={k}>
                      <code>{k}</code>: {TAXONOMY_EXPLANATIONS[k] || k}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {contradictions.length === 0 &&
              omissions.length === 0 &&
              incompatibleScopes.length === 0 &&
              uncertainties.length === 0 && (
                <div style={{ color: 'var(--success)', fontWeight: 500, fontSize: '0.9rem' }}>
                  No contradictions, material omissions, incompatible scopes, or uncertainties detected. Claim assertions are supported by the official row.
                </div>
              )}
          </div>
        </section>
      )}

      {/* Official Row Inspector */}
      <OfficialRowInspector
        official={claim.official}
        officialCommit={claim.official_commit}
        byteStart={claim.byte_start}
        byteEnd={claim.byte_end}
      />

      {/* Actions: Assess Claim & Request Reassessment */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
        <div className="form-card">
          <h2>Assess Bound Claim</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            Trigger a consensus evaluation of this claim against its bound official row slice ({claim.official_commit.slice(0, 7)}).
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleAssessClaim}
            disabled={contractConfig.status !== 'configured' || isTxBusy(txStage)}
          >
            Assess claim
          </button>
        </div>

        <div className="form-card">
          <h2>Request Reassessment</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            Cite a strictly newer commit in <code>mlcommons/inference_results_v6.0</code> that supersedes previous measurements.
          </p>

          <form onSubmit={handleLocateReassessment} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="reassessCommit">
                Newer Official Commit SHA
              </label>
              <input
                id="reassessCommit"
                className="form-input mono"
                required
                pattern="^[0-9a-fA-F]{40}$"
                placeholder="40-hex commit"
                value={reassessCommit}
                onChange={(e) => handleReassessCommitChange(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-secondary" disabled={reassessLoading}>
              {reassessLoading ? 'Locating row...' : 'Locate row in newer commit'}
            </button>
            {reassessError && <div className="form-error">{reassessError}</div>}
          </form>

          {reassessMatches.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="reassessmentRowSelection">Official Result Row</label>
                <select
                  id="reassessmentRowSelection"
                  className="form-input"
                  value={reassessScanResult?.byteStart ?? ''}
                  onChange={(e) => setReassessScanResult(reassessMatches.find((row) => row.byteStart === Number(e.target.value)) ?? null)}
                >
                  <option value="" disabled>Select the exact system, model, and scenario row</option>
                  {reassessMatches.map((row) => (
                    <option key={row.byteStart} value={row.byteStart}>{rowOptionLabel(row)}</option>
                  ))}
                </select>
              </div>
              {reassessScanResult && (
                <>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '8px' }}>
                    New byte range: {reassessScanResult.byteStart}-{reassessScanResult.byteEnd}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleRequestReassessment}
                    disabled={contractConfig.status !== 'configured' || isTxBusy(txStage)}
                  >
                    Submit Reassessment
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Revision Assessment History */}
      <section className="form-card" aria-label="Assessment History">
        <h2>Assessment History</h2>
        {history.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No assessments completed yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {history.map((a) => (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px',
                  border: '1px solid var(--rule)',
                  borderRadius: 'var(--radius-control)',
                }}
              >
                <div>
                  <span className={`verdict-badge ${a.outcome}`}>{a.outcome}</span>
                  <span className="mono" style={{ marginLeft: '12px', fontSize: '0.85rem' }}>
                    Attempt #{a.id} · Commit: {shortenAddress(a.official_commit)}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                  Assessor: {shortenAddress(a.assessor)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// --- Page: About (`/about`) ---
export function AboutPage() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <h1>About Lumen</h1>

      <div className="form-card">
        <h2>Independent Verification Scope</h2>
        <p>
          Lumen is an Intelligent Contract registry for GenLayer Studio Devnet that assesses
          whether a single frozen public marketing claim is fairly supported by a single official MLPerf Inference v6.0 result row.
        </p>
        <p style={{ marginTop: '8px' }}>
          <strong>Important Disclosures:</strong>
        </p>
        <ul style={{ paddingLeft: '20px', marginTop: '8px', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <li>This product is entirely independent and is not affiliated with, endorsed by, or certified by MLCommons.</li>
          <li>It does not rerun benchmarks, certify vendors or hardware products, rank systems, or evaluate general product quality.</li>
          <li>It evaluates exact metric containment and semantic alignment against official repository records in <code>mlcommons/inference_results_v6.0</code>.</li>
          <li>Registration is permissionless and does not establish vendor ownership or official authority.</li>
          <li>All consensus evaluations occur on-chain without human, relayer, or administrative intervention.</li>
        </ul>
      </div>

      <div className="form-card">
        <h2>Studio Devnet Configuration</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.85rem' }}>
          <div>
            <strong>Network:</strong> {chainInfo.name} (Chain ID: {chainInfo.id})
          </div>
          <div>
            <strong>RPC Endpoint:</strong> {chainInfo.rpcUrls.default.http[0]}
          </div>
          <div>
            <strong>Contract Address:</strong>{' '}
            {contractConfig.status === 'configured' ? (
              <a
                href={getExplorerAddressUrl(contractConfig.address) || '#'}
                target="_blank"
                rel="noreferrer"
                className="mono"
              >
                {shortenAddress(contractConfig.address)} ↗
              </a>
            ) : (
              <span style={{ color: 'var(--warning)' }}>Not configured</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Page: Not Found ---
export function NotFoundPage() {
  return (
    <div style={{ padding: '64px 16px', textAlign: 'center' }}>
      <h1>Page Not Found</h1>
      <p style={{ color: 'var(--muted)', marginTop: '8px' }}>
        The requested resource or claim ID does not exist.
      </p>
      <div style={{ marginTop: '24px' }}>
        <Link to="/app" className="btn btn-primary">
          Back to Claims Registry
        </Link>
      </div>
    </div>
  );
}

// --- Main Application Shell ---
export function MainApp() {
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [latestAssessments, setLatestAssessments] = useState<Map<string, LatestAssessmentResponse>>(new Map());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [pendingOp, setPendingOp] = useState<PendingOperation | null>(null);
  const [pendingLock, setPendingLock] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeStage, setResumeStage] = useState<TxStage>('IDLE');
  const [resumeHash, setResumeHash] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  useEffect(() => {
    setPendingOp(loadPendingOperation());
    setPendingLock(hasPendingWriteLock());
    const handlePendingUpdated = (e: Event) => {
      const custom = e as CustomEvent<PendingOperation | null>;
      setPendingOp(custom.detail || null);
      setPendingLock(hasPendingWriteLock());
    };
    window.addEventListener('lumen:pending_op_updated', handlePendingUpdated);
    return () => window.removeEventListener('lumen:pending_op_updated', handlePendingUpdated);
  }, []);

  const loadClaimsData = async (cursor = 0n) => {
    if (contractConfig.status !== 'configured') return;
    setLoading(true);
    try {
      const resp = await fetchClaims(cursor, 20);
      setClaims((prev) => (cursor === 0n ? resp.items : [...prev, ...resp.items]));
      setNextCursor(resp.next_cursor);

      // Fetch latest assessments with concurrency limit <= 4
      const newMap = new Map(latestAssessments);
      const queue = [...resp.items];
      const concurrency = 4;

      const workers = Array(concurrency)
        .fill(null)
        .map(async () => {
          while (queue.length > 0) {
            const item = queue.shift();
            if (!item) break;
            try {
              const la = await fetchLatestAssessment(BigInt(item.id));
              newMap.set(item.id, la);
            } catch {
              // Ignore individual read failures
            }
          }
        });

      await Promise.all(workers);
      setLatestAssessments(new Map(newMap));
    } catch {
      // Error handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClaimsData(0n);
  }, []);

  // Global Ctrl+K / Cmd+K hotkey for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleResumePendingOp = async () => {
    if (!pendingOp) return;
    setResumeLoading(true);
    setResumeStage('WAITING_FOR_FINALITY');
    setResumeHash(pendingOp.txHash);
    setResumeError(null);
    try {
      await processTransactionFinalityAndReadback(
        pendingOp.txHash,
        pendingOp,
        (stage, err) => {
          setResumeStage(stage);
          if (err) setResumeError(err);
        }
      );
      setPendingOp(null);
      setPendingLock(false);
      loadClaimsData(0n);
    } catch (err: unknown) {
      setResumeError(getErrorMessage(err));
    } finally {
      setResumeLoading(false);
    }
  };

  return (
    <div className="app-container">
      <AppHeader
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenWalletModal={() => setIsWalletModalOpen(true)}
      />

      <main id="main-content" className="app-main">
        {pendingLock && (
          <div className="banner info" role="status" style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <div>
                <strong>{pendingOp ? 'Pending transaction:' : 'Wallet result needs confirmation:'}</strong>{' '}
                {pendingOp ? `${pendingOp.operationKind} (Hash: ${shortenAddress(pendingOp.txHash)})` : 'No reliable transaction hash was returned. Check your wallet activity before unlocking writes.'}
                {resumeError && <div style={{ color: 'var(--danger)', marginTop: '4px' }}>{resumeError}</div>}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {pendingOp && <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleResumePendingOp}
                  disabled={resumeLoading}
                >
                  {resumeLoading ? 'Verifying...' : 'Continue verification'}
                </button>}
                {!pendingOp && <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    clearPendingOperation();
                    setPendingOp(null);
                    setPendingLock(false);
                  }}
                >
                  I confirmed no transaction was submitted
                </button>}
              </div>
            </div>
          </div>
        )}
        <TransactionProgress stage={resumeStage} error={resumeError} hash={resumeHash} />

        <Routes>
          <Route
            path="/app"
            element={
              <RegistryPage
                claims={claims}
                latestAssessments={latestAssessments}
                onLoadMore={() => nextCursor && loadClaimsData(BigInt(nextCursor))}
                nextCursor={nextCursor}
                loading={loading}
              />
            }
          />
          <Route path="/app/register" element={<RegisterPage />} />
          <Route path="/app/claims/:claimId" element={<ClaimDetailPage />} />
          <Route path="/app/about" element={<AboutPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <footer className="app-footer">
        <div className="footer-inner">
          <div className="footer-statement">Every badge should show its evidence.</div>
          <div className="footer-meta">
            <span>GenLayer Studio Devnet (Chain ID: {chainInfo.id})</span>
            <span>MLPerf Inference v6.0 Registry</span>
            {contractConfig.status === 'configured' && getExplorerAddressUrl(contractConfig.address) && (
              <a href={getExplorerAddressUrl(contractConfig.address)!} target="_blank" rel="noreferrer">
                Contract on Explorer ↗
              </a>
            )}
          </div>
        </div>
      </footer>

      <SearchDialog
        isOpen={isSearchOpen}
        onClose={() => {
          setIsSearchOpen(false);
          document.getElementById('search-trigger-btn')?.focus();
        }}
        claims={claims}
      />

      <WalletModal isOpen={isWalletModalOpen} onClose={() => setIsWalletModalOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <MainApp />
    </BrowserRouter>
  );
}
