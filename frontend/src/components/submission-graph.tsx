"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { GraphEdge, GraphNode, TaskGraph } from "@/lib/graph";

interface SubmissionGraphProps {
  graph: TaskGraph;
  onNodeClick: (node: GraphNode) => void;
  selectedNodeId: string | null;
}

type SimNode = GraphNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & GraphEdge;

function nodeKey(node: SimNode) {
  return node.id;
}

function nodeFromLinkEnd(end: string | number | SimNode): SimNode | null {
  if (typeof end === "string" || typeof end === "number") return null;
  return end;
}

export default function SubmissionGraph({ graph, onNodeClick, selectedNodeId }: SubmissionGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || graph.nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const nodes: SimNode[] = graph.nodes.map((item) => ({ ...item }));
    const links: SimLink[] = graph.edges.map((item) => ({ ...item }));

    svg.selectAll("*").remove();

    const container = svg.append("g");
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      });
    svg.call(zoom);

    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force("link", d3.forceLink<SimNode, SimLink>(links).id(nodeKey).distance(120))
      .force("charge", d3.forceManyBody<SimNode>().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<SimNode>().radius(40));

    const edgeColors: Record<GraphEdge["type"], string> = {
      builds_on: "#00FFC8",
      critiques: "#F97316",
      alternative: "#2DE2FF"
    };

    const link = container
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (item) => edgeColors[item.type])
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", (item) => (item.type === "critiques" ? "5,5" : item.type === "alternative" ? "2,4" : "none"))
      .attr("opacity", 0.65);

    const nodeColors = {
      human_submission: "#00FFC8",
      agent_submission: "#8B5CF6",
      human_response: "#145B7D",
      agent_response: "#4C1D95"
    };

    const node = container
      .append("g")
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (item) => Math.max(12, 12 + item.responseCount * 3))
      .attr("fill", (item) => {
        if (item.isSelected || item.id === selectedNodeId) return "#F59E0B";
        const key = `${item.isAgent ? "agent" : "human"}_${item.type}` as keyof typeof nodeColors;
        return nodeColors[key] ?? "#145B7D";
      })
      .attr("stroke", (item) => (item.id === selectedNodeId ? "#FFFFFF" : "transparent"))
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .call(
        d3
          .drag<SVGCircleElement, SimNode>()
          .on("start", (event, item) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            item.fx = item.x;
            item.fy = item.y;
          })
          .on("drag", (event, item) => {
            item.fx = event.x;
            item.fy = event.y;
          })
          .on("end", (event, item) => {
            if (!event.active) simulation.alphaTarget(0);
            item.fx = null;
            item.fy = null;
          })
      )
      .on("click", (event, item) => {
        event.stopPropagation();
        onNodeClick(item);
      });

    const labels = container
      .append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text((item) => (item.isAgent ? "A" : "H"))
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", "#0A1F2E")
      .attr("font-size", "9px")
      .style("font-weight", "700")
      .style("pointer-events", "none");

    node.append("title").text((item) => `${item.isAgent ? "[Agent]" : "[Human]"} ${item.submitterAddress.slice(0, 10)}...`);

    simulation.on("tick", () => {
      link
        .attr("x1", (item) => nodeFromLinkEnd(item.source)?.x ?? 0)
        .attr("y1", (item) => nodeFromLinkEnd(item.source)?.y ?? 0)
        .attr("x2", (item) => nodeFromLinkEnd(item.target)?.x ?? 0)
        .attr("y2", (item) => nodeFromLinkEnd(item.target)?.y ?? 0);

      node.attr("cx", (item) => item.x ?? 0).attr("cy", (item) => item.y ?? 0);
      labels.attr("x", (item) => item.x ?? 0).attr("y", (item) => item.y ?? 0);
    });

    return () => {
      simulation.stop();
    };
  }, [graph, onNodeClick, selectedNodeId]);

  return (
    <svg
      ref={svgRef}
      className="w-full rounded-2xl border border-white/10 bg-[#0A101A]"
      style={{ minHeight: "520px" }}
    />
  );
}
