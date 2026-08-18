import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { appendReview, currentReview, listReviews, refreshReviewIndex, updateReview } from "./pilot-review-store";
import { generatePilotReport } from "./pilot-report-generator";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEWER = path.join(ROOT, "viewer");
const RUNS = path.join(ROOT, "runs");
const REGISTRY = path.resolve(ROOT, "..", "specs", "creation-usability-pilot", "resource-registry.yaml");
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg" };

type Registry = { sourceDirectory?: string; resources?: Array<{ fileName?: string }> };
function contained(root: string, candidate: string) { const resolved = path.resolve(root, candidate); return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null; }
function resourceDirectory(value?: string) { return value === "${PILOT_RESOURCE_DIR}" ? process.env.PILOT_RESOURCE_DIR : value; }
async function inputAsset(name: string) {
    const registry = yaml.load(await fs.readFile(REGISTRY, "utf8")) as Registry;
    const sourceDirectory = resourceDirectory(registry.sourceDirectory);
    if (!name || !registry.resources?.some((resource) => resource.fileName === name) || !sourceDirectory) return null;
    return contained(sourceDirectory, name);
}
function sendJson(res: http.ServerResponse, status: number, value: unknown) {
    const body = JSON.stringify(value);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(body);
}

async function requestJson(req: http.IncomingMessage) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 512_000) throw new Error("请求体过大");
        chunks.push(buffer);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("请求体不是有效 JSON"); }
}

function scoringRoute(pathname: string) {
    const match = /^\/api\/scoring\/([A-Za-z0-9_-]+)(?:\/(CP-\d{2})(?:\/reviews(?:\/([A-Za-z0-9-]+))?)?)?(?:\/(report))?$/.exec(pathname);
    return match ? { runId: match[1], caseId: match[2], reviewId: match[3], report: Boolean(match[4]), reviews: pathname.includes("/reviews") } : null;
}

async function serve(req: http.IncomingMessage, res: http.ServerResponse, file: string) {
    try {
        const stat = await fs.stat(file);
        if (!stat.isFile()) throw new Error("Not a file");
        const size = stat.size;
        const headers = {
            "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Accept-Ranges": "bytes",
        };
        const range = req.headers.range;
        if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            const start = match?.[1] ? Number(match[1]) : 0;
            const end = match?.[2] ? Number(match[2]) : size - 1;
            if (!match || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
                res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
                return res.end();
            }
            const boundedEnd = Math.min(end, size - 1);
            res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${boundedEnd}/${size}`, "Content-Length": boundedEnd - start + 1 });
            if (req.method === "HEAD") return res.end();
            createReadStream(file, { start, end: boundedEnd }).pipe(res);
            return;
        }
        res.writeHead(200, { ...headers, "Content-Length": size });
        if (req.method === "HEAD") return res.end();
        createReadStream(file).pipe(res);
    } catch { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Not found"); }
}
async function main() {
    const port = Number(process.env.PORT || 4179);
    const server = http.createServer(async (req, res) => {
        if (!req.url) return res.end();
        const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname);
        const scoring = scoringRoute(pathname);
        if (scoring) {
            const runDirectory = contained(RUNS, scoring.runId);
            if (!runDirectory || !(await fs.stat(runDirectory).then((stat) => stat.isDirectory()).catch(() => false))) return sendJson(res, 404, { error: "未知 Run" });
            try {
                if (scoring.caseId && scoring.reviews) {
                    if (scoring.reviewId) {
                        if (req.method !== "PUT") return sendJson(res, 405, { error: "仅支持 PUT" });
                        return sendJson(res, 200, { review: await updateReview(scoring.runId, scoring.caseId, scoring.reviewId, await requestJson(req)) });
                    }
                    if (req.method === "GET") return sendJson(res, 200, { reviews: await listReviews(scoring.runId, scoring.caseId), current: await currentReview(scoring.runId, scoring.caseId) });
                    if (req.method === "POST") return sendJson(res, 201, { review: await appendReview(scoring.runId, scoring.caseId, await requestJson(req)) });
                    return sendJson(res, 405, { error: "仅支持 GET 或 POST" });
                }
                if (scoring.report) {
                    if (req.method !== "POST") return sendJson(res, 405, { error: "仅支持 POST" });
                    return sendJson(res, 200, await generatePilotReport(scoring.runId));
                }
                if (req.method !== "GET") return sendJson(res, 405, { error: "仅支持 GET" });
                const scoringDir = path.join(runDirectory, "scoring");
                const load = async (name: string) => fs.readFile(path.join(scoringDir, name), "utf8").then(JSON.parse).catch(() => null);
                return sendJson(res, 200, { catalog: await load("catalog.json"), deterministic: await load("deterministic.json"), judgeTaskIndex: await load("judge-task-index.json"), judgeResults: await load("judge-results.json"), reviewIndex: await refreshReviewIndex(scoring.runId), summary: await load("summary.json") });
            } catch (error) { return sendJson(res, 400, { error: error instanceof Error ? error.message : "评分请求失败" }); }
        }
        if (pathname === "/" || pathname === "/viewer/") return serve(req, res, path.join(VIEWER, "index.html"));
        if (pathname.startsWith("/media/input/")) { const asset = await inputAsset(pathname.slice("/media/input/".length)); if (!asset) { res.writeHead(404); return res.end("Unknown input asset"); } return serve(req, res, asset); }
        const relative = pathname.replace(/^\/+/, "");
        const root = relative.startsWith("viewer/") ? VIEWER : relative.startsWith("runs/") ? RUNS : null;
        const subpath = relative.startsWith("viewer/") ? relative.slice(7) : relative.startsWith("runs/") ? relative.slice(5) : "";
        const file = root && contained(root, subpath);
        if (!file) { res.writeHead(403); return res.end("Forbidden"); }
        return serve(req, res, file);
    });
    server.listen(port, "127.0.0.1", () => console.log(`Run viewer: http://127.0.0.1:${port}/viewer/`));
}
void main();
