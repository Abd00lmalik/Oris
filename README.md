# Archon — Universal On-Chain Reputation

Archon is a multi-source on-chain reputation platform on Arc Testnet.  
Users earn verifiable credentials from tasks, agentic tasks, community work, peer attestations, DAO governance participation, and milestone contracts with escrow/disputes.

Live App: https://archon-dapp.vercel.app  
Network: Arc Testnet (Chain ID: 5042002)

## Deployed Contracts (Arc Testnet)
| Contract | Address |
|---|---|
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

## Navigation Guide
- `/` — Tasks home feed, stats, and open task listings.
- `/earn` — Explains all credential sources and scoring.
- `/tasks` — Agentic tasks hub (available, my tasks, post task).
- `/my-work` — Personal dashboard for posted/accepted work.
- `/milestones` — Contracts page for milestone escrow and disputes.
- `/profile` — Wallet profile, score, tiers, and credentials.
- `/apply` — Apply to become an approved operator.
- `/community` — Community applications and moderator review.
- `/attest` — Peer vouching (Keystone-gated).
- `/governance` — Claim governance participation credentials.
- `/create-job` — Create a task (approved operators only).
- `/job/[jobId]` — Task detail and submission/review lifecycle.

## Admin CLI Commands
Run from `contracts/`:

```bash
# Check platform stats
npx hardhat run scripts/admin/platform-stats.ts --network arc_testnet

# List pending applications
npx hardhat run scripts/admin/list-pending.ts --network arc_testnet

# Approve a task creator (edit address in script first)
npx hardhat run scripts/admin/approve-operator.ts --network arc_testnet

# Add a community moderator (edit address in script first)
npx hardhat run scripts/admin/add-moderator.ts --network arc_testnet

# Add a DAO governor (edit address in script first)
npx hardhat run scripts/admin/add-governor.ts --network arc_testnet

# Add dispute arbitrator (edit address in script first)
npx hardhat run scripts/admin/add-arbitrator.ts --network arc_testnet
```

## MetaMask Setup (Arc Testnet)
1. Open MetaMask.
2. Click the network dropdown.
3. Click "Add Network" and then "Add a network manually".
4. Enter:
   - Network Name: `Arc Testnet`
   - RPC URL: `https://rpc.testnet.arc.network`
   - Chain ID: `5042002`
   - Currency Symbol: `USDC`
   - Block Explorer URL: `https://testnet.arcscan.app`
5. Save and switch to Arc Testnet.

## Local Development
```bash
# Install dependencies at repo root
npm install

# Compile and test contracts
cd contracts
npx hardhat compile
npx hardhat test

# Run frontend
cd ../frontend
npm install
npm run dev
```

