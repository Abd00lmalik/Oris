import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("CredentialHook + ERC8183Job", function () {
  async function deployFixture() {
    const [owner, client, agentA, agentB, other] = await ethers.getSigners();

    const registryFactory = await ethers.getContractFactory("ERC8004ValidationRegistry");
    const registry: any = await registryFactory.connect(owner).deploy();
    await registry.waitForDeployment();

    const hookFactory = await ethers.getContractFactory("CredentialHook");
    const hook: any = await hookFactory.connect(owner).deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const jobFactory = await ethers.getContractFactory("ERC8183Job");
    const job: any = await jobFactory.connect(owner).deploy(await hook.getAddress());
    await job.waitForDeployment();
    await hook.connect(owner).registerJobContract(await job.getAddress(), true);

    return { owner, client, agentA, agentB, other, registry, hook, job };
  }

  async function createJobWithFutureDeadline(job: any, client: any) {
    const deadline = (await time.latest()) + 24 * 60 * 60;
    const rewardUSDC = 250_000_000n; // 250 USDC (6 decimals)
    await job.connect(client).createJob("Build Landing", "Ship responsive page", deadline, rewardUSDC);
    return { deadline, rewardUSDC };
  }

  it("deploys all contracts with authorization wiring", async function () {
    const { owner, registry, hook, job } = await deployFixture();
    expect(await registry.authorizedIssuers(await hook.getAddress())).to.equal(true);
    expect(await hook.registeredJobContracts(await job.getAddress())).to.equal(true);
    expect(await hook.owner()).to.equal(owner.address);
  });

  it("creates a job with deadline + reward", async function () {
    const { job, client } = await deployFixture();
    const deadline = (await time.latest()) + 3600;
    const rewardUSDC = 50_000_000n;

    await expect(job.connect(client).createJob("Title", "Description", deadline, rewardUSDC))
      .to.emit(job, "JobCreated")
      .withArgs(0, client.address, "Title", "Description", deadline, rewardUSDC);

    const record = await job.getJob(0);
    expect(record.client).to.equal(client.address);
    expect(record.deadline).to.equal(deadline);
    expect(record.rewardUSDC).to.equal(rewardUSDC);
  });

  it("prevents creating jobs with past deadline", async function () {
    const { job, client } = await deployFixture();
    const past = (await time.latest()) - 1;
    await expect(job.connect(client).createJob("Title", "Description", past, 10_000_000n)).to.be.revertedWith(
      "deadline must be future"
    );
  });

  it("allows multiple agents to accept the same job", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJobWithFutureDeadline(job, client);

    await job.connect(agentA).acceptJob(0);
    await job.connect(agentB).acceptJob(0);

    const accepted = await job.getAcceptedAgents(0);
    expect(accepted[0]).to.equal(agentA.address);
    expect(accepted[1]).to.equal(agentB.address);
  });

  it("blocks accepting after deadline", async function () {
    const { job, client, agentA } = await deployFixture();
    const deadline = (await time.latest()) + 120;
    await job.connect(client).createJob("Title", "Description", deadline, 10_000_000n);

    await time.increaseTo(deadline + 1);
    await expect(job.connect(agentA).acceptJob(0)).to.be.revertedWith("job deadline passed");
  });

  it("stores raw deliverable links from accepted agents", async function () {
    const { job, client, agentA } = await deployFixture();
    await createJobWithFutureDeadline(job, client);
    await job.connect(agentA).acceptJob(0);

    await expect(job.connect(agentA).submitDeliverable(0, "https://example.com/work/123"))
      .to.emit(job, "DeliverableSubmitted")
      .withArgs(0, agentA.address, "https://example.com/work/123");

    const submissions = await job.getSubmissions(0);
    expect(submissions.length).to.equal(1);
    expect(submissions[0].deliverableLink).to.equal("https://example.com/work/123");
  });

  it("blocks non-accepted users from submitting", async function () {
    const { job, client, other } = await deployFixture();
    await createJobWithFutureDeadline(job, client);

    await expect(job.connect(other).submitDeliverable(0, "https://x.com/work")).to.be.revertedWith(
      "accept job first"
    );
  });

  it("lets client approve specific submissions", async function () {
    const { job, client, agentA } = await deployFixture();
    await createJobWithFutureDeadline(job, client);
    await job.connect(agentA).acceptJob(0);
    await job.connect(agentA).submitDeliverable(0, "ipfs://approved");

    await expect(job.connect(client).approveSubmission(0, agentA.address))
      .to.emit(job, "SubmissionApproved")
      .withArgs(0, agentA.address);

    const submission = await job.getSubmission(0, agentA.address);
    expect(submission.status).to.equal(2); // Approved
  });

  it("lets client reject specific submissions", async function () {
    const { job, client, agentA } = await deployFixture();
    await createJobWithFutureDeadline(job, client);
    await job.connect(agentA).acceptJob(0);
    await job.connect(agentA).submitDeliverable(0, "ipfs://needs-work");

    await expect(job.connect(client).rejectSubmission(0, agentA.address, "Insufficient quality"))
      .to.emit(job, "SubmissionRejected")
      .withArgs(0, agentA.address, "Insufficient quality");

    const submission = await job.getSubmission(0, agentA.address);
    expect(submission.status).to.equal(3); // Rejected
    expect(submission.reviewerNote).to.equal("Insufficient quality");
  });

  it("prevents non-client from reviewing submissions", async function () {
    const { job, client, agentA, other } = await deployFixture();
    await createJobWithFutureDeadline(job, client);
    await job.connect(agentA).acceptJob(0);
    await job.connect(agentA).submitDeliverable(0, "ipfs://demo");

    await expect(job.connect(other).approveSubmission(0, agentA.address)).to.be.revertedWith("only client can review");
    await expect(job.connect(other).rejectSubmission(0, agentA.address, "No")).to.be.revertedWith(
      "only client can review"
    );
  });

  it("allows only approved submitter to claim credential", async function () {
    const { job, registry, client, agentA, agentB } = await deployFixture();
    await createJobWithFutureDeadline(job, client);
    await job.connect(agentA).acceptJob(0);
    await job.connect(agentB).acceptJob(0);
    await job.connect(agentA).submitDeliverable(0, "ipfs://good");
    await job.connect(agentB).submitDeliverable(0, "ipfs://bad");
    await job.connect(client).approveSubmission(0, agentA.address);
    await job.connect(client).rejectSubmission(0, agentB.address, "Missing requirements");

    await expect(job.connect(agentA).claimCredential(0))
      .to.emit(job, "CredentialClaimed")
      .withArgs(0, agentA.address, 1)
      .and.to.emit(registry, "CredentialIssued")
      .withArgs(agentA.address, 0, 1, anyValue);

    expect(await registry.hasCredential(agentA.address, 0)).to.equal(true);
    await expect(job.connect(agentB).claimCredential(0)).to.be.revertedWith("submission not approved");
    await expect(job.connect(agentA).claimCredential(0)).to.be.revertedWith("credential already claimed");
  });

  it("reverts when unregistered caller hits hook", async function () {
    const { hook, other } = await deployFixture();
    await expect(hook.connect(other).onJobComplete(other.address, 1)).to.be.revertedWith("job contract not registered");
  });
});
