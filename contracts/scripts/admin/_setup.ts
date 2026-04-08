import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";

type LoadedContracts = {
  network?: string;
  chainId?: number;
  usdcAddress?: string;
  platformFeeBps?: number;
  platformTreasury?: string;
  contracts: Record<string, { address: string }>;
};

export function loadContracts(): LoadedContracts {
  const generatedPath = path.resolve(__dirname, "../../../frontend/src/lib/generated/contracts.json");
  const deploymentsPath = path.resolve(__dirname, "../../deployments/arc_testnet.json");
  const legacyDeploymentsPath = path.resolve(__dirname, "../../deployments/arcTestnet.json");

  const targetPath = fs.existsSync(generatedPath)
    ? generatedPath
    : fs.existsSync(deploymentsPath)
      ? deploymentsPath
      : legacyDeploymentsPath;
  if (!fs.existsSync(targetPath)) {
    throw new Error("contracts.json not found. Run deployment first.");
  }

  const raw = fs.readFileSync(targetPath, "utf8");
  return JSON.parse(raw) as LoadedContracts;
}

export async function getAdmin() {
  const [admin] = await ethers.getSigners();
  if (!admin) {
    throw new Error("No admin signer available.");
  }
  console.log(`Using admin signer: ${admin.address}`);
  return admin;
}

export function formatUSDC(amount: bigint | number | string): string {
  const value =
    typeof amount === "bigint"
      ? amount
      : typeof amount === "number"
        ? BigInt(Math.trunc(amount))
        : BigInt(amount || "0");
  const normalized = ethers.formatUnits(value, 6);
  const asNumber = Number(normalized);
  if (Number.isFinite(asNumber)) {
    return `${asNumber.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} USDC`;
  }
  return `${normalized} USDC`;
}

export function formatBps(bps: bigint | number | string): string {
  const value =
    typeof bps === "bigint"
      ? Number(bps)
      : typeof bps === "number"
        ? bps
        : Number(bps || "0");
  const pct = value / 100;
  return `${pct.toFixed(2)}%`;
}
