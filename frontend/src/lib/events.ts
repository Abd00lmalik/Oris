import { ethers } from "ethers";
import { contractAddresses, getDeploymentConfig, parseJob } from "@/lib/contracts";

type JobListener = (job: ReturnType<typeof parseJob>) => void;
type JobStatusListener = (status: number) => void;
type CredentialListener = (credential: { agent: string; jobId: number; credentialId: number }) => void;

function getJobContract(provider: ethers.Provider) {
  const deployment = getDeploymentConfig();
  return new ethers.Contract(
    contractAddresses.job,
    deployment.contracts.job.abi as ethers.InterfaceAbi,
    provider
  );
}

function getRegistryContract(provider: ethers.Provider) {
  const deployment = getDeploymentConfig();
  return new ethers.Contract(
    contractAddresses.validationRegistry,
    deployment.contracts.validationRegistry.abi as ethers.InterfaceAbi,
    provider
  );
}

export function subscribeToNewJobs(provider: ethers.Provider | null, onJob: JobListener): () => void {
  if (!provider) {
    return () => undefined;
  }

  const contract = getJobContract(provider);
  const handler = async (jobId: bigint) => {
    try {
      const rawJob = await contract.getJob(jobId);
      onJob(parseJob(rawJob));
    } catch {
      // Ignore transient fetch errors.
    }
  };

  contract.on("JobCreated", handler);
  return () => {
    contract.off("JobCreated", handler);
  };
}

export function subscribeToJobUpdates(
  provider: ethers.Provider | null,
  jobId: number,
  onUpdate: JobStatusListener
): () => void {
  if (!provider) {
    return () => undefined;
  }

  const contract = getJobContract(provider);
  const accepted = (eventJobId: bigint) => {
    if (Number(eventJobId) === jobId) {
      onUpdate(1);
    }
  };
  const submitted = (eventJobId: bigint) => {
    if (Number(eventJobId) === jobId) {
      onUpdate(2);
    }
  };
  const approved = (eventJobId: bigint) => {
    if (Number(eventJobId) === jobId) {
      onUpdate(3);
    }
  };
  const rejected = (eventJobId: bigint) => {
    if (Number(eventJobId) === jobId) {
      onUpdate(4);
    }
  };

  contract.on("JobAccepted", accepted);
  contract.on("DeliverableSubmitted", submitted);
  contract.on("SubmissionApproved", approved);
  contract.on("SubmissionRejected", rejected);

  return () => {
    contract.off("JobAccepted", accepted);
    contract.off("DeliverableSubmitted", submitted);
    contract.off("SubmissionApproved", approved);
    contract.off("SubmissionRejected", rejected);
  };
}

export function subscribeToCredentials(
  provider: ethers.Provider | null,
  agentAddress: string,
  onCredential: CredentialListener
): () => void {
  if (!provider || !agentAddress) {
    return () => undefined;
  }

  const normalized = agentAddress.toLowerCase();
  const contract = getRegistryContract(provider);
  const handler = (agent: string, jobId: bigint, credentialRecordId: bigint) => {
    if (agent.toLowerCase() !== normalized) {
      return;
    }
    onCredential({
      agent,
      jobId: Number(jobId),
      credentialId: Number(credentialRecordId)
    });
  };

  contract.on("CredentialIssued", handler);
  return () => {
    contract.off("CredentialIssued", handler);
  };
}
