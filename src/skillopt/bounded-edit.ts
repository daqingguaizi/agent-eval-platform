import { readMarkdown, writeMarkdown } from "@/lib/fs-store";

export interface BoundedEdit {
  op: "add" | "delete" | "replace";
  target: string;
  content?: string;
}

export function validateBoundedEdits(edits: BoundedEdit[]) {
  if (!edits.length || edits.length > 5) return "每轮必须包含 1 到 5 个 Bounded Edit";
  return edits.some((edit) => !edit.target || (edit.op !== "delete" && !edit.content)) ? "每条编辑必须提供 target，add/replace 必须提供 content" : null;
}

export async function applyBoundedEdits(skillPath: string, edits: BoundedEdit[]) {
  const validation = validateBoundedEdits(edits);
  if (validation) throw new Error(validation);
  let content = await readMarkdown("skills", skillPath);
  for (const edit of edits) {
    if (edit.op === "add") content = `${content.trimEnd()}\n${edit.content}\n`;
    else if (!content.includes(edit.target)) throw new Error(`未找到编辑目标：${edit.target}`);
    else content = edit.op === "delete" ? content.replace(edit.target, "") : content.replace(edit.target, edit.content!);
  }
  await writeMarkdown("skills", skillPath, content);
  return content;
}
