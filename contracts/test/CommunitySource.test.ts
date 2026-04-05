import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("CommunitySource", function () {
  async function deployFixture() {
    const [owner, moderator, recipient, other] = await ethers.getSigners();

    const sourceRegistry = await (await ethers.getContractFactory("SourceRegistry")).connect(owner).deploy();
    await sourceRegistry.waitForDeployment();

    const registry = await (await ethers.getContractFactory("ERC8004ValidationRegistry")).connect(owner).deploy();
    await registry.waitForDeployment();

    const hook = await (await ethers.getContractFactory("CredentialHook")).connect(owner).deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const community = await (await ethers.getContractFactory("CommunitySource"))
      .connect(owner)
      .deploy(await hook.getAddress(), await sourceRegistry.getAddress());
    await community.waitForDeployment();
    await hook.connect(owner).registerSourceContract(await community.getAddress(), true);

    await sourceRegistry.connect(owner).approveOperator("community", moderator.address);
    await community
      .connect(owner)
      .registerModerator(moderator.address, "ARC Community Team", "Discord Moderator", "https://x.com/abd00lmalik");

    return { owner, moderator, recipient, other, sourceRegistry, registry, hook, community };
  }

  it("awards community activity and lets recipient claim credential", async function () {
    const { moderator, recipient, registry, community } = await deployFixture();

    await community.connect(moderator).awardActivity(recipient.address, 3, "discord", "Hosted weekly dev AMA");
    await expect(community.connect(recipient).claimCredential(0))
      .to.emit(community, "CommunityCreditClaimed")
      .withArgs(0, recipient.address, 1, 120);

    const credential = await registry.getCredential(1);
    expect(credential.sourceType).to.equal("community");
    expect(credential.weight).to.equal(120);
  });

  it("blocks unauthorized operators and self-awards", async function () {
    const { moderator, recipient, other, community } = await deployFixture();
    await expect(
      community.connect(other).awardActivity(recipient.address, 0, "discord", "Helped")
    ).to.be.revertedWith("not an active moderator");

    await expect(
      community.connect(moderator).awardActivity(moderator.address, 1, "discord", "Self award")
    ).to.be.revertedWith("operator cannot self-award");
  });

  it("prevents double claims and enforces cooldown across activities", async function () {
    const { moderator, recipient, community } = await deployFixture();

    await community.connect(moderator).awardActivity(recipient.address, 1, "forum", "Moderated discussion");
    await community.connect(moderator).awardActivity(recipient.address, 2, "twitter", "Published tutorial");

    await community.connect(recipient).claimCredential(0);
    await expect(community.connect(recipient).claimCredential(0)).to.be.revertedWith("credential already claimed");
    await expect(community.connect(recipient).claimCredential(1)).to.be.revertedWith("credential cooldown active");

    await time.increase(6 * 60 * 60 + 1);
    await community.connect(recipient).claimCredential(1);
  });

  it("supports application submission and moderator approval flow", async function () {
    const { moderator, recipient, community } = await deployFixture();

    await expect(
      community
        .connect(recipient)
        .submitApplication(
          "I actively helped new users in Discord and walked them through deployment blockers with logs and fixes.",
          "https://example.com/evidence",
          "discord"
        )
    )
      .to.emit(community, "ApplicationSubmitted")
      .withArgs(0, recipient.address, "discord");

    await expect(
      community.connect(moderator).approveApplication(0, 0, "Strong evidence and direct support history.")
    )
      .to.emit(community, "ApplicationApproved")
      .withArgs(0, moderator.address);

    const app = await community.getApplication(0);
    expect(app.status).to.equal(1); // Approved
    expect(app.reviewedBy).to.equal(moderator.address);
  });

  it("supports moderator rejection and blocks non-moderator review", async function () {
    const { moderator, recipient, other, community } = await deployFixture();

    await community
      .connect(recipient)
      .submitApplication(
        "I created an extensive tutorial thread and answered follow-up questions for multiple contributors.",
        "https://example.com/thread",
        "twitter"
      );

    await expect(community.connect(other).approveApplication(0, 2, "looks good")).to.be.revertedWith(
      "not an active moderator"
    );

    await expect(
      community.connect(moderator).rejectApplication(0, "Evidence is incomplete. Please resubmit with concrete links.")
    )
      .to.emit(community, "ApplicationRejected")
      .withArgs(0, moderator.address, "Evidence is incomplete. Please resubmit with concrete links.");

    const app = await community.getApplication(0);
    expect(app.status).to.equal(2); // Rejected
    expect(app.reviewedBy).to.equal(moderator.address);
  });
});

