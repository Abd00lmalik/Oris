# Oris dApp (MVP)

Oris is a deliverable-gated, on-chain credential platform for ARC-aligned workflows.

## Core Flow

1. Client creates a job.
2. Agent accepts and submits a deliverable hash.
3. Client approves the job.
4. `MockERC8183Job` calls `CredentialHook`.
5. `CredentialHook` issues a credential in `MockERC8004ValidationRegistry`.
6. Agent sees minted credentials in profile.

## Stack

- Smart contracts: Solidity + Hardhat
- Frontend: Next.js App Router + TypeScript + Tailwind
- Web3 client: ethers v6
- Wallet: injected wallet (MetaMask compatible)
- Deployment target: Arc Testnet (USDC gas)

## Branding

- Product name: **Oris**
- Tagline: **Verifiable work. On-chain.**
- Assets:
  - `frontend/public/logo.svg`
  - `frontend/public/logo-icon.svg`
  - `frontend/public/favicon.ico`

## Project Structure

```text
credentialhook-dapp/
  contracts/
    contracts/
      MockERC8004ValidationRegistry.sol
      CredentialHook.sol
      MockERC8183Job.sol
    scripts/deploy.ts
    test/CredentialHook.test.ts
  frontend/
    public/
      logo.svg
      logo-icon.svg
      favicon.ico
    src/app/...
    src/components/...
    src/lib/generated/contracts.json
  scripts/dev.mjs
```

## Local Setup

```bash
npm install
npm run dev
```

`npm run dev` automatically starts local chain (or reuses it), deploys contracts, writes frontend addresses/ABIs, and starts Next.js.

Manual local flow:

```bash
npm run chain
npm run deploy:contracts
npm run dev:frontend
```

## Arc Testnet Deployment

Create `contracts/.env`:

```bash
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
```

Deploy:

```bash
npm run deploy:arc
```

Latest Arc deployment from this workspace:

- Validation Registry: `0x992542109CAef9e1Ac392D12aCEFC98FE64844F6`
- Credential Hook: `0x57F48Cc5ab31246C5a30cd8c52C21574c200bBc8`
- Job Contract: `0x3Df549C2D39cC0c85512c6726CfaF740e0001ff7`

## Frontend Env

`frontend/.env.production`:

```bash
NEXT_PUBLIC_ARC_RPC_URL=https://rpc.testnet.arc.network
NEXT_PUBLIC_ARC_CHAIN_ID=5042002
NEXT_PUBLIC_RPC_URL=https://rpc.testnet.arc.network
NEXT_PUBLIC_CHAIN_ID=5042002
```

## Vercel Deployment

```bash
cd frontend
npm install -g vercel
vercel login
vercel --prod
```

Set environment variables in Vercel:

- `NEXT_PUBLIC_ARC_RPC_URL=https://rpc.testnet.arc.network`
- `NEXT_PUBLIC_ARC_CHAIN_ID=5042002`

## Quality Checks

```bash
cd frontend && npx tsc --noEmit
npm run build --workspace frontend
npm test
```