import { NextResponse } from "next/server";
import contractsJson from "@/lib/generated/contracts.json";

export async function GET() {
  return NextResponse.json(contractsJson, {
    headers: {
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
