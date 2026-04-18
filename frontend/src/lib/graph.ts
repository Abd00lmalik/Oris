import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import { contractAddresses, getReadProvider, ZERO_ADDRESS } from "@/lib/contracts";

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

const RESPONSE_TYPES: Array<GraphEdge["type"]> = ["builds_on", "critiques", "alternative"];

const JOB_GRAPH_ABI_V2 = [
  "function getSubmissions(uint256 jobId) view returns (tuple(uint256 submissionId,address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward)[])",
  "function getSubmission(uint256 jobId,address agent) view returns (tuple(uint256 submissionId,address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward))"
] as const;

const JOB_GRAPH_ABI_V1 = [
  "function getSubmissions(uint256 jobId) view returns (tuple(address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward)[])",
  "function getSubmission(uint256 jobId,address agent) view returns (tuple(address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward))"
] as const;

const JOB_GRAPH_SHARED_ABI = [
  "function getAcceptedAgents(uint256 jobId) view returns (address[])",
  "function submissionResponseCount(uint256 submissionId) view returns (uint256)",
  "function getSubmissionResponses(uint256 submissionId) view returns (uint256[])",
  "function getResponse(uint256 responseId) view returns (tuple(uint256 responseId, uint256 parentSubmissionId, uint256 taskId, address responder, uint8 responseType, string contentURI, uint256 stakedAmount, uint256 createdAt, bool stakeSlashed, bool stakeReturned))"
] as const;

type AnySubmission = {
  submissionId?: bigint | number;
  id?: bigint | number;
  agent?: string;
  submitter?: string;
  deliverableLink?: string;
  deliverable?: string;
  contentURI?: string;
  status?: bigint | number;
  submittedAt?: bigint | number;
  createdAt?: bigint | number;
  [key: string]: unknown;
};

function getGraphJobContracts(provider: BrowserProvider | JsonRpcProvider) {
  return {
    v2: new Contract(
      contractAddresses.job,
      [...JOB_GRAPH_ABI_V2, ...JOB_GRAPH_SHARED_ABI],
      provider
    ),
    v1: new Contract(
      contractAddresses.job,
      [...JOB_GRAPH_ABI_V1, ...JOB_GRAPH_SHARED_ABI],
      provider
    )
  };
}

