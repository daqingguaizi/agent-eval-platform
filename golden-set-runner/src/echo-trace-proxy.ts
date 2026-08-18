import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const port = Number(process.env.ECHO_TRACE_PROXY_PORT || 19998);
const upstreamBaseUrl = process.env.ECHO_TRACE_UPSTREAM || "http://127.0.0.1:19999";
const upstreamApiKey = process.env.ECHO_TRACE_UPSTREAM_API_KEY || "";
const traceDir = process.env.ECHO_TRACE_DIR || path.resolve(import.meta.dirname, "..", "runs", "echo-network-traces");

fs.mkdirSync(traceDir, { recursive: true });

let requestSequence = 0;

function corsHeaders() {
    return {
        "access-control-allow-origin": "http://127.0.0.1:3000",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, accept",
    };
}

function readBody(request: http.IncomingMessage) {
    return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        request.on("end", () => resolve(Buffer.concat(chunks)));
        request.on("error", reject);
    });
}

function safeHeaders(headers: http.IncomingHttpHeaders) {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, key.toLowerCase() === "authorization" ? "<redacted>" : value]));
}

function requestFileName(sequence: number, suffix: string) {
    return `${new Date().toISOString().replaceAll(":", "-")}-${String(sequence).padStart(3, "0")}.${suffix}`;
}

const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders());
        response.end();
        return;
    }

    const sequence = ++requestSequence;
    const requestBody = await readBody(request);
    const requestName = requestFileName(sequence, "request.json");
    fs.writeFileSync(
        path.join(traceDir, requestName),
        JSON.stringify(
            {
                sequence,
                receivedAt: new Date().toISOString(),
                method: request.method,
                path: request.url,
                headers: safeHeaders(request.headers),
                body: requestBody.length ? JSON.parse(requestBody.toString("utf8")) : null,
            },
            null,
            2,
        ),
    );

    try {
        const upstream = await fetch(`${upstreamBaseUrl}${request.url || "/"}`, {
            method: request.method,
            headers: {
                "content-type": request.headers["content-type"] || "application/json",
                ...(upstreamApiKey ? { authorization: `Bearer ${upstreamApiKey}` } : {}),
            },
            body: request.method === "GET" || request.method === "HEAD" ? undefined : new Uint8Array(requestBody),
        });
        const responseName = requestFileName(sequence, upstream.headers.get("content-type")?.includes("text/event-stream") ? "response.sse" : "response.txt");
        const responseFile = fs.createWriteStream(path.join(traceDir, responseName));
        response.writeHead(upstream.status, {
            ...corsHeaders(),
            "content-type": upstream.headers.get("content-type") || "application/octet-stream",
            "cache-control": upstream.headers.get("cache-control") || "no-cache",
        });
        if (!upstream.body) {
            responseFile.end();
            response.end();
            return;
        }
        const reader = upstream.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            responseFile.write(chunk);
            response.write(chunk);
        }
        responseFile.end();
        response.end();
    } catch (error) {
        response.writeHead(502, { ...corsHeaders(), "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
    }
});

server.listen(port, "127.0.0.1", () => {
    console.log(`Echo trace proxy listening on http://127.0.0.1:${port}; upstream=${upstreamBaseUrl}; traces=${traceDir}`);
});
