import { NextResponse } from "next/server";

import { scanWorkspace } from "../../../lib/workspace-scanner";

export const dynamic = "force-dynamic";

export async function GET() {
  const scan = await scanWorkspace(process.cwd());

  return NextResponse.json(scan, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
