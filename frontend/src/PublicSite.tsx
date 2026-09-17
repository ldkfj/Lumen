import { Link } from 'react-router-dom';
import './public-site.css';

function PublicHeader() {
  return (
    <header className="public-header">
      <a className="public-skip" href="#public-main">Skip to content</a>
      <div className="public-header-inner">
        <Link className="public-brand" to="/" aria-label="Lumen home">
          <img src="/lumen-mark.png" alt="" width="46" height="46" />
          <span>LUMEN</span>
        </Link>
        <nav aria-label="Public navigation">
          <Link to="/">Overview</Link>
          <a href="/#how-it-works">How it works</a>
          <Link to="/docs">Docs</Link>
          <Link className="public-nav-app" to="/app">Open app <span aria-hidden="true">↗</span></Link>
        </nav>
        <div className="public-network"><span aria-hidden="true" /> Studio Devnet</div>
      </div>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer-inner">
        <span>Every badge should show its evidence.</span>
        <nav aria-label="Footer navigation">
          <Link to="/docs">Documentation</Link>
          <Link to="/app">Verification app</Link>
          <a href="https://docs.genlayer.com/developers" target="_blank" rel="noreferrer">GenLayer docs ↗</a>
        </nav>
        <span className="public-built"><img src="/genlayer-mark.svg" alt="" width="16" height="16" /> Built on GenLayer</span>
      </div>
    </footer>
  );
}

const steps = [
  { number: '01', title: 'Freeze the claim', body: 'Bind the exact public wording and source URL. A later wording change becomes a new claim.' },
  { number: '02', title: 'Bind official evidence', body: 'Select one MLPerf Inference v6.0 submission row, official commit, and exact byte range.' },
  { number: '03', title: 'Assess its scope', body: 'GenLayer validators independently check whether the claim preserves what that row actually measured.' },
  { number: '04', title: 'Read the consequence', body: 'The contract records the outcome and evidence fingerprints. The browser never supplies a verdict.' },
];

