export type CanvasNode = {
    id: string;
    type?: string;
    title?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    metadata?: Record<string, unknown>;
};

export type CanvasConnection = {
    id?: string;
    fromNodeId?: string;
    toNodeId?: string;
    kind?: string;
};

export type CanvasAgentSnapshot = {
    projectId: string;
    title: string;
    canvasType: "content" | "story";
    nodes: CanvasNode[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: { x: number; y: number; k: number };
};

export type GenerationCanvasAgentOp = {
    type: "run_generation";
    nodeId: string;
    mode?: string;
    prompt?: string;
    [key: string]: unknown;
};

export type CanvasAgentOp = GenerationCanvasAgentOp | {
    type: string;
    id?: string;
    nodeId?: string;
    nodeType?: string;
    title?: string;
    x?: number;
    y?: number;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
};

export type CanvasAgentOpRejection = {
    op: unknown;
    reason: string;
};
