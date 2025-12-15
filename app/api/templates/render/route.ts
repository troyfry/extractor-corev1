import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return NextResponse.json(
    { error: "Preview disabled. Use manual presets." },
    { status: 501 }
  );
}

