export function GET() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        return Response.json({ error: "GOOGLE_CLIENT_ID is not configured" }, { status: 500 });
    }

    return Response.json({ clientId }, { headers: { "Cache-Control": "no-store" } });
}