function toNum(input: unknown): number {
  if (typeof input === "number") return input;
  if (typeof input === "bigint") return Number(input);
  const parsed = Number(input);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toAddress(input: unknown): string {
  return typeof input === "string" ? input : "";
}

function toText(input: unknown): string {
  return typeof input === "string" ? input : "";
}

export async function buildTaskGraph(
  provider: BrowserProvider | JsonRpcProvider,
  taskId: number
): Promise<TaskGraph> {
  console.log("[graph:start] taskId:", taskId);
  const graphProvider = provider ?? getReadProvider();
  const jobContracts = getGraphJobContracts(graphProvider);

  let submissions: AnySubmission[] = [];
  try {
    const rawSubmissions = (await jobContracts.v2.getSubmissions(taskId)) as AnySubmission[];
    submissions = Array.from(rawSubmissions);
    console.log("[graph:submissions] using ABI v2");
  } catch (err) {
    try {
      const rawSubmissions = (await jobContracts.v1.getSubmissions(taskId)) as AnySubmission[];
      submissions = Array.from(rawSubmissions);
      console.log("[graph:submissions] using ABI v1");
    } catch (legacyErr) {
      console.warn("[graph] getSubmissions failed (both ABIs):", err, legacyErr);
    }
  }

  console.log("[graph:submissions] raw result:", submissions);
  console.log("[graph:submissions] count:", submissions?.length ?? 0);

  if (submissions.length === 0) {
    try {
      const agents = (await jobContracts.v2.getAcceptedAgents(taskId)) as string[];
      console.log("[graph] getAcceptedAgents returned:", agents.length, "agents");
      for (const agent of agents) {
        try {
          const sub = (await jobContracts.v2.getSubmission(taskId, agent)) as AnySubmission;
          submissions.push(sub);
          continue;
        } catch {
          // try legacy signature
        }
        try {
          const sub = (await jobContracts.v1.getSubmission(taskId, agent)) as AnySubmission;
          submissions.push(sub);
        } catch {
          // ignore single lookup failure
        }
      }
    } catch (err) {
      console.warn("[graph] getAcceptedAgents fallback failed:", err);
    }
    console.log("[graph:submissions] fallback count:", submissions?.length ?? 0);
  }

  if (submissions.length === 0) {
    console.log("[graph:result]", 0, "nodes,", 0, "edges");
    return { nodes: [], edges: [] };
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const parsedSubmissionIds: Array<{ submissionId: number; nodeId: string }> = [];

  for (let i = 0; i < submissions.length; i += 1) {
    const sub = submissions[i];
    const agent = String(sub.agent ?? sub.submitter ?? sub[0] ?? sub[1] ?? "");
    const deliverableLink = String(
      sub.deliverableLink ??
        sub.deliverable ??
        sub.contentURI ??
        sub[2] ??
        sub[3] ??
        sub[1] ??
        ""
    );
    const status = toNum(sub.status ?? sub[5] ?? sub[6] ?? sub[3] ?? sub[2] ?? 0);
    const rawId = sub.submissionId ?? sub.id ?? sub[7] ?? sub[0] ?? 0n;
    const rawIdNum = toNum(rawId);
    const submissionId = rawIdNum > 0 ? rawIdNum : i + 1;

    console.log(
      "[graph:node] agent:",
      agent,
      "submissionId:",
      submissionId,
      "deliverable:",
      deliverableLink,
      "status:",
      status
    );

    if (!agent || agent.toLowerCase() === ZERO_ADDRESS.toLowerCase()) continue;

    const nodeId = `sub-${submissionId}-${agent.slice(2, 8).toLowerCase()}`;

    let responseCount = 0;
    try {
      responseCount = Number(await jobContracts.v2.submissionResponseCount(submissionId));
    } catch {
      responseCount = 0;
    }

    nodes.push({
      id: nodeId,
      type: "submission",
      submitterAddress: agent,
      contentURI: deliverableLink,
      responseCount,
      isAgent: false,
      isSelected: status === 2 || status === 3,
      createdAt: toNum(sub.submittedAt ?? sub.createdAt ?? sub[4] ?? 0),
      submissionId
    });
    parsedSubmissionIds.push({ submissionId, nodeId });
  }

  for (const parsed of parsedSubmissionIds) {
    if (!parsed.submissionId) continue;

    try {
      const responseIds = (await jobContracts.v2.getSubmissionResponses(
        parsed.submissionId
      )) as Array<bigint | number>;

      for (const responseIdRaw of responseIds) {
        try {
          const response = (await jobContracts.v2.getResponse(responseIdRaw)) as {
            responseId?: bigint | number;
            parentSubmissionId?: bigint | number;
            responder?: string;
            responseType?: bigint | number;
            contentURI?: string;
            createdAt?: bigint | number;
            [key: string]: unknown;
          };

          const responseId = toNum(response.responseId ?? response[0] ?? responseIdRaw);
          const responder = toAddress(response.responder ?? response[3] ?? "");
          const responseTypeNum = toNum(response.responseType ?? response[4] ?? 0);
          const responseType = RESPONSE_TYPES[responseTypeNum] ?? "builds_on";

          const responseNodeId = `response-${responseId}`;

          nodes.push({
            id: responseNodeId,
            type: "response",
            submitterAddress: responder,
            contentURI: toText(response.contentURI ?? response[5] ?? ""),
            responseType,
            responseCount: 0,
            isAgent: false,
            isSelected: false,
            createdAt: toNum(response.createdAt ?? response[7] ?? 0),
            submissionId: responseId,
            parentSubmissionId: parsed.submissionId
          });

          edges.push({
            source: responseNodeId,
            target: parsed.nodeId,
            type: responseType
          });
        } catch {
          // ignore broken response record
        }
      }
    } catch {
      // ignore missing responses for legacy submissions
    }
  }

  console.log("[graph:result]", nodes.length, "nodes,", edges.length, "edges");
  return { nodes, edges };
}
