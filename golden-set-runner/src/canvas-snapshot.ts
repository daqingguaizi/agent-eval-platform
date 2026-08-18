// 画布快照工厂与结构化 diff
import type { CanvasAgentSnapshot } from "./target-types";
import type { CanvasType } from "./types";

// 空白快照工厂（每条用例从空白画布开始，画布类型按用例指定）
export function blankSnapshot(canvasType: CanvasType, projectId = `gs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`): CanvasAgentSnapshot {
    return {
        projectId,
        title: "GS 跑测画布",
        canvasType,
        nodes: [],
        connections: [],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
}

export function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

// 结构化 diff：只比对 id 与关键字段，避免整对象比较产生噪声。
// 返回 nodesAdded/Removed/Updated、connectionsAdded/Removed、selection 与 viewport 变化。
export type CanvasDiff = {
    nodesAdded: Array<{ id: string; type?: string; title?: string }>;
    nodesRemoved: Array<{ id: string; type?: string; title?: string }>;
    nodesUpdated: Array<{ id: string; type?: string; title?: string; fields: string[] }>;
    connectionsAdded: Array<{ id?: string; fromNodeId?: string; toNodeId?: string; kind?: string }>;
    connectionsRemoved: Array<{ id?: string; fromNodeId?: string; toNodeId?: string; kind?: string }>;
    selectionChanged: boolean;
    viewportChanged: boolean;
};

function nodeSummary(node?: { id: string; type?: string; title?: string; metadata?: Record<string, unknown> } | null) {
    if (!node) return null;
    const meta = node.metadata as Record<string, unknown> | undefined;
    const title = node.title ?? (typeof meta?.content === "string" ? meta.content.slice(0, 30) : undefined) ?? (typeof meta?.storyTitle === "string" ? meta.storyTitle : undefined);
    return { id: node.id, type: node.type, title };
}

const NODE_KEY_FIELDS = ["title", "x", "y", "width", "height", "nodeType"];

function diffNodes(before: unknown[], after: unknown[]): { added: CanvasDiff["nodesAdded"]; removed: CanvasDiff["nodesRemoved"]; updated: CanvasDiff["nodesUpdated"] } {
    const bById = new Map((before as Array<{ id: string }>).map((n) => [n.id, n]));
    const aById = new Map((after as Array<{ id: string }>).map((n) => [n.id, n]));

    const added: CanvasDiff["nodesAdded"] = [];
    const removed: CanvasDiff["nodesRemoved"] = [];
    const updated: CanvasDiff["nodesUpdated"] = [];

    for (const [id, node] of aById) {
        if (!bById.has(id)) {
            added.push(nodeSummary(node) as CanvasDiff["nodesAdded"][number]);
        }
    }
    for (const [id, node] of bById) {
        if (!aById.has(id)) {
            removed.push(nodeSummary(node) as CanvasDiff["nodesRemoved"][number]);
        }
    }
    for (const [id, beforeNode] of bById) {
        const afterNode = aById.get(id);
        if (!afterNode) continue;
        const fields: string[] = [];
        for (const key of NODE_KEY_FIELDS) {
            const bv = JSON.stringify((beforeNode as Record<string, unknown>)[key]);
            const av = JSON.stringify((afterNode as Record<string, unknown>)[key]);
            if (bv !== av) fields.push(key);
        }
        // metadata 整体比较：只要序列化后不同就标记 metadata 变更
        const bm = JSON.stringify((beforeNode as Record<string, unknown>).metadata ?? null);
        const am = JSON.stringify((afterNode as Record<string, unknown>).metadata ?? null);
        if (bm !== am) fields.push("metadata");
        if (fields.length) {
            updated.push({ ...(nodeSummary(afterNode) as CanvasDiff["nodesUpdated"][number]), fields });
        }
    }
    return { added, removed, updated };
}

function connSummary(conn: { id?: string; fromNodeId?: string; toNodeId?: string; kind?: string }) {
    return { id: conn.id, fromNodeId: conn.fromNodeId, toNodeId: conn.toNodeId, kind: conn.kind };
}

function diffConnections(before: unknown[], after: unknown[]): Pick<CanvasDiff, "connectionsAdded" | "connectionsRemoved"> {
    const key = (c: unknown) => {
        const conn = c as { id?: string; fromNodeId?: string; toNodeId?: string };
        return conn.id || `${conn.fromNodeId}->${conn.toNodeId}`;
    };
    const bSet = new Set((before as unknown[]).map(key));
    const aSet = new Set((after as unknown[]).map(key));
    const added = (after as unknown[]).filter((c) => !bSet.has(key(c))).map((c) => connSummary(c as never));
    const removed = (before as unknown[]).filter((c) => !aSet.has(key(c))).map((c) => connSummary(c as never));
    return { connectionsAdded: added, connectionsRemoved: removed };
}

export function diffSnapshots(before: CanvasAgentSnapshot, after: CanvasAgentSnapshot): CanvasDiff {
    const nodes = diffNodes(before.nodes, after.nodes);
    const conns = diffConnections(before.connections, after.connections);
    const selectionChanged = JSON.stringify(before.selectedNodeIds) !== JSON.stringify(after.selectedNodeIds);
    const viewportChanged = JSON.stringify(before.viewport) !== JSON.stringify(after.viewport);
    return {
        nodesAdded: nodes.added,
        nodesRemoved: nodes.removed,
        nodesUpdated: nodes.updated,
        ...conns,
        selectionChanged,
        viewportChanged,
    };
}
