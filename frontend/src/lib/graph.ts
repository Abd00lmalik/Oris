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

const JOB_GRAPH_ABI = [
  "function getSubmissions(uint256 jobId) view returns (tuple(uint256 submissionId,address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward)[])",
  "function getAcceptedAgents(uint256 jobId) view returns (address[])",
  "function getSubmission(uint256 jobId,address agent) view returns (tuple(uint256 submissionId,address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward))",
  "function submissionResponseCount(uint256 submissionId) view returns (uint256)",
  "function getSubmissionResponses(uint256 submissionId) view returns (uint256[])",
  "function getResponse(uint256 responseId) view returns (tuple(uint256 responseId, uint256 parentSubmissionId, uint256 taskId, address responder, uint8 responseType, string contentURI, uint256 stakedAmount, uint256 createdAt, bool stakeSlashed, bool stakeReturned))"
] as const;

const IDENTITY_ABI = ["function balanceOf(address owner) view returns (uint256)"] as const;

type AnySubmission = {
  submissionId?: bigint | number;
  id?: bigint | number;
  agent?: string;
  deliverableLink?: string;
  status?: bigint | number;
  submittedAt?: bigint | number;
  createdAt?: bigint | number;
  [key: string]: unknown;
};

function getGraphJobContract(provider: BrowserProvider | JsonRpcProvider) {
  return new Contract(contractAddresses.job, JOB_GRAPH_ABI, provider);
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
  const graphProvider = provider ?? getReadProvider();
  const jobContract = getGraphJobContract(graphProvider);

  let submissions: AnySubmission[] = [];
  try {
    const rawSubmissions = (await jobContract.getSubmissions(taskId)) as AnySubmission[];
    submissions = Array.from(rawSubmissions);
  } catch (err) {
    console.warn("[graph] getSubmissions failed:", err);
    try {
      const agents = (await jobContract.getAcceptedAgents(taskId)) as string[];
      for (const agent of agents) {
        try {
          const sub = (await jobContract.getSubmission(taskId, agent)) as AnySubmission;
          const deliverable = toText(sub.deliverableLink ?? sub[2]);
          if (deliverable) submissions.push(sub);
        } catch {
          // ignore single agent lookup failure
        }
      }
    } catch (fallbackErr) {
      console.warn("[graph] fallback also failed:", fallbackErr);
    }
  }

  console.log("[graph] Found submissions:", submissions.length);

  if (submissions.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const identityRegistry = new Contract(
    "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    IDENTITY_ABI,
    graphProvider
  );
  const agentCache = new Map<string, boolean>();

  for (let i = 0; i < submissions.length; i += 1) {
    const sub = submissions[i];
    const agent = toAddress(sub.agent ?? sub[1] ?? "");
    const rawSubmissionId = toNum(sub.submissionId ?? sub.id ?? sub[0] ?? i + 1);
    const deliverableLink = toText(sub.deliverableLink ?? sub[2] ?? "");
    const status = toNum(sub.status ?? sub[3] ?? 0);

    if (!agent || agent.toLowerCase() === ZERO_ADDRESS.toLowerCase()) continue;

    const nodeId = `submission-${rawSubmissionId || i + 1}-${agent.slice(2, 8)}`;

    let isAgent = false;
    if (agentCache.has(agent.toLowerCase())) {
      isAgent = Boolean(agentCache.get(agent.toLowerCase()));
    } else {
      try {
        const balance = await identityRegistry.balanceOf(agent);
        isAgent = Number(balance) > 0;
      } catch {
        isAgent = false;
      }
      agentCache.set(agent.toLowerCase(), isAgent);
    }

    let responseCount = 0;
    if (rawSubmissionId > 0) {
      try {
        responseCount = Number(await jobContract.submissionResponseCount(rawSubmissionId));
      } catch {
        responseCount = 0;
      }
    }

    nodes.push({
      id: nodeId,
      type: "submission",
      submitterAddress: agent,
      contentURI: deliverableLink,
      responseCount,
      isAgent,
      isSelected: status === 2 || status === 3,
      createdAt: toNum(sub.submittedAt ?? sub.createdAt ?? sub[4] ?? 0),
      submissionId: rawSubmissionId
    });
  }

  for (const sub of submissions) {
    const submissionId = toNum(sub.submissionId ?? sub.id ?? sub[0] ?? 0);
    if (!submissionId) continue;

    try {
      const responseIds = (await jobContract.getSubmissionResponses(submissionId)) as Array<bigint | number>;

      for (const responseIdRaw of responseIds) {
        try {
          const response = (await jobContract.getResponse(responseIdRaw)) as {
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

          const parentNode = nodes.find((node) => node.submissionId === submissionId);
          if (!parentNode) continue;

          const responseNodeId = `response-${responseId}`;

          let responderIsAgent = false;
          if (responder) {
            if (agentCache.has(responder.toLowerCase())) {
              responderIsAgent = Boolean(agentCache.get(responder.toLowerCase()));
            } else {
              try {
                const balance = await identityRegistry.balanceOf(responder);
                responderIsAgent = Number(balance) > 0;
              } catch {
                responderIsAgent = false;
              }
              agentCache.set(responder.toLowerCase(), responderIsAgent);
            }
          }

          nodes.push({
            id: responseNodeId,
            type: "response",
            submitterAddress: responder,
            contentURI: toText(response.contentURI ?? response[5] ?? ""),
            responseType,
            responseCount: 0,
            isAgent: responderIsAgent,
            isSelected: false,
            createdAt: toNum(response.createdAt ?? response[7] ?? 0),
            submissionId: responseId,
            parentSubmissionId: submissionId
          });

          edges.push({
            source: responseNodeId,
            target: parentNode.id,
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

  console.log("[graph] Built graph:", nodes.length, "nodes,", edges.length, "edges");
  return { nodes, edges };
}
