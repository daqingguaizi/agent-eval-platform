import assert from "node:assert/strict";
import { chromium } from "playwright";

async function main() {
    const runId = "demo-viewer";
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:4179/viewer/?run=${runId}`, { waitUntil: "networkidle" });
        await assert.doesNotReject(async () => page.getByRole("heading", { name: /1 条创作者试点/ }).waitFor());
        assert.equal(await page.getByText("能力支持边界", { exact: true }).count(), 0);
        assert.equal(await page.getByText("用例来源", { exact: true }).count(), 0);
        assert.equal(await page.getByText("NETWORK_NO_CREDIT", { exact: true }).count(), 0);
        assert.ok(await page.getByText("内容创作", { exact: true }).count() > 0);
        assert.ok(await page.getByText("评分如何形成", { exact: true }).count() > 0);
        await page.locator('#caseList .case[data-case="CP-99"]').click();
        await page.getByRole("button", { name: "评分" }).click();
        await assert.doesNotReject(async () => page.getByRole("heading", { name: "确定性规则与证据" }).waitFor());
        assert.equal(await page.locator("#tab-scoring").getByText("评分如何形成", { exact: true }).count(), 0);
        const historyRecord = page.locator(".review-record").first();
        assert.equal(await historyRecord.getByText("人工分项评分", { exact: true }).count(), 1);
        assert.equal(await historyRecord.locator(".review-score-summary span").count(), 5);
        assert.equal(await historyRecord.getByText("研发建议", { exact: true }).count(), 1);
        await historyRecord.getByRole("button", { name: "编辑此条人工评审" }).click();
        const editForm = page.locator("#reviewForm");
        assert.equal(await editForm.getByText("正在编辑已完成的人工评审", { exact: true }).count(), 1);
        assert.equal(await editForm.getByRole("button", { name: "保存修改" }).count(), 1);
        assert.equal(await editForm.locator('input[name="reviewerId"]').inputValue(), "demo-reviewer");
        await page.route("**/api/scoring/**/reviews/*", async (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "测试编辑已送达" }) }));
        await editForm.getByRole("button", { name: "保存修改" }).click();
        await assert.doesNotReject(async () => page.getByText("保存失败：测试编辑已送达", { exact: true }).waitFor());
        await editForm.locator("#cancelReviewRevision").click();
        const reviewForm = page.locator("#reviewForm");
        const reviewNotes = reviewForm.locator('textarea[name="notes"]');
        assert.equal(await reviewNotes.evaluate((node) => getComputedStyle(node).color), "rgb(245, 248, 255)");
        await page.getByRole("button", { name: "追加并设为当前有效评审" }).click();
        await assert.doesNotReject(async () => page.getByText("请先填写评审人，再提交评审。", { exact: true }).waitFor());
        await reviewForm.locator('input[name="reviewerId"]').fill("Viewer 回归测试");
        await reviewNotes.fill("已核对画布、媒体和执行证据，提交链路应可正常发送。");
        await page.route("**/api/scoring/**/reviews", async (route) => {
            if (route.request().method() === "POST") return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "测试提交已送达" }) });
            return route.continue();
        });
        await page.getByRole("button", { name: "追加并设为当前有效评审" }).click();
        await assert.doesNotReject(async () => page.getByText("保存失败：测试提交已送达", { exact: true }).waitFor());
        console.log("viewer-pilot-scoring.spec: ok");
    } finally {
        await browser.close();
    }
}
void main();
