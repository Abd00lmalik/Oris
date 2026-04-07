import { ethers } from "hardhat";
import { getAdmin, loadContracts } from "./_setup";

const MODERATOR_ADDRESS = process.env.MODERATOR_ADDRESS;
const DISPLAY_NAME = process.env.DISPLAY_NAME ?? "Platform Admin";
const ROLE = process.env.ROLE ?? "Archon Founder";
const PROFILE_URI = process.env.PROFILE_URI ?? "";

async function main() {
  const admin = await getAdmin();
  const contracts = loadContracts();
  const communitySource = contracts.contracts.communitySource;

  if (!communitySource?.address) {
    throw new Error("CommunitySource is not deployed in contracts config.");
  }
  if (!MODERATOR_ADDRESS || !ethers.isAddress(MODERATOR_ADDRESS)) {
    throw new Error("Set MODERATOR_ADDRESS to a valid wallet address.");
  }

  const sourceRegistry = await ethers.getContractAt(
    ["function approveOperator(string,address) external", "function isApprovedFor(string,address) view returns (bool)"],
    contracts.contracts.sourceRegistry.address,
    admin
  );
  const isApproved = (await sourceRegistry.isApprovedFor("community", MODERATOR_ADDRESS)) as boolean;
  if (!isApproved) {
    const approveTx = await sourceRegistry.approveOperator("community", MODERATOR_ADDRESS);
    await approveTx.wait();
    console.log(`Approved community operator in SourceRegistry: ${MODERATOR_ADDRESS}`);
  }

  const community = await ethers.getContractAt(
    [
      "function registerModerator(address moderator,string name,string role,string profileURI) external",
      "function moderatorProfiles(address) view returns (string name,string role,string profileURI,bool active)"
    ],
    communitySource.address,
    admin
  );

  const tx = await community.registerModerator(MODERATOR_ADDRESS, DISPLAY_NAME, ROLE, PROFILE_URI);
  await tx.wait();

  const profile = await community.moderatorProfiles(MODERATOR_ADDRESS);
  console.log("Moderator registered:");
  console.log(`- wallet: ${MODERATOR_ADDRESS}`);
  console.log(`- name: ${profile.name}`);
  console.log(`- role: ${profile.role}`);
  console.log(`- active: ${profile.active}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
