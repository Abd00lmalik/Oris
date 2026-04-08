import { ethers } from "hardhat";
import { getAdmin, loadContracts } from "./_setup";

type PendingOperator = {
  sourceType: string;
  operator: string;
  profileURI: string;
  blockNumber: number | null;
};

const SOURCE_TYPES = ["task", "agent_task", "community", "github", "job"] as const;

function keyFor(sourceType: string, operator: string) {
  return `${sourceType.toLowerCase()}:${operator.toLowerCase()}`;
}

function trunc(input: string, max = 120) {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}...`;
}

function asDate(unixSeconds: bigint | number | string) {
  const value = typeof unixSeconds === "bigint" ? Number(unixSeconds) : Number(unixSeconds);
  if (!Number.isFinite(value) || value <= 0) return "n/a";
  return new Date(value * 1000).toISOString();
}

async function main() {
  const admin = await getAdmin();
  const contracts = loadContracts();

  const sourceRegistryAddress = contracts.contracts.sourceRegistry?.address;
  const communitySourceAddress = contracts.contracts.communitySource?.address;
  if (!sourceRegistryAddress || !communitySourceAddress) {
    throw new Error("Missing SourceRegistry or CommunitySource address in contracts config.");
  }

  const sourceRegistry = await ethers.getContractAt(
    [
      "event OperatorApplied(string indexed sourceType,address indexed operator,string profileURI)",
      "event OperatorApprovalUpdated(string indexed sourceType,address indexed operator,bool approved)",
      "function getPendingApplicants(string sourceType) view returns (address[])",
      "function operatorApplications(string sourceType,address operator) view returns (string profileURI,uint256 appliedAt)"
    ],
    sourceRegistryAddress,
    admin
  );

  const communitySource = await ethers.getContractAt(
    [
      "function getPendingApplications() view returns (uint256[])",
      "function getApplication(uint256 applicationId) view returns (uint256,address,string,string,string,uint256,uint8,address,string)"
    ],
    communitySourceAddress,
    admin
  );

  const approvalState = new Map<string, boolean>();
  const appliedByKey = new Map<string, PendingOperator>();

  const approvalEvents = await sourceRegistry.queryFilter(
    sourceRegistry.filters.OperatorApprovalUpdated(),
    0,
    "latest"
  );
  for (const event of approvalEvents) {
    const sourceType = String((event.args as any)?.sourceType ?? "");
    const operator = String((event.args as any)?.operator ?? "");
    const approved = Boolean((event.args as any)?.approved);
    if (!sourceType || !operator) continue;
    approvalState.set(keyFor(sourceType, operator), approved);
  }

  const appliedEvents = await sourceRegistry.queryFilter(sourceRegistry.filters.OperatorApplied(), 0, "latest");
  for (const event of appliedEvents) {
    const sourceType = String((event.args as any)?.sourceType ?? "");
    const operator = String((event.args as any)?.operator ?? "");
    const profileURI = String((event.args as any)?.profileURI ?? "");
    if (!sourceType || !operator) continue;
    const key = keyFor(sourceType, operator);
    appliedByKey.set(key, {
      sourceType,
      operator,
      profileURI,
      blockNumber: event.blockNumber
    });
  }

  for (const sourceType of SOURCE_TYPES) {
    let applicants: string[] = [];
    try {
      applicants = (await sourceRegistry.getPendingApplicants(sourceType)) as string[];
    } catch {
      applicants = [];
    }

    for (const operator of applicants) {
      const app = (await sourceRegistry.operatorApplications(sourceType, operator)) as readonly [string, bigint];
      const key = keyFor(sourceType, operator);
      if (!appliedByKey.has(key)) {
        appliedByKey.set(key, {
          sourceType,
          operator,
          profileURI: String(app[0] ?? ""),
          blockNumber: null
        });
      }
    }
  }

  const pendingOperators: PendingOperator[] = [];
  for (const [key, row] of appliedByKey.entries()) {
    if (approvalState.get(key) === true) continue;
    pendingOperators.push(row);
  }

  pendingOperators.sort((a, b) => {
    if (a.sourceType === b.sourceType) return a.operator.localeCompare(b.operator);
    return a.sourceType.localeCompare(b.sourceType);
  });

  console.log("\n=== PENDING SOURCE REGISTRY APPLICATIONS ===");
  if (pendingOperators.length === 0) {
    console.log("No pending operator applications.");
  } else {
    for (const row of pendingOperators) {
      console.log(`\n- Source Type: ${row.sourceType}`);
      console.log(`  Address: ${row.operator}`);
      console.log(`  Profile URI: ${row.profileURI || "(empty)"}`);
      console.log(`  Block: ${row.blockNumber ?? "n/a"}`);
      console.log("  Approve command:");
      console.log("  1) Edit SOURCE_TYPE and APPLICANT_ADDRESS in scripts/admin/approve-operator.ts");
      console.log("  2) npx hardhat run scripts/admin/approve-operator.ts --network arc_testnet");
    }
  }

  console.log("\n=== PENDING COMMUNITY APPLICATIONS ===");
  const pendingCommunityIds = (await communitySource.getPendingApplications()) as bigint[];
  if (pendingCommunityIds.length === 0) {
    console.log("No pending community applications.");
  } else {
    for (const idRaw of pendingCommunityIds) {
      const id = Number(idRaw);
      const app = (await communitySource.getApplication(idRaw)) as readonly [
        bigint,
        string,
        string,
        string,
        string,
        bigint,
        number,
        string,
        string
      ];
      const applicant = String(app[1] ?? "");
      const description = String(app[2] ?? "");
      const platform = String(app[4] ?? "");
      const submittedAt = app[5] ?? 0n;
      console.log(`\n- Application ID: ${id}`);
      console.log(`  Applicant: ${applicant}`);
      console.log(`  Description: ${trunc(description, 120)}`);
      console.log(`  Platform: ${platform}`);
      console.log(`  Submitted: ${asDate(submittedAt)}`);
      console.log("  Approve command:");
      console.log("  1) Edit APPLICATION_ID, ACTIVITY_TYPE, REVIEW_NOTE in scripts/admin/approve-community.ts");
      console.log("  2) npx hardhat run scripts/admin/approve-community.ts --network arc_testnet");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

