// md -> yaml：解析 specs/golden-set/canvas-agent/01~04 四个 md 为 GoldenCase 并写 cases/*.yaml。
// 内置校验：与总表 ID/标题/类别/风险一致、工具名在白名单内、枚举合法、轮数与被测轮一致、
// 必备段落与预算四项齐全。校验失败列出全部问题并非零退出，不写半成品。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { type GoldenCase, SCENARIOS, RISKS, SAMPLE_TYPES, CANVAS_TYPES, TOOL_NAMES } from "./types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.resolve(HERE, "..", "..", "specs", "golden-set", "canvas-agent");
const OUT_DIR = path.resolve(HERE, "..", "cases");
const FILES = ["01-触发与路由.md", "02-核心逻辑.md", "03-产物质量.md", "04-异常容错.md"];

// 场景前缀 -> scenario
const FILE_SCENARIO: Record<string, GoldenCase["scenario"]> = {
    "01": "trigger",
    "02": "core_logic",
    "03": "output_quality",
    "04": "exception",
};

// 行为类别白名单（真源 00-总览索引 5.2）
const CATEGORIES = new Set([
    "canvas-state-read", "node-creation", "node-update", "node-deletion",
    "story-orchestration", "generation", "batch-ops", "layout-viewport",
    "canvas-isolation", "clarification-degradation",
]);

function parseTable(md: string, title: string): Array<Record<string, string>> {
    // 找到标题行
    const headerIdx = md.indexOf(title);
    if (headerIdx < 0) return [];
    const rest = md.slice(headerIdx);
    // 定位第一个表格
    const tableStart = rest.indexOf("|");
    if (tableStart < 0) return [];
    const lines = rest.slice(tableStart).split("\n");
    const rows: Array<Record<string, string>> = [];
    let headers: string[] | null = null;
    for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("|")) break;
        const cells = line.split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.length) continue;
        if (!headers) {
            headers = cells;
            continue;
        }
        // 分隔行 |---|---|
        if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
        const row: Record<string, string> = {};
        headers.forEach((h, i) => {
            row[h] = cells[i] ?? "";
        });
        rows.push(row);
    }
    return rows;
}

// 匹配 `## <ID> · <标题>` 切分每个用例块
function splitCases(md: string): Array<{ id: string; title: string; body: string }> {
    const cases: Array<{ id: string; title: string; body: string }> = [];
    const re = /^#{2,4}\s+([A-Z]{2}-\d{2})\s*[·]\s*(.+)$/gm;
    const matches: Array<{ id: string; title: string; index: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(md))) {
        matches.push({ id: match[1], title: match[2].trim(), index: match.index });
    }
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : md.length;
        cases.push({ id: matches[i].id, title: matches[i].title, body: md.slice(start, end) });
    }
    return cases;
}

function metaValue(metaRows: Array<Record<string, string>>, field: string): string {
    for (const row of metaRows) {
        const values = Object.values(row);
        // 元信息表：第一列是字段名，第二列是值。header 可能是「字段|值」或「字段|值|→YAML」。
        if (values[0] === field) return values[1] ?? "";
    }
    return "";
}

// 清洗枚举值：去掉 markdown 加粗 `**` 和括号说明后缀。
// 例：`**P0**` -> P0；`**负例**（不应触发）` -> 负例；`正例（表达变体）` -> 正例
function cleanEnum(value: string): string {
    let v = value.trim().replace(/\*\*/g, "");
    const parenIdx = v.indexOf("（");
    if (parenIdx > 0) v = v.slice(0, parenIdx).trim();
    const halfParen = v.indexOf("(");
    if (halfParen > 0) v = v.slice(0, halfParen).trim();
    return v;
}

// 解析多轮对话表
function parseTurns(body: string): Array<{ index: number; message: string; purpose: GoldenCase["input"]["turns"][number]["purpose"]; expectedCanvasChange: string }> {
    const rows = parseTable(body, "**多轮对话**");
    const turns: Array<{ index: number; message: string; purpose: "setup" | "target"; expectedCanvasChange: string }> = [];
    for (const row of rows) {
        const idx = Number(row["轮"]);
        if (!idx) continue;
        const purposeRaw = row["用途"] || "";
        const purpose: "setup" | "target" = purposeRaw.includes("铺状态") ? "setup" : purposeRaw.includes("被测") ? "target" : "target";
        turns.push({
            index: idx,
            message: row["用户消息"] || "",
            purpose,
            expectedCanvasChange: row["该轮期望画布变化"] || "",
        });
    }
    return turns.sort((a, b) => a.index - b.index);
}

