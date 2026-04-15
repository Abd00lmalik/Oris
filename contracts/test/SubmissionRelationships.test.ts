import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Submission Relationships", function () {
  async function deployFixture() {
    const [owner, client, agentA, agentB, agentC, treasury] = await ethers.getSigners();

    const sourceRegistry = await (await ethers.getContractFactory("SourceRegistry")).connect(owner).deploy();
    await sourceRegistry.waitForDeployment();

    const registry = await (await ethers.getContractFactory("ERC8004ValidationRegistry")).connect(owner).deploy();
    await registry.waitForDeployment();

    const hook = await (await ethers.getContractFactory("CredentialHook")).connect(owner).deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const usdc = await (await ethers.getContractFactory("MockUSDC")).connect(owner).deploy();
    await usdc.waitForDeployment();

    const oneMillion = ethers.parseUnits("1000000", 6);
    await usdc.connect(owner).mint(client.address, oneMillion);
    await usdc.connect(owner).mint(agentA.address, oneMillion);
    await usdc.connect(owner).mint(agentB.address, oneMillion);
    await usdc.connect(owner).mint(agentC.address, oneMillion);

    const job = await (await ethers.getContractFactory("ERC8183Job"))
      .connect(owner)
      .deploy(await hook.getAddress(), await usdc.getAddress(), await sourceRegistry.getAddress(), treasury.address, 1000);
    await job.waitForDeployment();
    await hook.connect(owner).registerSourceContract(await job.getAddress(), true);

    await usdc.connect(client).approve(await job.getAddress(), oneMillion);
    await usdc.connect(agentA).approve(await job.getAddress(), oneMillion);
    await usdc.connect(agentB).approve(await job.getAddress(), oneMillion);
    await usdc.connect(agentC).approve(await job.getAddress(), oneMillion);

    return { owner, client, agentA, agentB, agentC, treasury, job, usdc };
  }

  async function createJob(job: any, client: any) {
    const deadline = (await time.latest()) + 2 * 60 * 60;
    await job
      .connect(client)
      .createJob("Build Parsing Tool", "Analyze logs and return structured output", deadline, ethers.parseUnits("300", 6), 3);
    return deadline;
  }

  async function submitBaseSubmission(job: any, agent: any) {
    await job.connect(agent).acceptJob(0);
    await job.connect(agent).submitDeliverable(0, "https://example.com/base-submission");
    const submission = await job.getSubmission(0, agent.address);
    return Number(submission.submissionId);
  }

  it("responder can build on an existing submission", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await expect(job.connect(agentB).respondToSubmission(submissionId, 0, "ipfs://builds-on"))
      .to.emit(job, "SubmissionResponseAdded");
  });

  it("responder can critique an existing submission", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://critique");
    const ids = await job.getSubmissionResponses(submissionId);
    const response = await job.getResponse(ids[0]);
    expect(response.responseType).to.equal(1);
  });

  it("responder can submit alternative to existing submission", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await job.connect(agentB).respondToSubmission(submissionId, 2, "ipfs://alternative");
    const ids = await job.getSubmissionResponses(submissionId);
    const response = await job.getResponse(ids[0]);
    expect(response.responseType).to.equal(2);
  });

  it("submitter cannot respond to their own submission", async function () {
    const { job, client, agentA } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await expect(job.connect(agentA).respondToSubmission(submissionId, 0, "ipfs://self"))
      .to.be.revertedWith("cannot respond to own submission");
  });

  it("responder cannot respond twice to same submission", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await job.connect(agentB).respondToSubmission(submissionId, 0, "ipfs://first");
    await expect(job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://second"))
      .to.be.revertedWith("already responded");
  });

  it("responding requires 2 USDC stake", async function () {
    const { job, client, agentA, agentB, usdc } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await usdc.connect(agentB).approve(await job.getAddress(), 0);
    await expect(job.connect(agentB).respondToSubmission(submissionId, 0, "ipfs://needs-stake"))
      .to.be.revertedWith("insufficient allowance");
  });

  it("stake returned after 7 days post-deadline", async function () {
    const { job, client, agentA, agentB, usdc } = await deployFixture();
    const deadline = await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await job.connect(agentB).respondToSubmission(submissionId, 0, "ipfs://stake-return");
    const ids = await job.getSubmissionResponses(submissionId);
    const responseId = ids[0];

    await expect(job.connect(agentB).returnResponseStake(responseId)).to.be.revertedWith("wait 7 days after deadline");
    await time.increaseTo(deadline + 7 * 24 * 60 * 60 + 1);
    const before = await usdc.balanceOf(agentB.address);
    await job.connect(agentB).returnResponseStake(responseId);
    const after = await usdc.balanceOf(agentB.address);
    expect(after - before).to.equal(ethers.parseUnits("2", 6));
  });

  it("creator can slash response stake - 50% slashed", async function () {
    const { job, client, agentA, agentB, usdc, treasury } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await job.connect(agentB).respondToSubmission(submissionId, 1, "ipfs://slash-me");
    const ids = await job.getSubmissionResponses(submissionId);
    const responseId = ids[0];

    const treasuryBefore = await usdc.balanceOf(treasury.address);
    const responderBefore = await usdc.balanceOf(agentB.address);

    await job.connect(client).slashResponseStake(responseId);

    const treasuryAfter = await usdc.balanceOf(treasury.address);
    const responderAfter = await usdc.balanceOf(agentB.address);
    expect(treasuryAfter - treasuryBefore).to.equal(ethers.parseUnits("1", 6));
    expect(responderAfter - responderBefore).to.equal(ethers.parseUnits("1", 6));
  });

  it("getSubmissionResponses returns correct response IDs", async function () {
    const { job, client, agentA, agentB, agentC } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await job.connect(agentB).respondToSubmission(submissionId, 0, "ipfs://r1");
    await job.connect(agentC).respondToSubmission(submissionId, 1, "ipfs://r2");
    const ids = await job.getSubmissionResponses(submissionId);
    expect(ids.length).to.equal(2);
  });

  it("response type is stored correctly on-chain", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await job.connect(agentB).respondToSubmission(submissionId, 2, "ipfs://alt");
    const ids = await job.getSubmissionResponses(submissionId);
    const response = await job.getResponse(ids[0]);
    expect(response.responseType).to.equal(2);
  });

  it("responding to closed task reverts", async function () {
    const { job, client, agentA, agentB } = await deployFixture();
    const deadline = await createJob(job, client);
    const submissionId = await submitBaseSubmission(job, agentA);
    await time.increaseTo(deadline + 1);
    await expect(job.connect(agentB).respondToSubmission(submissionId, 0, "ipfs://late"))
      .to.be.revertedWith("task closed");
  });
});
