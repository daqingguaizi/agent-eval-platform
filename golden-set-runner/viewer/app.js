const DEFAULT_ECHO_RUN = "demo-viewer";
const state = { runId: new URLSearchParams(location.search).get("run") || DEFAULT_ECHO_RUN, run: null, evaluation: null, scoring: null, report: null, active: null, detail: null, reviewDraft: null };
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const runPath = () => `../runs/${encodeURIComponent(state.runId)}`;
const fetchJson = async (url) => {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
const labels = {
  completed: "已完成", failed: "失败", blocked: "受限", passed: "通过", pass: "通过", pending: "待处理", n_a: "不适用",
  target: "目标轮", setup: "准备轮", t2i: "文生图", i2i: "图生图", panorama: "全景图", t2v: "文生视频", i2v: "图生视频", v2v: "视频转视频", mixed_reference_to_video: "图像与视频参考生成", audio: "音频", canvas_only: "画布操作",
  content_creation: "内容创作", canvas_orchestration: "画布编排", route_recovery: "路由与恢复",
  vanilla: "基础", creative: "创意", complex: "复杂", content: "内容画布", story: "故事画布",
  artifact_reply: "产物回复", audio_generation: "音频生成", canvas_story: "故事画布", exception_isolation: "异常隔离", existing_structure_edit: "既有结构编辑", multi_reference: "多参考素材", plugin_panorama: "全景插件", trigger_route: "触发与路由",
  executionEvidence: "执行与证据完整性", taskOrchestration: "任务完成与工具编排", canvasUsability: "画布可用性与可编辑性", artifactQuality: "产物质量与需求符合度", reliabilityBoundary: "交互可靠性与边界行为",
  case_definition: "用例定义", agent_planning: "Agent 规划", tool_selection: "工具选择", parameterization: "参数配置", generation_execution: "生成执行", canvas_write: "画布写入", media_storage: "媒体存储", workspace_sync: "工作区同步", evidence_archive: "证据归档", viewer: "Viewer 展示", evaluation_design: "评测设计",
  not_triggered: "未触发", wrong_modality: "错误模态", duplicate_generation: "重复生成", wrong_connection: "错误连接", timeout: "生成超时", state_mismatch: "状态不一致", media_missing: "媒体丢失", constraint_violation: "约束未遵循", quality_insufficient: "质量不足", misleading_feedback: "用户反馈误导", not_reproducible: "不可复现",
  case_spec: "用例规格", runner: "运行器", canvas_agent: "Canvas Agent", canvas_frontend: "画布前端", model_or_provider: "模型或服务提供方", media_service: "媒体服务", scorer: "评分器",
  functional_failure: "功能失败", reliability: "可靠性问题", quality_debt: "质量债务", ux: "体验问题", safety_boundary: "安全边界问题", evaluation_gap: "评测缺口", external_dependency: "外部依赖",
  stage: "发生阶段", symptom: "问题现象", responsibleArea: "责任域", nature: "问题性质", severity: "严重度", ownerModule: "建议责任模块",
  complete: "完整", partial: "部分完成", needs_review: "待人工复核", none: "无", human_confirmed: "人工已确认", paused_for_human: "等待人工处理",
  case_started: "用例开始", canvas_persisted: "画布已持久化", case_finalized: "用例已结束", manual_intervention_confirmed: "人工接管已确认"
};
const displayLabel = (value) => labels[value] || value || "未知";
const badge = (value) => `<span class="badge ${esc(value || "unknown")}">${esc(displayLabel(value))}</span>`;
const formatDuration = (ms) => !Number.isFinite(ms) ? "—" : ms < 1_000 ? `${Math.round(ms)} ms` : `${(ms / 1_000).toFixed(ms < 60_000 ? 1 : 0)} 秒`;
const durationOf = (item) => new Date(item.finishedAt).getTime() - new Date(item.startedAt).getTime();
const fileUrl = (relative) => `${runPath()}/${relative.split("/").map(encodeURIComponent).join("/")}`;

function filteredCases() {
  const query = $("search").value.trim().toLowerCase();
  const status = $("statusFilter").value;
  const modality = $("mediaFilter").value;
  return (state.run?.results || []).filter((item) =>
    (!query || `${item.id} ${item.title}`.toLowerCase().includes(query)) &&
    (!status || item.status === status) &&
    (!modality || item.modality === modality),
  );
}

function showMessage(message) {
  $("detail").innerHTML = `<div class="empty">${esc(message)}</div>`;
}

async function loadRun() {
  state.runId = $("runInput").value.trim() || DEFAULT_ECHO_RUN;
  state.run = null;
  state.scoring = null;
  state.report = null;
  state.active = null;
  state.detail = null;
  state.reviewDraft = null;
  $("meta").textContent = "加载中…";
  showMessage("正在解析 Echo 试点评测结果…");
  try {
    const run = await fetchJson(`${runPath()}/run.json`);
    if (run.agent !== "echo" || !Array.isArray(run.results)) throw new Error("此 Viewer 当前只解析 Echo 浏览器评测 Run（缺少 run.json 或 agent=echo）");
    state.run = run;
    state.evaluation = run.persistentProfile ? await fetchJson(`${runPath()}/evaluation-state.json`).catch(() => null) : null;
    state.scoring = await fetchJson(`/api/scoring/${encodeURIComponent(state.runId)}`).catch(() => null);
    state.report = await fetch(`${runPath()}/scoring/development-report.md?t=${Date.now()}`).then((response) => response.ok ? response.text() : null).catch(() => null);
    $("meta").textContent = `${run.runId} · ${run.targetVersion || "未知版本"} · ${run.collection?.id || "未命名集合"}`;
    renderDashboard();
    renderCoverage();
    renderList();
    showMessage("从左侧选择用例，查看人可读的输入、执行过程、画布和产物证据。");
    $("footer").textContent = state.evaluation ? `只读 Echo Run：${state.runId} · 已归档持久画布、媒体与人工接管状态 · 网络凭据不在 Viewer 中展示。` : `只读 Echo Run：${state.runId} · 历史 Run 仅包含当时归档的截图与 Trace。`;
  } catch (error) {
    $("meta").textContent = `加载失败：${error.message}`;
    $("dashboard").innerHTML = "";
    $("caseList").innerHTML = "";
    showMessage(`无法加载此 Echo Run：${error.message}`);
  }
}

function renderDashboard() {
  const results = state.run.results || [];
  const counts = Object.fromEntries(["completed", "failed", "blocked"].map((status) => [status, results.filter((item) => item.status === status).length]));
  const totalSeconds = results.reduce((sum, item) => sum + Math.max(0, durationOf(item)), 0);
  const route = state.run.modelRouting || {};
  const evaluationCases = Object.values(state.evaluation?.cases || {});
  const evidenceComplete = evaluationCases.filter((item) => item.evidenceStatus === "complete").length;
  const waitingHuman = evaluationCases.filter((item) => item.executionStatus === "paused_for_human").length;
  $("dashboard").innerHTML = [
    ["试点用例", `${results.length} 条`, "blue"],
    ["证据完整", state.evaluation ? evidenceComplete : "历史", evidenceComplete ? "green" : "amber"],
    ["等待人工", waitingHuman, waitingHuman ? "amber" : "green"],
    ["已完成", counts.completed || 0, "green"],
    ["失败", counts.failed || 0, counts.failed ? "red" : "green"],
    ["渠道受限", counts.blocked || 0, counts.blocked ? "amber" : "green"],
    ["累计执行", formatDuration(totalSeconds), "purple"],
  ].map(([name, value, tone]) => `<div class="metric ${tone}"><span>${esc(name)}</span><strong>${esc(value)}</strong></div>`).join("") +
    `<div class="dashboard-note"><strong>渠道路由</strong><span>文本 / 工具：${esc(route.text || "—")}</span><span>图片：${esc(route.image || "—")}</span><span>视频：${esc(route.video || "—")}</span></div>`;
}

function scoreLabel(status) {
  return ({ pending_human_review: "待人工评审", pass: "通过", pass_with_improvements: "通过但有改进项", partial: "部分完成", fail: "失败", not_evaluable: "不可评估" })[status] || "未评分";
}

function distributionChart(title, values, tone = "blue") {
  const entries = Object.entries(values || {});
  const max = Math.max(...entries.map(([, value]) => Number(value)), 1);
  return `<article class="coverage-card"><header><span>${esc(title)}</span><strong>${entries.reduce((sum, [, value]) => sum + Number(value), 0)} 条</strong></header><div class="coverage-bars">${entries.map(([name, value]) => `<div class="coverage-row"><span title="${esc(displayLabel(name))}">${esc(displayLabel(name))}</span><div class="coverage-track"><i class="${esc(tone)}" style="width:${Math.max(5, Number(value) / max * 100)}%"></i></div><b>${esc(value)}</b></div>`).join("")}</div></article>`;
}

function renderCoverage() {
  const host = $("coverage");
  const catalog = state.scoring?.catalog;
  if (!catalog?.cases?.length) { host.innerHTML = `<div class="coverage-empty">尚未生成用例目录与评分初始化数据；运行 <code>npm run pilot-score -- ${esc(state.runId)}</code> 后刷新即可展示。</div>`; return; }
  const reviewIndex = state.scoring?.reviewIndex?.cases || [];
  const reviewed = reviewIndex.filter((item) => item.currentReviewId).length;
  const waiting = catalog.cases.length - reviewed;
  const deterministic = state.scoring?.deterministic?.cases || [];
  const hardGateFailed = deterministic.filter((item) => item.hardGateFailed).length;
  const statusDistribution = reviewIndex.reduce((out, item) => { const key = scoreLabel(item.status); out[key] = (out[key] || 0) + 1; return out; }, { "待人工评审": waiting });
  const summary = state.scoring?.summary;
  host.innerHTML = `<div class="coverage-head"><div><span>用例与评分概览</span><h2>${catalog.cases.length} 条创作者试点：任务覆盖与评分进度</h2><p>数据来自 CP YAML 与本 Run 的独立评分层；执行完成、确定性证据与人工质量结论分开展示。</p></div><div class="coverage-status"><b>${reviewed}/${catalog.cases.length}</b><span>人工当前有效结论</span><small>${summary?.reportReady ? "研发报告已就绪" : `报告门禁：尚缺 ${summary?.missing?.length || waiting} 项`}</small></div></div><div class="coverage-kpis"><div><span>确定性硬阻断</span><strong class="${hardGateFailed ? "danger" : "ok"}">${hardGateFailed} 条</strong><small>不是最终质量结论</small></div><div><span>模型辅助</span><strong>DeepSeek V4 Pro</strong><small>${state.scoring?.judgeTaskIndex?.tasks?.filter((task) => task.status === "pending").length || 0} 个待执行任务</small></div><div><span>评分规范版本</span><strong>${esc(state.scoring?.deterministic?.specVersion || "1.5.0")}</strong><small>评分与归因唯一准绳</small></div></div><div class="coverage-grid">${distributionChart("任务类型", catalog.distributions.taskDomain, "blue")}${distributionChart("模态覆盖", catalog.distributions.modality, "violet")}${distributionChart("复杂度层级", catalog.distributions.tier, "cyan")}${distributionChart("人工最终状态", statusDistribution, "green")}</div>${renderScoringGuide()}<details class="coverage-matrix"><summary>查看用例覆盖矩阵</summary><div class="coverage-table"><table><thead><tr><th>用例</th><th>任务类型</th><th>模态</th><th>复杂度</th><th>画布类型</th><th>覆盖标签</th></tr></thead><tbody>${catalog.cases.map((item) => `<tr><td>${esc(item.id)}</td><td>${esc(displayLabel(item.taskDomain))}</td><td>${esc(displayLabel(item.modality))}</td><td>${esc(displayLabel(item.tier))}</td><td>${esc(displayLabel(item.canvasType))}</td><td>${esc(item.coverageTags.map(displayLabel).join("、"))}</td></tr>`).join("")}</tbody></table></div></details>`;
  if (summary?.reportReady && state.report) host.innerHTML += `<details class="development-report" open><summary>研发优化报告 · 评分已全部完成</summary><pre>${esc(state.report)}</pre></details>`;
}

function renderList() {
  const cases = filteredCases();
  $("listCount").textContent = `${cases.length} / ${state.run?.results?.length || 0} 条`;
  $("caseList").innerHTML = cases.map((item) => {
    const active = state.active?.id === item.id;
    const channels = item.channelAudit || {};
    return `<li class="case ${active ? "active" : ""}" data-case="${esc(item.id)}">
      <div class="case-top"><strong>${esc(item.id)}</strong>${badge(item.status)}</div>
      <div class="case-title">${esc(item.title)}</div>
      <div class="case-bottom"><span>${esc(labels[item.modality] || item.modality)}</span><span>${formatDuration(durationOf(item))}</span></div>
      <div class="case-audit">DeepSeek ${channels.deepseekRequests || 0} · WorkRally ${channels.workrallyRequests || 0}</div>
    </li>`;
  }).join("") || '<li class="case"><div class="case-title">没有匹配用例</div></li>';
  document.querySelectorAll(".case[data-case]").forEach((node) => node.addEventListener("click", () => void loadCase(node.dataset.case)));
}

function parseSse(text) {
  const events = [];
  let eventName = "message";
  let data = [];
  const flush = () => {
    if (!data.length) return;
    const raw = data.join("\n");
    try { events.push({ event: eventName, data: JSON.parse(raw) }); } catch { events.push({ event: eventName, data: raw }); }
    eventName = "message";
    data = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (!line) { flush(); continue; }
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  flush();
  const calls = new Map();
  const finalText = [];
  const errors = [];
  for (const entry of events) {
    const event = entry.data?.type || entry.event;
    const payload = entry.data || {};
    if (event === "response.output_item.added" && payload.item?.type === "function_call") {
      calls.set(payload.item.call_id, { name: payload.item.name, callId: payload.item.call_id, arguments: payload.item.arguments || "" });
    }
    if (event === "response.function_call_arguments.delta") {
      const call = calls.get(payload.call_id) || { name: "未知工具", callId: payload.call_id, arguments: "" };
      call.arguments += payload.delta || "";
      calls.set(payload.call_id, call);
    }
    if (event === "response.function_call_arguments.done") {
      const call = calls.get(payload.call_id) || { name: "未知工具", callId: payload.call_id, arguments: "" };
      call.arguments = payload.arguments || call.arguments;
      calls.set(payload.call_id, call);
    }
    if (event === "response.output_text.delta") finalText.push(payload.delta || "");
    if (event === "error" || payload.error) errors.push(payload.error?.message || String(payload.error || entry.data));
  }
  return { calls: [...calls.values()].map((call) => ({ ...call, parsedArgs: safeJson(call.arguments) })), finalText: finalText.join(""), errors, eventCount: events.length };
}

function safeJson(value) { try { return JSON.parse(value); } catch { return value; } }
function requestInputItems(request) {
  const input = request?.body?.input;
  // Trace 历史中 input 既可能是 Responses API 数组，也可能是字符串或单个对象。
  // Viewer 只读取可迭代的条目，不能让一条异常 Trace 阻断整个 Case。
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") return [input];
  return [];
}
function userInputFromRequest(request) {
  return [...requestInputItems(request)].reverse().find((item) => item?.role === "user")?.content || "";
}
function toolOutputsFromRequest(request) {
  return requestInputItems(request).filter((item) => item?.type === "function_call_output").map((item) => ({
    callId: item.call_id,
    output: safeJson(item.output),
  }));
}
function outputSummary(output) {
  if (typeof output === "string") return output.slice(0, 400);
  const data = output?.data || output;
  return output?.message || data?.message || (data?.ops ? `画布已执行 ${data.ops.length} 个操作` : JSON.stringify(output).slice(0, 400));
}

async function loadCase(caseId) {
  const item = state.run.results.find((result) => result.id === caseId);
  if (!item) return;
  state.active = item;
  state.detail = null;
  state.reviewDraft = null;
  renderList();
  showMessage("正在把原始网络事件解析为可读执行过程…");
  try {
    const result = await fetchJson(`${runPath()}/${encodeURIComponent(caseId)}/result.json`);
    const files = result.traceFiles || [];
    const requestFiles = files.filter((file) => file.endsWith(".request.json"));
    const responseFiles = files.filter((file) => file.endsWith(".response.sse"));
    const requests = await Promise.all(requestFiles.map(async (file) => ({ file, value: await fetchJson(`${runPath()}/${encodeURIComponent(caseId)}/${file}`) })));
    const responses = await Promise.all(responseFiles.map(async (file) => ({ file, value: parseSse(await (await fetch(`${runPath()}/${encodeURIComponent(caseId)}/${file}?t=${Date.now()}`)).text()) })));
    const [snapshot, artifacts, reviews] = await Promise.all([
      state.evaluation ? fetchJson(`${runPath()}/${encodeURIComponent(caseId)}/evidence/canvas-snapshot.json`).catch(() => null) : null,
      state.evaluation ? fetchJson(`${runPath()}/${encodeURIComponent(caseId)}/evidence/artifact-manifest.json`).catch(() => null) : null,
      fetchJson(`/api/scoring/${encodeURIComponent(state.runId)}/${encodeURIComponent(caseId)}/reviews`).catch(() => ({ reviews: [], current: null })),
    ]);
    const deterministic = state.scoring?.deterministic?.cases?.find((item) => item.caseId === caseId) || null;
    const judgeTask = state.scoring?.judgeTaskIndex?.tasks?.find((item) => item.caseId === caseId) || null;
    const judgeResult = state.scoring?.judgeResults?.results?.find((item) => item.caseId === caseId) || null;
    state.detail = { result, requests, responses, snapshot, artifacts, evaluation: state.evaluation?.cases?.[caseId] || null, reviews, deterministic, judgeTask, judgeResult };
    renderDetail();
  } catch (error) {
    showMessage(`无法解析 ${caseId}：${error.message}`);
  }
}

function toolCard(call) {
  const args = call.parsedArgs;
  const compact = typeof args === "object" ? JSON.stringify(args, null, 2) : String(args || "未捕获参数");
  return `<article class="tool-card"><header><strong>${esc(call.name)}</strong><span>${esc(call.callId || "")}</span></header><pre>${esc(compact)}</pre></article>`;
}

function renderExecutionSteps() {
  const { result, requests, responses } = state.detail;
  const count = Math.max(requests.length, responses.length);
  if (!count) return `<div class="no-media">此用例未复制到 Case 目录的模型网络 Trace。${result.error ? `失败原因：${esc(result.error)}` : ""}</div>`;
  return `<div class="trace">${Array.from({ length: count }, (_, index) => {
    const request = requests[index]?.value;
    const response = responses[index]?.value;
    const input = userInputFromRequest(request);
    const previousOutputs = toolOutputsFromRequest(request);
    return `<article class="turn">
      <header><strong>模型交互 ${index + 1}</strong><span>${request ? "请求已记录" : "请求缺失"}</span><span>${response ? `${response.eventCount} 个流事件` : "响应缺失"}</span></header>
      ${input ? `<details open><summary>此轮给模型的任务与画布上下文</summary><p>${esc(input)}</p></details>` : ""}
      ${previousOutputs.length ? `<details><summary>前一步画布工具执行结果（回灌给模型）</summary>${previousOutputs.map((item) => `<p><strong>${esc(item.callId)}：</strong>${esc(outputSummary(item.output))}</p>`).join("")}</details>` : ""}
      ${response?.calls?.length ? `<details open><summary>模型决定调用的画布工具（${response.calls.length} 个）</summary><div class="tool-grid">${response.calls.map(toolCard).join("")}</div></details>` : ""}
      ${response?.finalText ? `<details open><summary>模型最终回复</summary><p>${esc(response.finalText)}</p></details>` : ""}
      ${response?.errors?.length ? `<details open class="step error"><summary>模型流错误</summary><p>${esc(response.errors.join("\n"))}</p></details>` : ""}
      <div class="source-links"><a href="${fileUrl(`${result.id}/${requests[index]?.file || ""}`)}" target="_blank" rel="noreferrer">查看请求证据</a>${responses[index]?.file ? `<a href="${fileUrl(`${result.id}/${responses[index].file}`)}" target="_blank" rel="noreferrer">查看流式响应证据</a>` : ""}</div>
    </article>`;
  }).join("")}</div>`;
}

function renderTurns(result) {
  return `<div class="turn-summary">${(result.turns || []).map((turn) => `<article class="turn-item ${esc(turn.status)}"><header><strong>第 ${turn.index} 轮 · ${esc(labels[turn.purpose] || turn.purpose)}</strong>${badge(turn.status)}</header><p>${esc(turn.message)}</p><footer><span>耗时 ${formatDuration(turn.elapsedMs)}</span><span>${turn.attachments?.length ? `附件：${esc(turn.attachments.join("、"))}` : "无附件"}</span></footer>${turn.error ? `<div class="case-error">${esc(turn.error)}</div>` : ""}</article>`).join("")}</div>`;
}

function renderNetwork(result) {
  const groups = new Map();
  for (const item of result.network || []) {
    const key = item.url.includes("workrally") ? "WorkRally 生成" : item.url.includes("19998") ? "DeepSeek 模型决策" : item.url.includes("generations") ? "积分渠道" : "其它请求";
    const current = groups.get(key) || { count: 0, codes: [] };
    current.count++; current.codes.push(item.status); groups.set(key, current);
  }
  return `<div class="network-grid">${[...groups.entries()].map(([name, value]) => `<article><strong>${esc(name)}</strong><span>${value.count} 次 · HTTP ${esc(value.codes.join(", "))}</span></article>`).join("") || "<div class=\"no-media\">未记录渠道请求。</div>"}</div>`;
}

function generatedMediaNodeIds(payload) {
  const nodes = payload?.nodes || [];
  const children = new Map();
  for (const edge of payload?.connections || []) {
    if (!edge.fromNodeId || !edge.toNodeId) continue;
    children.set(edge.fromNodeId, [...(children.get(edge.fromNodeId) || []), edge.toNodeId]);
  }
  const generated = new Set();
  const pending = nodes.filter((node) => node.type === "config" && node.id).map((node) => node.id);
  while (pending.length) {
    const parentId = pending.shift();
    for (const childId of children.get(parentId) || []) {
      if (generated.has(childId)) continue;
      generated.add(childId);
      pending.push(childId);
    }
  }
  return generated;
}

function isMediaNode(node) {
  return ["image", "video", "audio", "plugin:panorama"].includes(node.type);
}

function isPluginGeneratedOutput(node) {
  return node.type === "plugin:panorama"
    && node.metadata?.status === "success"
    && ["generation", "edit"].includes(node.metadata?.generationType);
}

function mediaRoleFromSnapshot(item, snapshot) {
  const payload = snapshot?.payload || snapshot || {};
  const nodes = payload.nodes || [];
  const generated = generatedMediaNodeIds(payload);
  const candidates = [
    ...(item.nodeId ? nodes.filter((node) => node.id === item.nodeId) : []),
    ...nodes.filter((node) => node.metadata?.content === item.source),
  ];
  const mediaNodes = candidates.filter((node, index, all) => isMediaNode(node) && all.findIndex((entry) => entry.id === node.id) === index);
  if (mediaNodes.some((node) => generated.has(node.id) || isPluginGeneratedOutput(node))) return "output";
  if (mediaNodes.length) return "input";
  return item.role || "unknown";
}

function renderArchivedMedia(artifacts, result, snapshot) {
  const media = (artifacts?.media || []).map((item) => ({ ...item, role: mediaRoleFromSnapshot(item, snapshot) }));
  if (!media.length) return `<div class="no-media">尚未归档可播放媒体；请结合画布快照与网络 Trace 复核。</div>`;
  const card = (item) => {
    const url = item.archivePath ? fileUrl(`${result.id}/${item.archivePath}`) : item.source;
    const mime = item.mimeType || "";
    const player = mime.startsWith("video/") ? `<video controls preload="metadata" playsinline src="${esc(url)}"><a href="${esc(url)}" target="_blank" rel="noreferrer">打开视频文件</a></video>` : mime.startsWith("audio/") ? `<audio controls preload="metadata" src="${esc(url)}"></audio>` : `<a class="media-image" href="${esc(url)}" target="_blank" rel="noreferrer"><img src="${esc(url)}" alt="归档媒体" onerror="this.closest('.media-card').classList.add('error')"></a>`;
    return `<article class="media-card ${esc(item.status)}"><header><span>${esc(item.role === "output" ? "输出产物" : item.role === "input" ? "输入资源" : "待分类")}</span><span>${esc(mime || "unknown")}</span></header>${player}<div class="media-info"><strong>${esc(item.title || item.nodeId || item.sha256?.slice(0, 12) || "外部引用")}</strong><small>${esc(item.nodeType || "媒体")} · ${esc(item.bytes || "—")} bytes</small>${item.error ? `<small>${esc(item.error)}</small>` : ""}<a href="${esc(url)}" target="_blank" rel="noreferrer">打开原文件</a></div></article>`;
  };
  const grouped = [["输入资源", media.filter((item) => item.role === "input")], ["输出产物", media.filter((item) => item.role === "output")], ["其他媒体", media.filter((item) => !["input", "output"].includes(item.role))]];
  return grouped.filter(([, items]) => items.length).map(([title, items]) => `<section class="media-group"><h3>${esc(title)}</h3><div class="media-grid">${items.map(card).join("")}</div></section>`).join("");
}

function renderCanvasSnapshot(snapshot) {
  const payload = snapshot?.payload || snapshot;
  if (!payload) return `<div class="canvas-explainer">此历史 Run 没有完整画布快照；仅保留截图和 Trace。</div>`;
  const nodes = payload.nodes || [];
  const connections = payload.connections || [];
  return `<div class="canvas-summary"><div class="stat"><strong>${nodes.length}</strong><span>节点</span></div><div class="stat"><strong>${connections.length}</strong><span>连线</span></div><div class="stat"><strong>${esc(payload.canvasType || "—")}</strong><span>画布类型</span></div></div><div class="node-grid">${nodes.map((node) => `<article class="node"><header><span>${esc(node.type || node.data?.type || "node")}</span><small>${esc(node.id || "")}</small></header><strong>${esc(node.data?.label || node.data?.title || node.data?.content || node.metadata?.title || "未命名节点")}</strong><small>${esc(JSON.stringify(node.metadata || node.data?.metadata || {}).slice(0, 500))}</small></article>`).join("") || '<div class="no-media">画布中没有节点。</div>'}</div><details><summary>查看完整节点与连线 JSON</summary><pre>${esc(JSON.stringify({ nodes, connections, viewport: payload.viewport }, null, 2))}</pre></details>`;
}

const deterministicRuleGuide = {
  AGENT_TARGET_TURN_COMPLETED: ["用户目标轮已执行", "检查用户请求所在的目标轮是否完成；未完成或失败会触发硬阻断。"],
  REQUIRED_CONTEXT_READ: ["已读取当前画布", "检查 Agent 是否先调用 canvas_get_state，基于真实画布类型、已有节点和附件状态再决策。"],
  REQUIRED_USER_OPERATION: ["已调用必要工具", "检查 Agent 是否调用完成用户目标所需的生成、创建或连接工具；澄清/拒绝类 Case 不要求写入工具。"],
  EXPECTED_CANVAS_STRUCTURE: ["已形成要求的画布结构", "检查生成任务是否有对应文本、配置和成功的媒体节点；编排任务是否有要求的章节、剧情、选择或游戏结构。"],
  CONTENT_STORY_ISOLATION: ["内容/剧情结构隔离", "隔离 Case 检查内容画布未写入互动剧情节点和运行态分支连线，且画布类型正确。"],
  USER_FACING_FAILURE_TRUTHFULNESS: ["失败或限制反馈真实", "隔离、缺输入和恢复场景检查是否如实说明限制，并给出用户可以执行的下一步。"]
};
const dimensionGuide = {
  executionEvidence: "核对用户目标轮是否执行，Agent 是否先读取当前画布并基于真实状态行动。",
  taskOrchestration: "核对是否理解指令、选择正确模态，并完成必要节点、连接和步骤。",
  canvasUsability: "核对节点结构是否清楚、状态是否一致、产物是否易定位且可继续编辑。",
  artifactQuality: "核对主体、场景、风格、动作/镜头、时长、参考约束、清晰度和明显瑕疵；视频和音频必须实际播放。",
  reliabilityBoundary: "核对成功/失败反馈是否真实，出现限制或失败时是否保留成果并给出可执行的下一步。"
};
const scoreAnchor = "5=完整满足；4=核心满足、仅轻微瑕疵；3=可用但有明确缺口；2=关键要求明显不足；1=核心任务大多未完成；0=无结果/不可用/事实矛盾；不适用=无法依据现有证据判断。";
function scoreSelect(name, value = "") { return `<label class="score-input"><span>${esc(displayLabel(name))}</span><small>${esc(dimensionGuide[name])}</small><select name="${esc(name)}"><option value="">不适用</option>${[0,1,2,3,4,5].map((score) => `<option value="${score}" ${String(value) === String(score) ? "selected" : ""}>${score} 分</option>`).join("")}</select><em>${esc(scoreAnchor)}</em></label>`; }
function options(values) { return values.map((value) => `<option value="${esc(value)}">${esc(displayLabel(value))}</option>`).join(""); }
function renderScoringGuide() {
  const dimensions = [["执行与证据完整性", "20", "确定性证据 + 人工确认"], ["任务完成与工具编排", "20", "确定性证据 + 模型辅助 + 人工"], ["画布可用性与可编辑性", "15", "模型辅助 + 人工"], ["产物质量与需求符合度", "30", "DeepSeek V4 Pro + 人工"], ["交互可靠性与边界行为", "15", "确定性证据 + 模型辅助 + 人工"]];
  return `<details class="scoring-guide"><summary><span>评分如何形成</span><small>展开查看三层证据、100 分总分与最终结论的关系</small></summary><div class="guide-body"><div class="guide-callout"><strong>先看事实，再看模型，最后由人工定结论。</strong><p>确定性证据只检查用户可感知的 Agent 行为：目标轮、必要工具、画布结构和隔离边界；DeepSeek V4 Pro 只提供可复核辅助意见；最新有效人工评审才是最终质量结论。三层分数不会自动相加或互相覆盖。</p></div><div class="evidence-layers"><article><b>1</b><h4>确定性证据</h4><p>验证目标轮、必要工具、所需节点/连线及内容与剧情结构隔离等用户可感知行为。</p><small>快照、Trace 和归档媒体只用于读取行为，不是独立评分项。</small></article><article><b>2</b><h4>模型辅助</h4><p>DeepSeek V4 Pro 根据任务包中的媒体、快照、关键帧和规则给出 0–5 分与依据。</p><small>只能辅助，不决定最终状态。</small></article><article><b>3</b><h4>人工评审</h4><p>结合全部证据判断可用性、审美和编辑体验，并记录可复核的事实观察。</p><small>归因由后续模型候选与产研确认处理。</small></article></div><div class="guide-table"><table><thead><tr><th>评分维度</th><th>权重</th><th>主要证据来源</th></tr></thead><tbody>${dimensions.map(([name, weight, source]) => `<tr><td>${name}</td><td>${weight}</td><td>${source}</td></tr>`).join("")}</tbody></table></div><p class="formula">总分仅用于趋势和排序：人工可用维度按“原始分 ÷ 5 × 权重”计算；选择“不适用”的维度不计为 0 分。硬阻断存在时，最终状态只能是“失败”或“不可评估”，除非人工能引用证据证明是评测基础设施误判。</p><p class="guide-anchor">统一分数锚点：${esc(scoreAnchor)}</p></div></details>`;
}
function reviewScoreGrid(review) {
  const dimensions = ["executionEvidence", "taskOrchestration", "canvasUsability", "artifactQuality", "reliabilityBoundary"];
  return `<div class="review-score-summary"><strong>人工分项评分</strong><div>${dimensions.map((dimension) => { const score = review.scores?.[dimension]; return `<span><b>${esc(displayLabel(dimension))}</b><em>${score === null || score === undefined ? "不适用" : `${esc(score)} / 5`}</em></span>`; }).join("")}</div></div>`;
}
function renderScoringPanel() {
  const { deterministic, judgeTask, judgeResult, reviews, result } = state.detail;
  const current = reviews?.current; const history = reviews?.reviews || [];
  const activeRules = deterministic?.rules?.filter((item) => item.id !== "NETWORK_NO_CREDIT") || [];
  const ruleRows = activeRules.map((item) => { const [name, how] = deterministicRuleGuide[item.id] || [item.id, "查看规则说明和关联证据。"]; return `<tr><td><strong>${esc(name)}</strong><small>${esc(how)}</small></td><td>${badge(item.status)}${item.hardGate ? '<small class="hard-gate">硬阻断</small>' : ""}</td><td>${esc(item.reason)}</td><td>${item.evidence?.map((evidence) => `<a href="${fileUrl(evidence.path)}" target="_blank" rel="noreferrer">${esc(evidence.label)}</a>`).join(" ") || "—"}</td></tr>`; }).join("") || "<tr><td colspan=4>尚未生成确定性评分。</td></tr>";
  const judgeScores = judgeResult?.scores ? Object.entries(judgeResult.scores).map(([dimension, score]) => `<article class="model-score"><span>${esc(displayLabel(dimension))}</span><strong>${score === null ? "不适用" : `${score} / 5`}</strong><small>${esc(dimensionGuide[dimension] || "按任务包中的可见证据评分。")}</small></article>`).join("") : "";
  const judge = judgeResult ? `<section class="model-review"><header><div><span>DeepSeek V4 Pro 模型辅助评审</span><h3>按任务包证据逐维评分</h3></div><b>置信度 ${esc(judgeResult.confidence ?? "—")}</b></header><p class="model-rule">模型只使用任务要求、确定性摘要、画布/媒体证据和视频关键帧评分；${esc(scoreAnchor)} 模型结论不会替代人工结论。</p><div class="model-score-grid">${judgeScores}</div><div class="model-detail"><article><strong>模型发现</strong><ul>${(judgeResult.findings || ["未提供"]).map((item) => `<li>${esc(item)}</li>`).join("")}</ul></article><article><strong>人工重点核验</strong><ul>${(judgeResult.humanFocus || ["无"]).map((item) => `<li>${esc(item)}</li>`).join("")}</ul></article><article><strong>模型引用证据</strong><p>${(judgeResult.evidence || []).map((item) => `<a href="${fileUrl(item.path)}" target="_blank" rel="noreferrer">${esc(item.label)}</a>`).join(" · ") || "无"}</p></article></div></section>` : `<div class="assessment-card pending"><span>模型辅助评审</span><strong>${judgeTask?.status === "pending" ? "待切换 DeepSeek V4 Pro 执行" : "不适用"}</strong><p>${judgeTask ? `任务包：${esc(judgeTask.taskId)}。请使用评分任务包，不自动替换其他模型。` : "尚未生成任务包。"}</p>${judgeTask?.caseId ? `<a href="${fileUrl(`scoring/judge-tasks/${judgeTask.caseId}.md`)}" target="_blank" rel="noreferrer">打开 DeepSeek 评分任务</a>` : ""}</div>`;
  const reportLocked = Boolean(state.report);
  const historyHtml = history.length ? `<div class="review-history">${history.map((review) => `<article class="review-record ${review.isCurrent ? "current" : ""}"><header><strong>${esc(review.reviewerId)}</strong><span>${review.isCurrent ? "当前有效" : "历史记录"}</span><time>${esc(new Date(review.createdAt).toLocaleString("zh-CN"))}</time></header><p class="review-notes"><strong>评审说明</strong>${badge(review.status)} ${esc(review.notes)}</p>${reviewScoreGrid(review)}${review.recommendation?.trim() ? `<p class="review-recommendation"><strong>研发建议</strong>${esc(review.recommendation)}</p>` : ""}${reportLocked ? `<p class="review-locked">最终研发报告已生成，本轮评审记录已冻结。</p>` : `<button class="review-edit" type="button" data-review-id="${esc(review.id)}" aria-label="编辑此条人工评审" title="编辑此条人工评审">编辑</button>`}</article>`).join("")}</div>` : `<div class="no-media">尚无人工评审。请先阅读下方填写指引，再结合媒体、画布和 Trace 完成首次评审。</div>`;
  return `<div class="score-overview"><article class="assessment-card"><span>确定性评分</span><strong>${deterministic ? (deterministic.hardGateFailed ? "存在硬阻断" : "用户行为检查完成") : "未生成"}</strong><p>${deterministic ? `执行与证据 ${deterministic.dimensionScores?.executionEvidence ?? "—"} · 工具编排 ${deterministic.dimensionScores?.taskOrchestration ?? "—"} · 可靠性 ${deterministic.dimensionScores?.reliabilityBoundary ?? "—"}` : ""}</p></article><div class="assessment-card"><span>人工质量结论</span><strong>${current ? esc(scoreLabel(current.status)) : "待评审"}</strong><p>${current ? `评审人：${esc(current.reviewerId)} · ${new Date(current.createdAt).toLocaleString("zh-CN")}` : "人工结论是最终质量依据。"}</p></div></div><section class="score-section"><h3>确定性规则与证据</h3><p class="section-help">自动规则只核验用户实际使用时的 Agent 行为，不评价审美。快照、Trace 和归档资料只用来读取行为；每项显示检查内容、结果、原因和证据，标为“硬阻断”的失败会限制最终状态。</p><div class="score-table"><table><thead><tr><th>检查项与判断方式</th><th>结果</th><th>本 Case 结果</th><th>证据</th></tr></thead><tbody>${ruleRows}</tbody></table></div></section>${judge}<section class="score-section"><h3>人工评审历史</h3>${historyHtml}</section><section class="score-section"><h3>${reportLocked ? "人工评审已冻结" : state.reviewDraft ? "编辑人工评审" : "追加人工评审"}</h3>${reportLocked ? '<div class="review-freeze-notice">最终研发报告已生成。为确保报告可追溯，本轮评审不能再修改；如需更正，请开启新的评分轮次。</div>' : `<p class="section-help">请按五维独立评分，并在评审说明中写清观察到的事实、用户影响和依据。点击历史记录右下角的“编辑”可直接修改并保存覆盖该记录；归因由全部评审完成后的模型候选与产研确认阶段处理。</p>${renderReviewForm(result, current)}`}</section>`;
}
function renderReviewForm(result, current) {
  const draft = state.reviewDraft;
  const source = draft || { scores: current?.scores || {} };
  const statusOption = (value, label) => `<option value="${value}" ${source.status === value ? "selected" : ""}>${label}</option>`;
  const editing = draft ? `<div class="review-editing"><strong>正在编辑已完成的人工评审</strong><button id="cancelReviewRevision" type="button" class="secondary-button">取消编辑</button></div>` : "";
  return `<form id="reviewForm" class="review-form" novalidate>${editing}<div class="form-grid"><label>评审人<input name="reviewerId" value="${esc(source.reviewerId || "")}" placeholder="姓名或评审 ID，例如：张三" /><small>用于保留可追溯的追加记录。</small></label><label>最终状态<select name="status">${statusOption("pass", "通过")}${statusOption("pass_with_improvements", "通过但有改进项")}${statusOption("partial", "部分完成")}${statusOption("fail", "失败")}${statusOption("not_evaluable", "不可评估")}</select><small>通过：关键要求均满足；通过但有改进项：仅轻微缺陷；部分完成：有实质缺口；失败：核心任务未完成或事实失实；不可评估：必要证据无法取得。</small></label></div><div class="form-score-guide">每个维度请填写 0–5 分或“不适用”。${esc(scoreAnchor)}</div><div class="form-grid score-grid">${scoreSelect("executionEvidence", source.scores?.executionEvidence)}${scoreSelect("taskOrchestration", source.scores?.taskOrchestration)}${scoreSelect("canvasUsability", source.scores?.canvasUsability)}${scoreSelect("artifactQuality", source.scores?.artifactQuality)}${scoreSelect("reliabilityBoundary", source.scores?.reliabilityBoundary)}</div><label>评审说明<textarea name="notes" placeholder="请写明：①看到的关键证据；②任务是否满足；③评分或最终状态的依据。示例：已播放视频，主体和镜头满足要求，但中段存在明显闪烁，因此产物质量 3 分。">${esc(source.notes || "")}</textarea><small>不要只写“效果一般”；请把结论与具体媒体、节点、Trace 或反馈事实关联。</small></label><label>研发建议<textarea name="recommendation" placeholder="写出可执行建议：修复什么、由谁修复、如何用哪个 Case 验证。例如：生成服务增加无文字约束，并以 CP-04 回归验证。">${esc(source.recommendation || "")}</textarea></label><label class="checkbox"><input type="checkbox" name="needsConfirmation" ${source.needsConfirmation ? "checked" : ""} /> 标记为待确认，保留给后续追加评审</label><button type="submit">${draft ? "保存修改" : "追加并设为当前有效评审"}</button><p id="reviewMessage" class="form-message" aria-live="polite">证据将默认引用本 Case 的结果、画布快照和媒体清单。</p></form>`;
}
function beginReviewRevision(reviewId) {
  const review = state.detail?.reviews?.reviews?.find((item) => item.id === reviewId);
  if (!review || state.report) return;
  state.reviewDraft = review;
  renderDetail(); showTab("scoring");
  document.getElementById("reviewForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function cancelReviewRevision() { state.reviewDraft = null; renderDetail(); showTab("scoring"); }
async function submitReview(event) {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const reviewerId = String(data.get("reviewerId") || "").trim(); const notes = String(data.get("notes") || "").trim(); const status = data.get("status"); const message = $("reviewMessage");
  message.classList.remove("error");
  if (!reviewerId || !notes) { const missing = !reviewerId ? "评审人" : "评审说明"; message.classList.add("error"); message.textContent = `请先填写${missing}，再提交评审。`; form.elements[!reviewerId ? "reviewerId" : "notes"]?.focus(); return; }
  const evidence = [{ path: `${state.active.id}/result.json`, label: "运行结果" }, { path: `${state.active.id}/evidence/canvas-snapshot.json`, label: "画布快照" }, { path: `${state.active.id}/evidence/artifact-manifest.json`, label: "媒体清单" }];
  const payload = { reviewerId, status, scores: Object.fromEntries(["executionEvidence","taskOrchestration","canvasUsability","artifactQuality","reliabilityBoundary"].map((key) => [key, data.get(key) === "" ? null : Number(data.get(key))])), evidence, attributions: state.reviewDraft?.attributions || [], notes, recommendation: data.get("recommendation"), needsConfirmation: data.get("needsConfirmation") === "on" };
  const editingId = state.reviewDraft?.id; const endpoint = editingId ? `/api/scoring/${encodeURIComponent(state.runId)}/${encodeURIComponent(state.active.id)}/reviews/${encodeURIComponent(editingId)}` : `/api/scoring/${encodeURIComponent(state.runId)}/${encodeURIComponent(state.active.id)}/reviews`;
  const button = form.querySelector('button[type="submit"]'); if (button) { button.disabled = true; button.textContent = "正在保存…"; } message.textContent = "正在保存…";
  try { const response = await fetch(endpoint, { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const output = await response.json(); if (!response.ok) throw new Error(output.error || "保存失败"); state.reviewDraft = null; state.scoring = await fetchJson(`/api/scoring/${encodeURIComponent(state.runId)}`); await loadCase(state.active.id); } catch (error) { message.classList.add("error"); message.textContent = `保存失败：${error.message}`; if (button) { button.disabled = false; button.textContent = state.reviewDraft ? "保存修改" : "追加并设为当前有效评审"; } }
}

function renderDetail() {
  const { result, snapshot, artifacts, evaluation } = state.detail;
  const audit = result.channelAudit || {};
  const canvasId = result.canvasUrl?.split("/").pop() || "";
  const outputKind = result.modality.includes("v") ? "视频/画布产物" : result.modality.includes("i") || result.modality === "panorama" ? "图片/画布产物" : "最终画布产物";
  const isFinalScreenshot = result.screenshotMeta?.kind === "final" || (!result.screenshotMeta && /final\.png$/.test(result.screenshot || ""));
  const screenshotCard = result.screenshot ? `<article class="artifact-card"><header>${isFinalScreenshot ? "最终画布截图" : "失败现场截图"}</header><a class="screenshot" href="${fileUrl(result.screenshot)}" target="_blank" rel="noreferrer"><img src="${fileUrl(result.screenshot)}" alt="${esc(result.id)} ${isFinalScreenshot ? "最终画布" : "失败现场"}截图" onerror="this.closest('.artifact-card').classList.add('error')" /></a><p>${isFinalScreenshot ? "已验证路由、画布 ID 与工作区版本修订后保存的最终画布状态。" : "该截图仅记录失败或阻塞时的浏览器现场，不能作为最终画布或产物验收依据。"}</p></article>` : '<article class="artifact-card"><header>截图证据</header><p>浏览器中断前未能保存截图。</p></article>';
  $("detail").innerHTML = `<section class="hero">
    <div><div class="eyebrow">Echo 浏览器评测 · ${esc(displayLabel(result.modality))}</div><h1>${esc(result.id)} · ${esc(result.title)}</h1><p>${badge(result.status)} <span class="quiet">总耗时 ${formatDuration(durationOf(result))} · ${new Date(result.startedAt).toLocaleString("zh-CN")}</span></p></div>
    <div class="hero-actions"><span class="pill neutral">${evaluation ? `执行 ${esc(displayLabel(evaluation.executionStatus))} · 证据 ${esc(displayLabel(evaluation.evidenceStatus))}` : "历史截图与 Trace"}</span><small>${evaluation ? `验收：${esc(displayLabel(evaluation.acceptanceStatus))} · 人工接管：${esc(displayLabel(evaluation.interventionStatus))}` : "此历史 Run 未含持久画布快照。"}</small>${result.canvasUrl ? `<a class="canvas-link" href="${esc(result.canvasUrl)}" target="_blank" rel="noreferrer">打开实际画布</a>` : ""}</div>
  </section>
  ${result.error ? `<section class="case-error"><strong>用例失败/异常原因</strong><p>${esc(result.error)}</p></section>` : ""}
  <section class="case-facts">
    <article><span>模型决策</span><strong>DeepSeek ${audit.deepseekRequests || 0} 次</strong></article>
    <article><span>生成调用</span><strong>WorkRally ${audit.workrallyRequests || 0} 次</strong></article>
    <article><span>音频渠道</span><strong>${audit.audioBlocked ? "当前未配置" : "可用/未使用"}</strong></article>
  </section>
  <nav class="tabs"><button class="tab selected" data-tab="overview">概览</button><button class="tab" data-tab="scoring">评分</button><button class="tab" data-tab="canvas">画布结构</button><button class="tab" data-tab="media">媒体产物</button><button class="tab" data-tab="execution">Agent 执行过程</button><button class="tab" data-tab="evidence">Trace 与证据</button><button class="tab" data-tab="intervention">人工接管</button></nav>
  <section id="tab-overview" class="tab-panel"><div class="section-head"><div><span>用户输入</span><h2>用户输入与轮次</h2></div></div>${renderTurns(result)}<div class="section-head output"><div><span>执行产出</span><h2>${esc(outputKind)}</h2></div></div><div class="artifact-grid">${screenshotCard}<article class="artifact-card"><header>画布归档状态</header><p>画布 ID：<code>${esc(result.canvasId || canvasId || "未记录")}</code>；类型：<code>${esc(displayLabel(result.canvasType))}</code>；工作区版本修订：<code>${esc(result.workspaceRevision || "—")}</code>。</p><p>${artifacts ? `已归档 ${artifacts.media?.length || 0} 项媒体与完整快照；请在“画布结构”和“媒体产物”标签复核。` : "此历史 Run 仅保留截图与 Trace。"}</p></article></div></section>
  <section id="tab-scoring" class="tab-panel hidden"><div class="section-head"><div><span>评分 · 规范 1.5.0</span><h2>确定性证据、DeepSeek 辅助与人工质量结论</h2></div></div>${renderScoringPanel()}</section>
  <section id="tab-execution" class="tab-panel hidden"><div class="section-head"><div><span>Agent 执行轨迹</span><h2>模型决策 → 画布工具 → 工具结果回灌</h2></div></div>${renderExecutionSteps()}</section>
  <section id="tab-evidence" class="tab-panel hidden"><div class="section-head"><div><span>渠道证据</span><h2>调用渠道与原始证据入口</h2></div></div>${renderNetwork(result)}<div class="source-links evidence-links"><a href="${fileUrl(`${result.id}/result.json`)}" target="_blank" rel="noreferrer">结构化用例结果</a>${result.screenshot ? `<a href="${fileUrl(result.screenshot)}" target="_blank" rel="noreferrer">${isFinalScreenshot ? "最终截图原文件" : "失败现场截图"}</a>` : ""}${(result.traceFiles || []).map((file) => `<a href="${fileUrl(`${result.id}/${file}`)}" target="_blank" rel="noreferrer">${esc(file.split("/").pop())}</a>`).join("")}</div></section>
  <section id="tab-canvas" class="tab-panel hidden"><div class="section-head"><div><span>画布快照</span><h2>归档画布结构</h2></div></div>${renderCanvasSnapshot(snapshot)}</section>
  <section id="tab-media" class="tab-panel hidden"><div class="section-head"><div><span>媒体评审</span><h2>归档图片、视频与音频</h2></div></div>${renderArchivedMedia(artifacts, result, snapshot)}</section>
  <section id="tab-intervention" class="tab-panel hidden"><div class="section-head"><div><span>人工接管</span><h2>人工接管时间线</h2></div></div>${evaluation ? `<div class="canvas-explainer"><p>执行：<code>${esc(displayLabel(evaluation.executionStatus))}</code>；验收：<code>${esc(displayLabel(evaluation.acceptanceStatus))}</code>；证据：<code>${esc(displayLabel(evaluation.evidenceStatus))}</code>；接管：<code>${esc(displayLabel(evaluation.interventionStatus))}</code>。</p><div class="trace">${(evaluation.events || []).map((event) => `<article class="turn"><header><strong>${esc(displayLabel(event.type))}</strong><span>${esc(new Date(event.at).toLocaleString("zh-CN"))}</span></header>${event.detail ? `<p>${esc(event.detail)}</p>` : ""}</article>`).join("") || "暂无人工接管事件。"}</div></div>` : '<div class="canvas-explainer">此历史 Run 未记录人工接管状态。</div>'}</section>`;
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.tab)));
  document.querySelectorAll(".review-edit").forEach((button) => button.addEventListener("click", () => beginReviewRevision(button.dataset.reviewId)));
  $("cancelReviewRevision")?.addEventListener("click", cancelReviewRevision);
  $("reviewForm")?.addEventListener("submit", (event) => void submitReview(event));
}

function showTab(tab) {
  document.querySelectorAll(".tab").forEach((node) => node.classList.toggle("selected", node.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((node) => node.classList.toggle("hidden", node.id !== `tab-${tab}`));
}

$("loadBtn").addEventListener("click", () => void loadRun());
["search", "statusFilter", "mediaFilter"].forEach((id) => $(id).addEventListener("input", renderList));
$("runInput").value = state.runId;
void loadRun();
