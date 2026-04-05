import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("PeerAttestationSource", function () {
  async function deployFixture() {
    const [owner, attester, recipient, altRecipient] = await ethers.getSigners();

    const registry = await (await ethers.getContractFactory("ERC8004ValidationRegistry")).connect(owner).deploy();
    await registry.waitForDeployment();

    const hook = await (await ethers.getContractFactory("CredentialHook")).connect(owner).deploy(await registry.getAddress());
    await hook.waitForDeployment();
    await registry.connect(owner).authorizeIssuer(await hook.getAddress(), true);

    const peer = await (await ethers.getContractFactory("PeerAttestationSource"))
      .connect(owner)
      .deploy(await hook.getAddress(), await registry.getAddress());
    await peer.waitForDeployment();
    await hook.connect(owner).registerSourceContract(await peer.getAddress(), true);

    return { owner, attester, recipient, altRecipient, registry, hook, peer };
  }

  it("issues peer attestations and auto-mints recipient credentials", async function () {
    const { owner, attester, recipient, registry, peer } = await deployFixture();

    // Bootstrap attester to Keystone threshold (>= 1000 points).
    await registry.connect(owner).issue(attester.address, 999, "job", 1000);

    await expect(
      peer
        .connect(attester)
        .attest(
          recipient.address,
          "technical",
          "Great architecture review with concrete implementation guidance and validation support."
        )
    )
      .to.emit(peer, "AttestationIssued")
      .withArgs(0, attester.address, recipient.address, "technical", 2, 60);

    const minted = await registry.getCredential(2);
    expect(minted.agent).to.equal(recipient.address);
    expect(minted.sourceType).to.equal("peer_attestation");
    expect(minted.weight).to.equal(60);
  });

  it("blocks self-attestation and requires attester credentials", async function () {
    const { attester, recipient, peer } = await deployFixture();

    await expect(
      peer
        .connect(attester)
        .attest(
          attester.address,
          "technical",
          "This is a deliberately verbose self-attestation note to satisfy minimum length."
        )
    ).to.be.revertedWith(
      "cannot attest self"
    );
    await expect(
      peer
        .connect(attester)
        .attest(
          recipient.address,
          "technical",
          "Meaningful detailed note that still should fail due to insufficient attester score."
        )
    ).to.be.revertedWith(
      "reach Keystone tier (1000 pts) to give attestations"
    );
  });

  it("enforces weekly anti-spam caps for attesters and recipients", async function () {
    const { owner, attester, recipient, altRecipient, registry, peer } = await deployFixture();
    await registry.connect(owner).issue(attester.address, 1, "job", 1000);

    await peer
      .connect(attester)
      .attest(
        recipient.address,
        "community",
        "First attestation note includes enough detail for reviewer confidence and historical trace."
      );
    await expect(
      peer
        .connect(attester)
        .attest(
          recipient.address,
          "community",
          "Second attestation note also detailed but should fail due to recipient weekly cap."
        )
    ).to.be.revertedWith(
      "recipient weekly cap reached"
    );

    await peer
      .connect(attester)
      .attest(
        altRecipient.address,
        "technical",
        "Third recipient note exceeds minimum length and should consume the final weekly slot."
      );
    await expect(
      peer
        .connect(attester)
        .attest(
          owner.address,
          "technical",
          "Fourth attestation note should fail because weekly attestation cap is now two."
        )
    ).to.be.revertedWith(
      "weekly attestation cap"
    );

    await time.increase(7 * 24 * 60 * 60 + 1);
    await peer
      .connect(attester)
      .attest(
        owner.address,
        "technical",
        "After reset note should now pass because weekly counters are rolled over to a new window."
      );
  });

  it("prevents mutual attestation loops between two wallets", async function () {
    const { owner, attester, recipient, registry, peer } = await deployFixture();
    await registry.connect(owner).issue(attester.address, 1, "job", 1000);
    await registry.connect(owner).issue(recipient.address, 2, "job", 1000);

    await peer
      .connect(attester)
      .attest(
        recipient.address,
        "technical",
        "Recipient delivered strong technical outcomes with reproducible output evidence over multiple tasks."
      );

    await expect(
      peer
        .connect(recipient)
        .attest(
          attester.address,
          "technical",
          "Attempting reverse attestation should fail due to anti-reciprocity protection in the source."
        )
    ).to.be.revertedWith("this person has already attested you - mutual attestations not allowed");
  });
});
