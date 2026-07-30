import { NextRequest, NextResponse } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { createRcaRecord } from "@/rca";

/** POST /api/badcases/:id/rca — 为 badcase 写入 RCA */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { responsibleModule, problemCategory, problemEnum, fixActions } = body as {
      responsibleModule?: string;
      problemCategory?: string;
      problemEnum?: string;
      fixActions?: unknown[];
    };

    if (!responsibleModule || !problemCategory || !problemEnum) {
      return NextResponse.json(
        fail("缺少必填字段：responsibleModule / problemCategory / problemEnum"),
        { status: 400 }
      );
    }

    const record = await createRcaRecord({
      badcaseId: id,
      responsibleModule,
      problemCategory,
      problemEnum,
      fixActions: Array.isArray(fixActions) ? fixActions as never[] : [],
      ...body,
    });

    return NextResponse.json(
      ok({
        ...record,
        candidateModules: JSON.parse(record.candidateModules),
        moduleDiagnosis: JSON.parse(record.moduleDiagnosis),
        fixActions: JSON.parse(record.fixActions),
      }),
      { status: 201 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}
