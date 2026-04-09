import { NextResponse } from "next/server";

const ARCHIBALD_API_URL = process.env.ARCHIBALD_API_URL ?? "http://localhost:3001";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const upstreamUrl = `${ARCHIBALD_API_URL}/v1/decisions${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(upstreamUrl, {
      headers: {
        "Content-Type": "application/json",
        ...(request.headers.get("authorization")
          ? { authorization: request.headers.get("authorization")! }
          : {}),
      },
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
