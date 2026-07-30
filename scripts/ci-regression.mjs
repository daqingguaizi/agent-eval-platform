#!/usr/bin/env node
/**
 * CI 回归脚本
 *
 * 用法：
 *   node scripts/ci-regression.mjs --agent echo --dataset echo/golden.yaml --gate
 *
 * 功能：
 *   1. 调用 /api/runs 触发跑测（使用已导入的 traces）
 *   2. 检查门禁结果
 *   3. 若 --gate 且门禁未通过，exit code = 1（CI 失败）
 *
 * 环境变量：
 *   EVAL_PLATFORM_URL — 平台地址（默认 http://localhost:3100）
 */

const BASE_URL = process.env.EVAL_PLATFORM_URL || "http://localhost:3100";

async function main() {
  const args = process.argv.slice(2);
  const agent = getArg(args, "--agent") || "echo";
  const dataset = getArg(args, "--dataset") || "echo/golden.yaml";
  const source = getArg(args, "--source") || "pre-release";
  const gate = args.includes("--gate");

  console.log(`\n🧪 Agent 评测回归`);
  console.log(`   Agent:   ${agent}`);
  console.log(`   Dataset: ${dataset}`);
  console.log(`   Source:  ${source}`);
  console.log(`   Gate:    ${gate ? "启用" : "仅报告"}\n`);

  // 1. 触发跑测
  console.log("▶ 触发跑测...");
  const runRes = await fetch(`${BASE_URL}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId: agent, datasetFile: dataset, source }),
  });
  const runJson = await runRes.json();

  if (runJson.code !== 0) {
    console.error(`❌ 跑测失败: ${runJson.msg}`);
    process.exit(1);
  }

  const result = runJson.data;
  console.log(`✓ 跑测完成 (runId: ${result.runId})`);
  console.log(`  总用例: ${result.totalCases}`);
  console.log(`  已评分: ${result.scored}`);
  console.log(`  未匹配: ${result.noTrace}`);
  console.log(`  Pass:   ${result.pass}`);
  console.log(`  Fail:   ${result.fail}`);
  console.log(`  通过率: ${result.passRate}`);

  // 2. 触发 badcase 识别与聚类
  if (result.fail > 0) {
    console.log("\n▶ 识别 badcase 并聚类...");
    const bcRes = await fetch(`${BASE_URL}/api/badcases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agent, runId: result.runId }),
    });
    const bcJson = await bcRes.json();
    if (bcJson.code === 0) {
      console.log(`  新增 badcase: ${bcJson.data.identified}`);
      console.log(`  聚类: ${bcJson.data.clusters.length} 个问题簇`);
    }
  }

  // 3. 门禁判定
  console.log(`\n🚦 门禁: ${result.gatePassed ? "✅ 通过" : "❌ 未通过"}`);

  if (gate && !result.gatePassed) {
    console.error("\n💥 门禁未通过，CI 失败");
    process.exit(1);
  }

  console.log("\n✅ 回归完成");
}

function getArg(args, name) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