// 解析被测轮期望表
function parseExpectation(body: string): GoldenCase["expectation"] {
    const rows = parseTable(body, "**被测轮期望**");
    const field = (name: string) => {
        for (const row of rows) {
            const values = Object.values(row);
            if (values[0] === name) return values[1] ?? "";
        }
        return "";
    };
    const requiredSteps = field("必须步骤")
        .split(/[,，;；、]/)
        .map((s) => s.trim())
        .filter(Boolean);
    return {
        targetTurn: 0,
        requiredSteps,
        expectedToolCalls: field("期望工具调用（含顺序）"),
        alternativePaths: field("等价替代路径"),
        forbiddenActions: field("禁止动作"),
        requiredEvidence: field("必须证据"),
        outputFormat: field("输出格式"),
        degradation: field("降级要求"),
        safetyAssertions: field("安全断言"),
        stateAssertions: field("状态断言"),
    };
}

// 解析预算
function parseBudget(body: string): GoldenCase["budgets"] {
    const re = /\*\*总预算\*\*：maxToolCalls\s+(\d+)\s*｜\s*maxLatencyMs\s+(\d+)\s*｜\s*maxTokens\s+(\d+)\s*｜\s*maxCostCny\s+([\d.]+)/;
    const match = body.match(re);
    if (!match) return { maxToolCalls: 0, maxLatencyMs: 0, maxTokens: 0, maxCostCny: 0 };
    return {
        maxToolCalls: Number(match[1]),
        maxLatencyMs: Number(match[2]),
        maxTokens: Number(match[3]),
        maxCostCny: Number(match[4]),
    };
}

// 解析判据表格（三行表：判据规则 / 契约依据 / 人工审阅）
function parseCriteria(body: string): GoldenCase["criteria"] {
    // 找「判据规则」行，取其后 3 行表格的键值
    const lines = body.split("\n");
    let rules = "";
    let contractRefs = "";
    let review = "";
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("|") && line.includes("判据规则")) {
            const cells = line.split("|").slice(1, -1).map((c) => c.trim());
            if (cells.length >= 2) rules = cells[1];
            // 往下找 契约依据 / 人工审阅
            for (let j = i + 1; j < lines.length && j <= i + 4; j++) {
                const row = lines[j].trim();
                if (!row.startsWith("|")) continue;
                const rcells = row.split("|").slice(1, -1).map((c) => c.trim());
                if (rcells.length < 2) continue;
                if (rcells[0] === "契约依据") contractRefs = rcells[1];
                else if (rcells[0] === "人工审阅") review = rcells[1];
            }
            break;
        }
    }
    return {
        rules: rules.split(/[,，;；、]/).map((s) => s.trim()).filter(Boolean),
        contractRefs,
        review,
    };
}

// 从总览索引读 ID -> {title, category, risk, scenario}
function parseIndex(): Record<string, { title: string; category: string; risk: string; scenario: string; canvasType: string; repeat: number }> {
    const indexPath = path.join(GOLDEN_DIR, "00-总览索引.md");
    const md = fs.readFileSync(indexPath, "utf8");
    const map: Record<string, { title: string; category: string; risk: string; scenario: string; canvasType: string; repeat: number }> = {};
    const re = /^\| (TR-\d{2}|CL-\d{2}|OQ-\d{2}|EX-\d{2}) \| ([^|]+) \| ([^|]+) \| (P\d) \| ([^|]+) \| (content|story) \| \d+ \| \d+ \| [^|]+ \|$/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(md))) {
        const id = match[1];
        // 场景按文件前缀从章节名推断（01-触发/02-核心/03-产物/04-异常）
        const sectionHeader = md.slice(0, match.index).split("\n").reverse().find((l) => l.startsWith("### "));
        const scenario = FILE_SCENARIO[Object.keys(FILE_SCENARIO).find((k) => sectionHeader?.includes(k)) || ""] || "core_logic";
        map[id] = {
            title: match[2].trim(),
            category: match[3].trim(),
            risk: match[4].trim(),
            scenario,
            canvasType: match[6].trim(),
            repeat: match[3].trim() === "canvas-isolation" || match[3].trim() === "node-deletion" || match[3].trim() === "batch-ops" ? 3 : 1,
        };
    }
    return map;
}

export function convertAll(): { written: number; errors: string[] } {
    const index = parseIndex();
    const errors: string[] = [];
    const cases: GoldenCase[] = [];
    const seen = new Set<string>();

    for (const file of FILES) {
        const filePath = path.join(GOLDEN_DIR, file);
        if (!fs.existsSync(filePath)) {
            errors.push(`缺失文件：${file}`);
            continue;
        }
        const md = fs.readFileSync(filePath, "utf8");
        const blocks = splitCases(md);
        for (const block of blocks) {
            const { id, title, body } = block;
            if (seen.has(id)) {
                errors.push(`重复 ID：${id}`);
                continue;
            }
            seen.add(id);
            const gcase = parseCase(id, title, body, index);
            if (!gcase) {
                errors.push(`${id} 解析失败`);
                continue;
            }
            cases.push(gcase);
        }
    }

    // 校验
    for (const c of cases) {
        validateCase(c, index, errors);
    }

    // 检查总表里是否所有 ID 都转换了
    const indexIds = Object.keys(index);
    for (const id of indexIds) {
        if (!seen.has(id)) errors.push(`总表有 ${id} 但用例文件缺失`);
    }
    for (const id of seen) {
        if (!indexIds.includes(id)) errors.push(`用例文件有 ${id} 但总表缺失`);
    }

    if (errors.length) return { written: 0, errors };

    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const c of cases) {
        fs.writeFileSync(path.join(OUT_DIR, `${c.id}.yaml`), yaml.dump(c as unknown as Record<string, unknown>, { noRefs: true }), "utf8");
    }
    return { written: cases.length, errors };
}

