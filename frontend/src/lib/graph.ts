import {
  ZERO_ADDRESS,
  fetchArcIdentityForWallet,
  fetchSubmissions,
  getJobReadContract,
  type SubmissionRecord
} from "@/lib/contracts";

export interface GraphNode {
  id: string;
  type: "submission" | "response";
  submitterAddress: string;
  contentURI: string;
  responseType?: "builds_on" | "critiques" | "alternative";
  responseCount: number;
  isAgent: boolean;
  isSelected: boolean;
  createdAt: number;
  submissionId?: number;
  parentSubmissionId?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "builds_on" | "critiques" | "alternative";
}

export interface TaskGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const RESPONSE_TYPE_MAP: Record<number, GraphEdge["type"]> = {
  0: "builds_on",
  1: "critiques",
  2: "alternative"
};

async function detectAgentAddress(address: string): Promise<boolean> {
  if (!address || address === ZERO_ADDRESS) return false;
  try {
    const identity = await fetchArcIdentityForWallet(address);
    return !!identity;
  } catch {
    return false;
  }
}

function toSubmissionNode(submission: SubmissionRecord, isAgent: boolean): GraphNode {
  return {
    id: `submission-${submission.submissionId}`,
    type: "submission",
    submitterAddress: submission.agent,
    contentURI: submission.deliverableLink,
    responseCount: 0,
    isAgent,
    isSelected: false,
    createdAt: submission.submittedAt,
    submissionId: submission.submissionId
  };
}

export async function buildTaskGraph(_provider: unknown, taskId: number): Promise<TaskGraph> {
  const job = getJobReadContract();
  const submissions = await fetchSubmissions(taskId);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const participantSet = new Set<string>();
  for (const submission of submissions) {
    if (submission.agent && submission.agent !== ZERO_ADDRESS) {
      participantSet.add(submission.agent.toLowerCase());
    }
  }

  for (const submission of submissions) {
    if (submission.submissionId === undefined || submission.submissionId === null) {
      continue;
    }
    const isAgent = await detectAgentAddress(submission.agent);
    nodes.push(toSubmissionNode(submission, isAgent));
  }

  for (const submission of submissions) {
    if (submission.submissionId === undefined || submission.submissionId === null) {
      continue;
    }

    const sid = BigInt(submission.submissionId);
    const responseIds = (await job.getSubmissionResponses(sid)) as bigint[];
    const responseCount = Number(await job.submissionResponseCount(sid));
    const submissionNode = nodes.find((node) => node.id === `submission-${submission.submissionId}`);
    if (submissionNode) {
      submissionNode.responseCount = responseCount;
    }

    for (const responseId of responseIds) {
      const raw = await job.getResponse(responseId);
      const responseType = RESPONSE_TYPE_MAP[Number(raw.responseType)] ?? "builds_on";
      const responderAddress = String(raw.responder);
      participantSet.add(responderAddress.toLowerCase());
      const responderIsAgent = await detectAgentAddress(responderAddress);

      nodes.push({
        id: `response-${Number(raw.responseId)}`,
        type: "response",
        submitterAddress: responderAddress,
        contentURI: String(raw.contentURI),
        responseType,
        responseCount: 0,
        isAgent: responderIsAgent,
        isSelected: false,
        createdAt: Number(raw.createdAt),
        submissionId: Number(raw.responseId),
        parentSubmissionId: Number(raw.parentSubmissionId)
      });

      edges.push({
        source: `response-${Number(raw.responseId)}`,
        target: `submission-${Number(raw.parentSubmissionId)}`,
        type: responseType
      });
    }
  }

  return { nodes, edges };
}
