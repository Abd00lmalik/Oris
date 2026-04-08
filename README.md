# Archon: Multi-Source On-Chain Reputation

Archon is a multi-source on-chain reputation platform built on the Arc Testnet. It enables users to earn verifiable credentials through task completion, agentic workflows, community contributions, peer attestations, and DAO governance participation.

**Live App:** [https://archon-dapp.vercel.app](https://archon-dapp.vercel.app)
**Network:** Arc Testnet (Chain ID: 5042002)

---

## Deployed Contracts (Arc Testnet)

| Contract | Address |
| :--- | :--- |
| SourceRegistry | `0xa25C501C62e60EF1F03c37400b4FBDf2775d18Bf` |
| ValidationRegistry | `0xCC2813327a5e2ce43a7bf78ed59d2D21BBB66b1B` |
| CredentialHook | `0x23d66b8eb42Cc1f51F37b879A3dbC15252684Db2` |
| ERC8183Job | `0xE57DE7e8dA52e76f8Ab9b88697306Ef49Fa633b9` |
| GitHubSource | `0xa67851a3DaFF1a3082e30ab1E5bd0B3fDBE21b55` |
| CommunitySource | `0x0a7c1B0dB4Cc6bE3A95e5BC1B99065b91b725353` |
| AgentTaskSource | `0xbE7e13b78DA31b1249B52083C4B4eF02FE9a6A21` |
| PeerAttestationSource | `0x6A42a8bFeBE96E94d06C5bcBfA303E984f85Ae27` |
| DAOGovernanceSource | `0xe42Bf6A67899a82E2AA7DE9DE74f8a30a338f457` |
| MilestoneEscrow | `0xb958a8CC159D8E2d079E7f26B9D3E6E8340D5d78` |
| USDC (Arc ERC-20) | `0x3600000000000000000000000000000000000000` |
| Platform Treasury | `0x25265b9dBEb6c653b0CA281110Bb0697a9685107` |

---

## Navigation Guide

* `/` — Tasks home feed, global stats, and open task listings.
* `/earn` — Overview of all credential sources and scoring mechanics.
* `/tasks` — Agentic tasks hub (Available, Active, and Post Task).
* `/my-work` — Personal dashboard for posted and accepted work.
* `/milestones` — Dedicated contracts page for milestone escrow and disputes.
* `/profile` — Wallet profile, reputation score, tiers, and credentials timeline.
* `/apply` — Application portal to become an approved operator.
* `/community` — Community applications and moderator review interface.
* `/attest` — Peer vouching system (Keystone-gated).
* `/governance` — Portal to claim governance participation credentials.
* `/create-job` — Task creation interface (Approved operators only).
* `/job/[jobId]` — Task lifecycle management (Submission, Review, and Claims).

---

## 1. Core Concepts

### 1.1 Problem & Solution
Current "proof of work" is often trivial to fake via screenshots or unverifiable links. Archon solves this by enforcing work events through smart contracts.
* **Verification:** Successful completion mints immutable credentials.
* **Trust:** Reputation is computed from on-chain evidence, not self-written bios.
* **Transparency:** All verification is public and reproducible on the Arc explorer.

### 1.2 On-Chain Credentials
A credential is a permanent record of a specific verified activity.
* **Unforgeable:** Only authorized issuer contracts can mint into the registry.
* **Non-Transferable:** Records are keyed to specific wallet addresses; there is no transfer function.
* **Immutable:** Credentials are append-only; the registry does not expose a delete or revoke endpoint.

### 1.3 The Arc Network
Archon is native to the Arc Testnet. The application is optimized for Arc's USDC-native UX, where transaction checks and explorer links are wired directly to Arc chain ID `5042002`.

---

## 2. Earning Credentials

### Source 1: Standard Tasks (ERC8183Job)
* **Process:** Accept task -> Submit deliverable URL -> Creator approval -> Claim reward + credential.
* **Reputation:** +100 points per task.
* **Controls:** Requires creator stake, minimum durations, and a 6-hour global claim cooldown.

### Source 2: Agentic Tasks (AgentTaskSource)
* **Process:** Designed for machine-readable outputs and autonomous workflows.
* **Reputation:** +130 points per task.
* **Controls:** Poster cannot claim own task; requires validation delay.

### Source 3: Community Work (CommunitySource)
* **Process:** Submit application (Discord help, moderation, content, bug reports) for moderator review.
* **Reputation:** Varies by type (50 to 120 points).
* **Controls:** 50+ character description required; moderator roles are revocable.

### Source 4: Peer Vouching (PeerAttestationSource)
* **Process:** High-trust endorsements between users.
* **Reputation:** +60 points.
* **Controls:** Only **Keystone** tier (1000+ score) can attest. Mutual attestation is blocked. Limit of 2 given per week.

### Source 5: DAO Governance (DAOGovernanceSource)
* **Process:** Input governor address and proposal ID to prove voting history.
* **Reputation:** +90 points.
* **Controls:** Direct on-chain check of `hasVoted` state. One claim per proposal.

---

## 3. Reputation Score and Tiers

### 3.1 Scoring Formula
Total score is the sum of all credential weights, capped at **2000 points** to prevent runaway inflation.

### 3.2 Tier Thresholds
* **Surveyor:** 0–99
* **Draftsman:** 100–299
* **Architect:** 300–599
* **Master Builder:** 600–999
* **Keystone:** 1000–1499 (Unlocks ability to give Peer Attestations)
* **Arc Founder:** 1500+

---

## 4. Operational Guides

### For Contributors
1.  Connect wallet at `/`.
2.  Select a task and click **Accept Task**.
3.  Submit a valid URL (GitHub, IPFS, etc.) via **Submit Work**.
4.  Once approved, click **Claim USDC + Credential**.

### For Task Creators
1.  Apply for operator status at `/apply`.
2.  Once approved, use `/create-job` to set title, reward, and max winners.
3.  **Step 1:** Approve USDC allowance.
4.  **Step 2:** Post Task to escrow funds.
5.  Review submissions at `/job/[jobId]` and approve/reject based on deliverable quality.

### For Milestone Contracts (B2B/Freelance)
1.  Navigate to `/milestones` and select **New Contract**.
2.  Enter freelancer wallet and define multiple milestones.
3.  Fund milestones individually to trigger work.
4.  **Dispute Window:** 48-hour window exists after submission. If the client is silent, the freelancer can trigger an **Auto-Release**.
5.  **Arbitration:** Disputed milestones are resolved by 3 assigned arbitrators.

---

## 5. Technical Specifications

### 5.1 Decimal Handling
* **Network Currency:** Displayed as 18 decimals in MetaMask.
* **USDC (ERC-20):** Archon uses **6 decimals** for all contract math, transfers, and reward allocations.

### 5.2 Key Standards
* **ERC-8004:** Credential registry model focused on issuance rather than trading.
* **ERC-8183:** Structured job lifecycle for verifiable proof-of-completion.

---

## 6. Network Configuration

To use Archon, add the following network to your MetaMask:

* **Network Name:** Arc Testnet
* **RPC URL:** `https://rpc.testnet.arc.network`
* **Chain ID:** `5042002`
* **Currency Symbol:** `USDC`
* **Block Explorer URL:** `https://testnet.arcscan.app`

**Faucet:** Request testnet funds at `faucet.arc.network`.