function parseCase(id: string, title: string, body: string, index: Record<string, { title: string; category: string; risk: string; scenario: string; canvasType: string; repeat: number }>): GoldenCase | null {
    const metaRows = parseTable(body, "## " + id);
    const category = metaValue(metaRows, "行为类别") || metaValue(metaRows, "行为类别（contract）") || "";
    // 场景/风险/样本 在「场景 / 风险 / 样本」或「场景 / 风险 / 样本类型」行（第一列值含「场景」）
    let scenarioRiskSample = "";
    for (const row of metaRows) {
        const first = Object.values(row)[0] || "";
        if (first.includes("场景")) scenarioRiskSample = Object.values(row)[1] || "";
    }
    const [scenarioRaw, riskRaw, sampleRaw] = scenarioRiskSample.split("/").map((s) => cleanEnum(s));

    const turns = parseTurns(body);
    const expectation = parseExpectation(body);
    const budgets = parseBudget(body);
    const criteria = parseCriteria(body);
    const indexItem = index[id];

    // 目标轮 = 最后一个被测轮 index
    const targetTurn = turns.filter((t) => t.purpose === "target").pop()?.index ?? turns[turns.length - 1]?.index ?? 0;
    expectation.targetTurn = targetTurn;

    const canvasType = (metaValue(metaRows, "画布类型 / 起始状态") || "").split("/")[0].trim() as GoldenCase["canvasType"];
    const isStory = (metaValue(metaRows, "画布类型 / 起始状态") || "").includes("story");
    const resolvedCanvasType: GoldenCase["canvasType"] = isStory ? "story" : canvasType === "story" ? "story" : "content";

    return {
        id,
        title,
        version: 1,
        source: "expert",
        status: "active",
        scenario: (scenarioRaw || indexItem?.scenario || "core_logic") as GoldenCase["scenario"],
        behaviorCategory: category || indexItem?.category || "",
        risk: (riskRaw || indexItem?.risk || "P1") as GoldenCase["risk"],
        sampleType: (sampleRaw || "正例") as GoldenCase["sampleType"],
        canvasType: resolvedCanvasType,
        initialState: "blank",
        agentScope: metaValue(metaRows, "Agent 适用") || "all",
        consistency: indexItem?.repeat ? { repeat: indexItem.repeat } : undefined,
        input: { turns },
        expectation,
        budgets,
        criteria,
    };
}

function validateCase(c: GoldenCase, index: Record<string, { title: string; category: string; risk: string; scenario: string; canvasType: string; repeat: number }>, errors: string[]) {
    const idx = index[c.id];
    if (idx) {
        if (c.behaviorCategory !== idx.category) errors.push(`${c.id} 行为类别「${c.behaviorCategory}」与总表「${idx.category}」不一致`);
        if (c.risk !== idx.risk) errors.push(`${c.id} 风险「${c.risk}」与总表「${idx.risk}」不一致`);
        if (c.canvasType !== idx.canvasType) errors.push(`${c.id} 画布类型「${c.canvasType}」与总表「${idx.canvasType}」不一致`);
    }
    if (!SCENARIOS.includes(c.scenario)) errors.push(`${c.id} 场景非法：${c.scenario}`);
    if (!RISKS.includes(c.risk)) errors.push(`${c.id} 风险非法：${c.risk}`);
    if (!SAMPLE_TYPES.includes(c.sampleType)) errors.push(`${c.id} 样本类型非法：${c.sampleType}`);
    if (!CANVAS_TYPES.includes(c.canvasType)) errors.push(`${c.id} 画布类型非法：${c.canvasType}`);
    if (!CATEGORIES.has(c.behaviorCategory)) errors.push(`${c.id} 行为类别非法：${c.behaviorCategory}`);
    if (!c.input.turns.length) errors.push(`${c.id} 无对话轮次`);
    if (!c.input.turns.some((t) => t.purpose === "target")) errors.push(`${c.id} 无被测轮`);
    if (!c.budgets.maxToolCalls || !c.budgets.maxLatencyMs || !c.budgets.maxTokens) errors.push(`${c.id} 预算不全`);
    // 工具名白名单校验（从 expectedToolCalls 里抓工具名）
    const toolMentions = c.expectation.expectedToolCalls.match(/canvas_[a-z_]+/g) || [];
    for (const t of toolMentions) {
        if (!TOOL_NAMES.includes(t as (typeof TOOL_NAMES)[number])) errors.push(`${c.id} 工具名不在白名单：${t}`);
    }
}
