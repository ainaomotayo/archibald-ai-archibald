import { NextResponse } from "next/server";

const ARCHIBALD_API_URL = process.env.ARCHIBALD_API_URL ?? "http://localhost:3001";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const upstreamUrl = `${ARCHIBALD_API_URL}/v1/decisions/${id}/decide`;

    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(request.headers.get("authorization")
          ? { authorization: request.headers.get("authorization")! }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Upstream error", status: response.status },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
