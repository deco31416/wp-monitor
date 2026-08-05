# Contributing to WP MONITOR

Thank you for your interest in contributing to **WP MONITOR**.

WP MONITOR is maintained by **[Deco31416](https://www.deco31416.com)** and developed as an open-source project for authorized security research, defensive analysis, training, digital forensics, network analysis, and controlled laboratory use.

Contributions are welcome when they improve the project without weakening its authorization, privacy, auditability, security, or evidence-integrity safeguards.

> [!IMPORTANT]
> By participating in this project, you agree to use test systems, accounts, devices, networks, and data that you own or are explicitly authorized to assess. Never submit real third-party credentials, WhatsApp sessions, packet captures, personal data, case evidence, access tokens, or confidential operational material.

---

## Table of Contents

- [Contributing to WP MONITOR](#contributing-to-wp-monitor)
  - [Table of Contents](#table-of-contents)
  - [Project Principles](#project-principles)
    - [1. Authorization First](#1-authorization-first)
    - [2. Defensive and Research-Oriented Design](#2-defensive-and-research-oriented-design)
    - [3. Cautious Technical Conclusions](#3-cautious-technical-conclusions)
    - [4. Metadata Minimization](#4-metadata-minimization)
    - [5. Auditability and Integrity](#5-auditability-and-integrity)
    - [6. Safe Deployment Separation](#6-safe-deployment-separation)
  - [Ways to Contribute](#ways-to-contribute)
  - [Contributions That Will Not Be Accepted](#contributions-that-will-not-be-accepted)
  - [Before You Start](#before-you-start)
  - [Development Setup](#development-setup)
    - [Prerequisites](#prerequisites)
    - [Fork and Clone](#fork-and-clone)
    - [Install Dependencies](#install-dependencies)
    - [Configure the Environment](#configure-the-environment)
    - [Start the Local Stack](#start-the-local-stack)
  - [Branch and Commit Conventions](#branch-and-commit-conventions)
    - [Branch Names](#branch-names)
    - [Commit Messages](#commit-messages)
  - [Engineering Standards](#engineering-standards)
    - [TypeScript](#typescript)
    - [Backend and API](#backend-and-api)
    - [Frontend](#frontend)
    - [MongoDB and Persistence](#mongodb-and-persistence)
    - [Capture and Network Analysis](#capture-and-network-analysis)
    - [Reports and Evidence](#reports-and-evidence)
    - [Runtime Modes](#runtime-modes)
  - [Security, Privacy, and Evidence Rules](#security-privacy-and-evidence-rules)
    - [Never Commit Sensitive Material](#never-commit-sensitive-material)
    - [Test Data](#test-data)
    - [Logging](#logging)
  - [Testing and Verification](#testing-and-verification)
    - [Minimum Verification Matrix](#minimum-verification-matrix)
    - [Existing Project Checks](#existing-project-checks)
    - [Manual Testing Rules](#manual-testing-rules)
  - [Documentation Requirements](#documentation-requirements)
  - [Dependency Changes](#dependency-changes)
  - [Reporting Bugs](#reporting-bugs)
  - [Requesting Features](#requesting-features)
  - [Reporting Security Vulnerabilities](#reporting-security-vulnerabilities)
  - [Pull Request Requirements](#pull-request-requirements)
    - [Pull Request Description](#pull-request-description)
    - [Pull Request Checklist](#pull-request-checklist)
    - [Pull Request Size](#pull-request-size)
  - [Review and Merge Process](#review-and-merge-process)
  - [Licensing and Attribution](#licensing-and-attribution)
  - [AI-Assisted Contributions](#ai-assisted-contributions)
  - [Community Standards](#community-standards)
  - [Contact](#contact)

---

## Project Principles

Every contribution should preserve the following principles.

### 1. Authorization First

Features involving WhatsApp activity analysis, network monitoring, packet capture, call traffic analysis, check-ins, geolocation, audit records, or evidence exports must operate only within an authorized context.

Do not remove or bypass:

- Case identifiers.
- Operator attribution.
- Authorization notes.
- Consent requirements.
- Authentication controls.
- Runtime capability checks.
- Audit events.
- Evidence-integrity hashes.
- Production safety guards.

### 2. Defensive and Research-Oriented Design

WP MONITOR must not become a tool for covert surveillance, unauthorized interception, credential theft, account compromise, stalking, harassment, or evasion of platform and operating-system security controls.

Contributions should support legitimate research, defensive analysis, reproducible testing, privacy education, and authorized investigations.

### 3. Cautious Technical Conclusions

Network and behavioral observations are probabilistic and context-dependent.

Code, user interfaces, logs, reports, and documentation must not present:

- An observed IP address as verified ownership by a person.
- GeoIP information as exact physical or GPS location.
- RTT activity as conclusive proof of a person's behavior.
- Candidate scoring as verified identity.
- A correlation or anomaly as legal or investigative proof.

Use language such as:

- `observed`
- `estimated`
- `candidate`
- `preliminary`
- `non-conclusive`
- `requires manual review`
- `infrastructure or relay`
- `network/provider location hint`

### 4. Metadata Minimization

Network monitoring is designed around metadata and technical observations. Contributions must not introduce payload inspection, message-content collection, credential extraction, or unnecessary personal-data collection by default.

Any proposal that expands data collection must explain:

- Why the data is necessary.
- What authorization is required.
- How the data is minimized.
- How long it is retained.
- How it is protected.
- How it appears in audit and export flows.
- How users can disable or delete it.

### 5. Auditability and Integrity

Operational actions should remain attributable, reviewable, and reproducible.

Changes affecting cases, captures, check-ins, calls, exports, reports, or evidence packages must preserve:

- UTC timestamps.
- Case linkage.
- Operator context.
- Authorization context.
- Audit events.
- Deterministic identifiers where applicable.
- SHA-256 integrity metadata where currently provided.
- Clear limitations and provenance.

### 6. Safe Deployment Separation

The project intentionally separates local capture from cloud dashboard operation:

- `local-full` may expose authorized local capture capabilities.
- `railway-dashboard` must keep local packet capture disabled.

A contribution must not silently enable packet capture in Railway or another cloud environment that cannot observe the authorized local interface.

---

## Ways to Contribute

Useful contributions include:

- Bug fixes with a reproducible test case.
- TypeScript improvements and safer type definitions.
- Unit, integration, regression, and report-fixture tests.
- Security hardening.
- Privacy-preserving improvements.
- Audit-trail and evidence-integrity improvements.
- Error handling and operational diagnostics.
- Accessibility and responsive UI improvements.
- Performance and memory improvements.
- MongoDB query and lifecycle improvements.
- Railway and local deployment documentation.
- Clearer technical limitations and responsible-use documentation.
- API and Socket.IO contract documentation.
- Dependency updates that are verified for compatibility.
- Internationalization and terminology consistency.
- Reproducible synthetic fixtures.
- Improvements to developer experience and local startup.
- Documentation corrections and examples that do not expose secrets.

Small, focused contributions are easier to review and are strongly preferred.

---

## Contributions That Will Not Be Accepted

The following contributions will be rejected:

- Features designed for unauthorized monitoring or interception.
- Authentication, consent, rate-limit, or authorization bypasses.
- Stealth, persistence, anti-forensics, evasion, or concealment features.
- Credential collection, token extraction, session theft, or account takeover.
- Code that captures or stores message content or packet payloads without an approved, documented, and lawful requirement.
- Changes that remove audit records, operator attribution, evidence hashes, or case linkage.
- Claims that infer exact identity or physical location from RTT, GeoIP, ASN, ISP, or packet metadata.
- Real phone numbers, JIDs, names, coordinates, account identifiers, case records, or personal data in tests and screenshots.
- WhatsApp authentication folders, browser profiles, private keys, environment files, packet captures, reports, or evidence packages.
- Large unrelated refactors mixed with a bug fix.
- Generated code that the contributor cannot explain, test, or maintain.
- Copied code, assets, datasets, or documentation without compatible licensing and attribution.
- Changes that replace project branding, remove original attribution, or imply endorsement without approval.
- Forced dependency upgrades that break QR authentication, session recovery, reports, Railway mode, or capture workflows.
- Pull requests that intentionally weaken production security defaults.

---

## Before You Start

Before opening a pull request:

1. Search existing issues and pull requests to avoid duplicate work.
2. For substantial features, open an issue describing the problem and proposed scope.
3. Confirm that the change fits the project's authorized and defensive purpose.
4. Identify whether the change affects:
   - Authentication.
   - Authorization.
   - Privacy.
   - Data retention.
   - Audit events.
   - Evidence hashes.
   - Runtime modes.
   - Public API contracts.
   - Database schemas or indexes.
   - Environment variables.
   - Reports or exported artifacts.
5. Use synthetic or fully redacted test data.
6. Keep the change limited to one clear objective.

For typo fixes, small documentation corrections, and narrowly scoped tests, an issue is usually unnecessary.

---

## Development Setup

### Prerequisites

Install the components needed for the area you are changing:

- **Node.js 22 or later**
- **Corepack**
- **pnpm 10.12.1** for the backend/frontend workspace
- **MongoDB** locally or through MongoDB Atlas
- **Npcap** on Windows only when testing Network Monitor or call-capture functionality
- An authorized test WhatsApp account only when validating WhatsApp integration

Documentation-only and isolated unit-test contributions do not require a live WhatsApp session or packet-capture environment.

### Fork and Clone

```bash
git clone https://github.com/YOUR-USERNAME/wp-monitor.git
cd wp-monitor

git remote add upstream https://github.com/deco31416/wp-monitor.git
git fetch upstream
```

Replace `YOUR-USERNAME` with your GitHub username.

### Install Dependencies

```bash
corepack enable
pnpm install --frozen-lockfile
```

Do not replace package managers or regenerate lockfiles with another package manager.

### Configure the Environment

Linux or macOS:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Use local, non-sensitive values only. Never commit `.env`.

Recommended local runtime values include:

```dotenv
NODE_ENV=development
DEPLOYMENT_MODE=local-full
LOCAL_CAPTURE_ENABLED=true

BACKEND_PORT=4000
CLIENT_PORT=4001

BACKEND_URL=http://127.0.0.1:4000
PUBLIC_BASE_URL=http://127.0.0.1:4000
ALLOWED_ORIGINS=http://127.0.0.1:4001,http://localhost:4001

MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=device-tracker
```

Use a separate development database. Do not connect tests or local development to a production database.

### Start the Local Stack

Recommended command:

```powershell
pnpm run dev:local
```

Expected local services:

- Backend: `http://127.0.0.1:4000`
- Frontend: `http://127.0.0.1:4001`
- Health check: `http://127.0.0.1:4000/api/health`

Manual startup remains available:

```bash
# Terminal 1
pnpm run start:server

# Terminal 2
pnpm run start:client
```

Packet capture requires administrator or root privileges and must be tested only on an authorized host and network.

---

## Branch and Commit Conventions

### Branch Names

Create a branch from the repository's current default branch.

Use a descriptive prefix:

```text
feature/authorized-checkin-validation
fix/call-capture-audit-context
security/redact-sensitive-logs
docs/railway-setup
test/report-integrity-fixture
refactor/network-classifier
chore/dependency-metadata
```

Recommended prefixes:

- `feature/`
- `fix/`
- `security/`
- `docs/`
- `test/`
- `refactor/`
- `performance/`
- `chore/`

Avoid names such as `changes`, `update`, `fix-stuff`, or `new-branch`.

### Commit Messages

Use clear, imperative commit messages. Conventional Commit prefixes are recommended:

```text
feat: add case status validation to check-in creation
fix: preserve audit context during asynchronous enrichment
security: redact authorization headers from request logs
docs: document Railway volume requirements
test: cover candidate score cap for one-way traffic
refactor: isolate IP infrastructure classification
chore: update development dependency metadata
```

Keep commits logically separated. Do not combine dependency upgrades, formatting changes, feature work, and unrelated refactors in one commit.

---

## Engineering Standards

### TypeScript

- Prefer TypeScript for backend and frontend changes.
- Preserve strict typing and existing domain models.
- Avoid `any`; when unavoidable, explain why in code or the pull request.
- Validate untrusted input at API, Socket.IO, environment, and persistence boundaries.
- Use explicit return types for public functions and complex business logic.
- Handle `null`, `undefined`, timeouts, retries, and partial provider responses safely.
- Do not suppress compiler errors without a documented reason.

### Backend and API

- Keep API behavior backward-compatible unless a breaking change is explicitly approved.
- Return safe, structured errors without stack traces, tokens, credentials, internal paths, or database URIs.
- Preserve authentication for protected REST, Socket.IO, dashboard, and download routes.
- Validate case state before capture or evidence-producing operations.
- Apply rate limits to public or abuse-sensitive endpoints.
- Fail closed for missing production security configuration.
- Do not log authorization headers, dashboard tokens, session data, cookies, or provider keys.
- Use timeouts and safe fallbacks for external services.
- Keep `/api/health` useful without exposing secrets.

### Frontend

- Preserve authentication and authorization flows.
- Display errors clearly without exposing sensitive backend details.
- Keep user-facing claims consistent with the project's technical limitations.
- Preserve responsive behavior for desktop and mobile layouts.
- Use accessible labels, keyboard interaction, and readable contrast.
- Do not place production secrets in frontend environment variables or compiled bundles.
- Avoid silently retrying dangerous or evidence-producing operations.

### MongoDB and Persistence

- Avoid destructive schema changes without a migration or compatibility plan.
- Preserve TTL behavior and existing indexes unless the change is intentional and documented.
- Use projections to avoid returning unnecessary sensitive fields.
- Keep case, audit, evidence, capture, check-in, and report relationships consistent.
- Document new collections, indexes, retention rules, and cleanup behavior.
- Test behavior when MongoDB is unavailable or degraded.

### Capture and Network Analysis

- Preserve metadata-only collection unless a separately approved design states otherwise.
- Require case, operator, and authorization context for manual captures.
- Keep capture windows bounded and stoppable.
- Preserve private, reserved, local, CGNAT, provider, relay, cloud, CDN, and hosting classification.
- Do not promote weak or one-way observations to confirmed candidates.
- Keep original observations available for audit even when a classification is demoted.
- Test safe cleanup after errors, cancellation, shutdown, and interface failures.

### Reports and Evidence

- Preserve limitations, provenance, timestamps, case identifiers, and integrity data.
- Do not silently omit failed sections from a final report or evidence package.
- Distinguish unavailable data from zero values.
- Keep JSON, HTML, PDF, ZIP, and CSV outputs internally consistent.
- Avoid unstable fields that make identical fixtures produce unexplained differences.
- Escape user-provided content in HTML and report templates.
- Ensure generated reports do not expose tokens, local file paths, or hidden configuration.

### Runtime Modes

Changes must be tested against the intended deployment profile.

For `local-full`:

- Local capture may be available when explicitly enabled.
- Runtime capability responses should reflect actual host support.
- Capture failures should degrade safely.

For `railway-dashboard`:

- Local capture must remain disabled.
- Dashboard, API, database, WhatsApp session persistence, reports, and audit lookup should continue to work.
- The application must not claim it can observe the user's local adapter from Railway.

---

## Security, Privacy, and Evidence Rules

### Never Commit Sensitive Material

Do not commit:

- `.env` files.
- API keys, provider keys, dashboard tokens, passwords, or connection strings.
- `auth_info_baileys/` or other WhatsApp session folders.
- `.wwebjs_auth/`, browser profiles, cookies, or cached sessions.
- Private keys, certificates, keystores, or SSH material.
- Packet captures such as `.pcap`, `.pcapng`, `.cap`, or `.har`.
- Real audit exports.
- Evidence packages.
- Generated reports containing real data.
- Uploaded preview images from real cases.
- MongoDB dumps or local databases.
- Logs containing JIDs, phone numbers, IPs, tokens, authorization notes, or personal data.
- Screenshots showing QR codes, tokens, real identities, or operational case information.

A `.gitignore` entry does not protect a secret that was already committed. If sensitive data enters Git history:

1. Stop using the exposed credential or session.
2. Rotate or revoke it immediately.
3. Remove it from the repository history using an appropriate history-rewrite process.
4. Inform the maintainer privately.
5. Document the remediation without repeating the secret.

### Test Data

Use:

- Synthetic names and aliases.
- Redacted JIDs and phone numbers.
- Reserved documentation IP ranges.
- Fake case identifiers.
- Non-sensitive generated fixtures.
- Sanitized screenshots.
- Local or isolated test databases.

Do not use real people, accounts, conversations, investigations, or customer data.

### Logging

Logs must be useful for diagnosis without becoming a second evidence or credential store.

Before adding a log statement, confirm that it does not expose:

- Bearer tokens.
- Dashboard tokens.
- Session credentials.
- Cookies.
- MongoDB credentials.
- Provider API keys.
- Complete authorization notes.
- Complete personal identifiers.
- Raw request bodies containing private data.

Prefer structured redaction and stable event identifiers.

---

## Testing and Verification

Every pull request must include evidence appropriate to its risk and scope.

### Minimum Verification Matrix

| Change type | Minimum expected verification |
|---|---|
| Documentation only | Check commands, links, terminology, formatting, and consistency with current behavior |
| Backend or API | Relevant automated tests, `pnpm run test:unit`, startup check, and `/api/health` verification |
| Frontend | Build or test command available in the frontend package, manual UI verification, no new console errors, and authenticated error-path review |
| Authentication | Valid token, missing token, invalid token, Socket.IO auth, protected downloads, and no token leakage |
| MongoDB | Normal operation, missing data, duplicate data, reconnect/degraded behavior, and index or retention impact |
| Reports or evidence | `pnpm run qa:report-fixture`, manual output review, required sections, hashes, limitations, and placeholder scan |
| WhatsApp or Baileys | QR login, reconnect, stale-session recovery, session persistence, contact restore, and clean logout behavior |
| Network or call capture | Authorized local lab test, start/stop/error cleanup, audit metadata, candidate classification, and no payload retention |
| Railway or deployment | `railway-dashboard`, `LOCAL_CAPTURE_ENABLED=false`, CORS, proxy trust, health status, and persistent-volume assumptions |
| Security fix | Regression test, sanitized reproduction, threat addressed, and verification that controls were not weakened elsewhere |

### Existing Project Checks

Run the checks relevant to your change:

```bash
pnpm run test:unit
```

For reports and evidence artifacts:

```bash
pnpm run qa:report-fixture
```

For local operational status:

```powershell
pnpm run dev:local -- -Status
```

Do not claim that a change is verified when the corresponding test could not be run. State clearly in the pull request:

- What was tested.
- What was not tested.
- Why it was not tested.
- What risk remains.
- What a reviewer should verify manually.

### Manual Testing Rules

When manual testing involves WhatsApp, packet capture, check-ins, network metadata, or reports:

- Use an account and environment you control.
- Obtain explicit authorization from every relevant owner.
- Use a clearly identified test case.
- Keep the test bounded in time and scope.
- Delete generated sensitive data after verification.
- Do not attach raw operational evidence to a public issue or pull request.

---

## Documentation Requirements

Update documentation when a change affects:

- Installation or prerequisites.
- Environment variables.
- Ports or URLs.
- Runtime modes.
- Authentication.
- API endpoints.
- Socket.IO events.
- MongoDB collections, indexes, or retention.
- Capture requirements.
- Case and audit workflows.
- Reports or evidence package contents.
- Railway volumes or deployment behavior.
- Security limitations.
- User-visible terminology.
- Breaking behavior.

Depending on scope, update:

- `README.md`
- `.env.example`
- `CHANGELOG.md`
- `docs/README.md`
- `docs/architecture/README.md`
- `docs/operations/deployment-modes.md`
- `docs/operations/local-runbook.md`
- `docs/operations/railway.md`
- `docs/development/quality-testing.md`
- OpenAPI or Swagger definitions
- Inline comments for non-obvious constraints

Documentation must describe actual behavior. Do not document planned functionality as operational.

Use cautious and technically accurate language for:

- RTT inference.
- Presence observations.
- Candidate IPs.
- GeoIP.
- Provider or infrastructure classification.
- Behavior analytics.
- Anomaly detection.
- Consistency scores.
- Evidence integrity.

---

## Dependency Changes

Dependency changes require special care because the project integrates WhatsApp, native packet-capture bindings, frontend tooling, report generation, and database persistence.

When adding or upgrading a dependency:

1. Explain why it is needed.
2. Confirm its license is compatible with the project.
3. Avoid adding a package when a small internal implementation is sufficient.
4. Include lockfile changes from the correct package manager.
5. Review direct and transitive security advisories.
6. Document known residual risk.
7. Test platform-specific behavior.
8. Confirm that production bundles do not include development-only packages unnecessarily.
9. Verify that the dependency does not collect telemetry or send data externally without disclosure.
10. Avoid force-overriding an incompatible major version merely to silence an audit warning.

Changes involving Baileys or its transitive stack should verify, where applicable:

- QR authentication.
- Reconnection.
- Stale-session recovery.
- Session persistence.
- Contact restoration.
- Presence and device events.
- Call-analysis behavior.
- Report generation.
- Railway dashboard mode.
- Local capture mode.

Changes involving `cap`, Npcap, native bindings, or packet parsing require testing on an authorized supported host.

---

## Reporting Bugs

Before opening a bug report:

1. Confirm the issue still occurs on the current default branch.
2. Search existing issues.
3. Remove all secrets and personal data.
4. Reduce the problem to the smallest reproducible case.

A useful bug report should include:

- Clear title.
- WP MONITOR version or commit.
- Operating system and architecture.
- Node.js version.
- Backend and frontend package-manager versions.
- Runtime mode: `local-full` or `railway-dashboard`.
- MongoDB type: local or Atlas.
- Exact steps to reproduce.
- Expected behavior.
- Actual behavior.
- Sanitized logs.
- Relevant endpoint, component, or module.
- Frequency: always, intermittent, or first startup only.
- Whether the issue affects security, privacy, audit, reports, or evidence integrity.

For capture issues, also include:

- Operating system.
- Npcap or libpcap status.
- Whether the process ran with required privileges.
- Selected interface type.
- Whether traffic was generated on the same authorized host.
- Sanitized error output.

Do not attach packet captures, authentication data, real case exports, or unredacted screenshots.

---

## Requesting Features

A feature request should describe the problem before proposing an implementation.

Include:

- User or operator need.
- Authorized use case.
- Why current behavior is insufficient.
- Proposed workflow.
- Security and privacy impact.
- Data collected and retention impact.
- Audit and case-linkage requirements.
- Runtime-mode impact.
- API or database impact.
- Failure and abuse scenarios.
- Testing strategy.
- Documentation changes.
- Alternatives considered.

Feature requests that depend on unauthorized monitoring, hidden collection, evasion, credential access, or unsupported claims of identity or location will not be accepted.

---

## Reporting Security Vulnerabilities

Do not open a public GitHub issue for an unpatched vulnerability that could expose users, credentials, sessions, private data, authentication, evidence, or production systems.

Report it privately to:

**Email:** [deco31416@gmail.com](mailto:deco31416@gmail.com)<br>
**Subject:** `[WP MONITOR SECURITY] Brief vulnerability title`

Include:

- A concise description.
- Affected version or commit.
- Affected component or endpoint.
- Preconditions.
- Sanitized reproduction steps.
- Security impact.
- Suggested remediation, when available.
- Whether the issue is already public.
- Whether credentials or real user data may have been exposed.

Do not send:

- Real credentials.
- Active session folders.
- Personal data.
- Third-party account data.
- Unnecessary packet captures.
- Destructive proof-of-concept code.
- Data obtained without authorization.

Allow the maintainer a reasonable opportunity to validate and remediate the issue before public disclosure.

---

## Pull Request Requirements

A pull request should contain one focused change and enough evidence for an independent reviewer to understand and verify it.

### Pull Request Description

Include:

1. **Problem**<br>
   What was wrong or missing?

2. **Solution**<br>
   What changed and why?

3. **Scope**<br>
   Which files, modules, endpoints, events, schemas, or runtime modes are affected?

4. **Security and privacy impact**<br>
   Does the change affect authentication, authorization, data collection, retention, logs, reports, evidence, or external providers?

5. **Verification**<br>
   Which automated and manual tests were run?

6. **Operational impact**<br>
   Are new environment variables, indexes, volumes, permissions, ports, or deployment steps required?

7. **Limitations and remaining risk**<br>
   What is not covered?

8. **Screenshots or artifacts**<br>
   Include only sanitized UI screenshots or synthetic generated artifacts when they add value.

### Pull Request Checklist

Copy this checklist into the pull request description:

```markdown
## Pull Request Checklist

- [ ] I created this change from the current default branch.
- [ ] The pull request has one clear purpose.
- [ ] I searched for related issues and pull requests.
- [ ] I have the right to contribute all code, documentation, assets, and test data included here.
- [ ] I did not include secrets, tokens, sessions, private keys, packet captures, personal data, or real case evidence.
- [ ] I used synthetic or fully sanitized fixtures.
- [ ] I preserved authentication, authorization, consent, audit, and evidence-integrity controls.
- [ ] I preserved the `local-full` / `railway-dashboard` safety boundary.
- [ ] I did not present RTT, GeoIP, network metadata, candidate scoring, or behavior analytics as conclusive identity or exact location.
- [ ] I added or updated tests for the changed behavior.
- [ ] I ran the relevant automated checks and documented the results.
- [ ] I manually verified the affected workflow where required.
- [ ] I updated documentation, `.env.example`, API definitions, and `CHANGELOG.md` when applicable.
- [ ] I documented new dependencies, environment variables, database changes, and residual risks.
- [ ] I reviewed logs and error responses for sensitive-data leakage.
- [ ] I understand that my contribution will be distributed under the project's license and notices.
```

### Pull Request Size

Prefer pull requests that can be reviewed independently.

Split work when it combines:

- Refactoring and behavior changes.
- Backend and unrelated UI redesign.
- Dependency upgrades and feature work.
- Formatting and logic changes.
- Database migration and unrelated cleanup.
- Multiple security fixes with different root causes.

A maintainer may ask for a large pull request to be separated before review.

---

## Review and Merge Process

Pull requests are reviewed for:

- Correctness.
- Reproducibility.
- Security.
- Privacy.
- Authorization model.
- Auditability.
- Evidence integrity.
- Runtime-mode safety.
- Backward compatibility.
- Test quality.
- Documentation accuracy.
- Maintainability.
- Dependency and licensing risk.
- User-interface clarity.
- Accuracy of technical claims.

Review feedback should be resolved with new commits or clear discussion. Do not mark unresolved review threads as resolved unless the concern has been addressed or the reviewer agrees.

Approval does not guarantee immediate merge. A contribution may remain open while compatibility, platform behavior, legal risk, or operational impact is evaluated.

The maintainer may close contributions that:

- Fall outside project scope.
- Duplicate existing work.
- Cannot be verified.
- Introduce unacceptable risk.
- Weaken safety controls.
- Contain unlicensed or sensitive material.
- Require disproportionate maintenance without sufficient project value.

---

## Licensing and Attribution

WP MONITOR is distributed under the repository's **MIT License** together with the accompanying legal, ethical, warranty, liability, third-party, and trademark notices in the `LICENSE` file.

By submitting a contribution, you confirm that:

- You created the contribution or have the legal right to submit it.
- The contribution may be distributed under the project's license and notices.
- You have disclosed relevant third-party code, assets, datasets, or generated material.
- You have not included confidential information or code subject to incompatible terms.
- You will preserve required copyright, license, attribution, and research notices.

Do not add a different license header, contributor restriction, commercial restriction, or patent condition to individual files without prior maintainer approval.

Do not remove:

- Existing copyright notices.
- Original project attribution.
- Research citations.
- Third-party license notices.
- Deco31416 attribution.
- Trademark notices.

The MIT License grants rights to the software. It does not grant permission to use project names, logos, trademarks, or branding in a way that implies sponsorship, certification, or endorsement.

---

## AI-Assisted Contributions

AI-assisted contributions are permitted only when the human contributor takes full responsibility for the result.

The contributor must:

- Read and understand every submitted change.
- Verify that the code matches project behavior and architecture.
- Run appropriate tests.
- Check for fabricated APIs, packages, commands, citations, and security claims.
- Confirm that generated code does not reproduce incompatible copyrighted material.
- Review the output for secrets, personal data, unsafe defaults, and vulnerable patterns.
- Disclose material AI assistance when it significantly shaped the implementation or documentation.
- Be able to explain and maintain the contribution during review.

Unreviewed bulk-generated code, speculative refactors, invented test results, or documentation for nonexistent functionality will be rejected.

---

## Community Standards

Be respectful, technical, and constructive.

Expected behavior includes:

- Discussing ideas rather than attacking people.
- Giving actionable review feedback.
- Acknowledging uncertainty.
- Correcting mistakes transparently.
- Respecting privacy and confidentiality.
- Avoiding discriminatory, harassing, or threatening language.
- Not pressuring others to disclose private operational details.
- Not using project channels to request unauthorized targeting or surveillance assistance.

Repeated abusive, deceptive, unlawful, or unsafe behavior may result in contributions being closed and participation being restricted.

---

## Contact

**Maintainer:** [Deco31416](https://www.deco31416.com)<br>
**Email:** [deco31416@gmail.com](mailto:deco31416@gmail.com)<br>
**Website:** [https://www.deco31416.com](https://www.deco31416.com)

For security vulnerabilities, use the private reporting process above instead of a public issue.

---

Thank you for helping make WP MONITOR safer, clearer, more reliable, and more responsible.