export function PublicLanding() {
  return (
    <div className="public-site">
      <PublicHeader />
      <main id="public-main">
        <section className="public-hero" aria-labelledby="hero-heading">
          <div className="public-watermark" aria-hidden="true"><img src="/genlayer-mark.svg" alt="" width="98" height="92" /></div>
          <div className="public-hero-copy">
            <p className="public-eyebrow">Trust AI performance</p>
            <h1 id="hero-heading">Make AI benchmark claims <em>prove their scope.</em></h1>
            <p className="public-lead">Freeze the claim. Bind official evidence. Let GenLayer validators decide whether the wording is supported.</p>
            <div className="public-actions">
              <Link className="public-primary" to="/app">Open verification app <span aria-hidden="true">→</span></Link>
              <Link className="public-secondary" to="/docs">Read the protocol <span aria-hidden="true">↗</span></Link>
            </div>
          </div>
          <div className="public-flow" aria-label="How a claim becomes an evidence-bound outcome">
            <div className="flow-head"><span>Evidence path</span><span>MLPerf Inference v6.0</span></div>
            <div className="flow-stage flow-claim"><span className="flow-index">01 / PUBLIC CLAIM</span><strong>Exact wording, frozen.</strong><p>Source URL · claim fingerprint</p></div>
            <div className="flow-connector" aria-hidden="true">↓</div>
            <div className="flow-stage flow-source"><span className="flow-index">02 / OFFICIAL RESULT</span><strong>One result. One configuration.</strong><p>Release · model · scenario · system · commit · row</p></div>
            <div className="flow-connector" aria-hidden="true">↓</div>
            <div className="flow-stage flow-consensus"><span className="flow-index">03 / GENLAYER CONSENSUS</span><strong>Does the wording preserve the measured scope?</strong><p>Independent validators · on-chain assessment</p></div>
            <div className="flow-outcome"><span>04 / RESULT</span><strong>Evidence-bound, not self-certified</strong></div>
          </div>
        </section>
        <section className="public-how" id="how-it-works" aria-labelledby="how-heading">
          <div className="public-section-heading"><p className="public-eyebrow">The method</p><h2 id="how-heading">From statement to verifiable record.</h2></div>
          <ol className="public-steps">{steps.map(step => <li key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.body}</p></li>)}</ol>
        </section>
        <section className="public-boundary" aria-labelledby="boundary-heading">
          <div><p className="public-eyebrow">What Lumen does not claim</p><h2 id="boundary-heading">A narrow answer is a stronger answer.</h2></div>
          <p>Lumen does not rerun MLPerf, certify a vendor, rank products, or prove a multi-result superlative. It asks whether one public statement is fairly supported by one cited official result.</p>
          <a href="/docs#limitations">See the limits <span aria-hidden="true">→</span></a>
        </section>
        <section className="public-doc-strip" aria-label="Explore documentation">
          <div><span className="public-eyebrow">Go deeper</span><h2>Explore the documentation.</h2><p>Inputs, verification path, transaction states, and outcome meanings.</p></div>
          <a href="/docs#evidence">Evidence model <span aria-hidden="true">↗</span></a>
          <a href="/docs#journey">Using the app <span aria-hidden="true">↗</span></a>
          <a href="/docs#outcomes">Outcome taxonomy <span aria-hidden="true">↗</span></a>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

export function PublicDocs() {
  return (
    <div className="public-site public-docs-site">
      <PublicHeader />
      <main id="public-main" className="public-docs">
        <div className="public-docs-intro"><p className="public-eyebrow">Lumen / Documentation</p><h1>Verify the claim, not the sales pitch.</h1><p>Lumen checks a frozen public AI-system performance statement against one cited official MLPerf Inference v6.0 result. Read-only exploration needs no wallet.</p><Link className="public-primary" to="/app">Open verification app <span aria-hidden="true">→</span></Link></div>
        <nav className="public-docs-nav" aria-label="Documentation sections"><a href="#evidence">Evidence</a><a href="#journey">Using the app</a><a href="#outcomes">Outcomes</a><a href="#limitations">Limits</a></nav>
        <div className="public-docs-body">
          <section id="evidence"><p className="public-eyebrow">01 / Evidence</p><h2>Two sources, one bounded question.</h2><p>Registration supplies a public HTTPS claim URL and the exact text visible there. The official side is one MLPerf Inference v6.0 result ID at a specific commit of <code>mlcommons/inference_results_v6.0</code>, with an exact row slice of <code>summary_results.json</code>.</p><p>The contract checks source containment, commit lineage, row identity and configuration, then records fingerprints. A registrant does not gain vendor ownership or authority by registering a claim.</p></section>
          <section id="journey"><p className="public-eyebrow">02 / Journey</p><h2>Use Lumen.</h2><ol><li>Open the verification app and select <strong>Connect wallet</strong> if you intend to submit a write. Choose a provider explicitly, approve its account request, and switch to Studio Devnet when prompted.</li><li>To register, enter the public source URL, exact claim wording, official result ID and commit. Locate the official row, inspect its system/model/scenario, and explicitly choose a row when the ID has multiple matches.</li><li>Select the write action, review the transaction fee and details in your wallet, sign, and wait for consensus and finality. Lumen confirms execution and reads the resulting contract record back before reporting success.</li><li>Open a claim to trigger assessment, inspect its exact evidence and history, or request reassessment against a strictly newer official commit. A timeout can be resumed from the recorded transaction hash; do not submit the same write blindly.</li></ol><p>Readers can browse the registry and individual claims without connecting a wallet.</p></section>
          <section id="outcomes"><p className="public-eyebrow">03 / Consequence</p><h2>Five outcomes, no browser verdict.</h2><dl><div><dt>SUPPORTED</dt><dd>The cited row supports the frozen wording as assessed.</dd></div><div><dt>QUALIFICATION_REQUIRED</dt><dd>Relevant restrictions must accompany the statement.</dd></div><div><dt>OVERSTATED</dt><dd>The statement materially exceeds what the result supports.</dd></div><div><dt>NOT_COMPARABLE</dt><dd>The row and claimed comparison do not share a valid scope.</dd></div><div><dt>UNRESOLVED</dt><dd>Evidence or semantic agreement is insufficient for a conclusive badge.</dd></div></dl><p>Contract masks and fixed precedence determine the badge. Explanatory prose cannot change it.</p></section>
          <section id="limitations"><p className="public-eyebrow">04 / Limits</p><h2>One result is not a universal ranking.</h2><p>Lumen does not rerun a benchmark, certify general quality, prove vendor ownership, or validate private and vendor-created benchmarks. It does not infer multi-result superlatives from a single row. Dynamic source pages or official corrections can make an assessment unresolved; revisions retain the previous evidence and create a new record.</p><p>Currently scoped to Studio Devnet, chain ID 61997, and MLPerf Inference v6.0. Contract interactions have protocol fees. The frontend displays contract state and never calculates or submits a verdict.</p></section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
