-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "agentTypes" TEXT NOT NULL DEFAULT '[]',
    "standardPath" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AgentConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "endpoint" TEXT,
    "callbackPath" TEXT,
    "secretEnvRef" TEXT,
    "capabilities" TEXT NOT NULL DEFAULT '{}',
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastVerifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentConnection_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "split" TEXT NOT NULL DEFAULT 'capability',
    "version" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "caseCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Dataset_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "datasetId" TEXT,
    "connectionId" TEXT,
    "baselineRunId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'eval',
    "mode" TEXT NOT NULL DEFAULT 'simulate',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "configuration" TEXT NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "gateResult" TEXT,
    "gatePassed" BOOLEAN,
    "cancellationReason" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Run_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Run_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AgentConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_baselineRunId_fkey" FOREIGN KEY ("baselineRunId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunTrial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseSnapshot" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "executorType" TEXT NOT NULL,
    "isolationNamespace" TEXT,
    "cleanupStatus" TEXT NOT NULL DEFAULT 'pending',
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunTrial_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TraceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traceId" TEXT NOT NULL,
    "eventKey" TEXT,
    "sessionId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "skillId" TEXT,
    "caseId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'eval',
    "runId" TEXT,
    "trialId" TEXT,
    "input" TEXT NOT NULL,
    "spans" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "stateBefore" TEXT,
    "stateAfter" TEXT,
    "usage" TEXT NOT NULL DEFAULT '{}',
    "versions" TEXT NOT NULL DEFAULT '{}',
    "meta" TEXT,
    "startTime" DATETIME NOT NULL,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TraceRecord_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TraceRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TraceRecord_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "RunTrial" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traceRecordId" TEXT NOT NULL,
    "trialId" TEXT,
    "targetLevel" TEXT NOT NULL,
    "scorerType" TEXT NOT NULL,
    "ruleType" TEXT,
    "verdict" TEXT NOT NULL,
    "reason" TEXT,
    "confidence" REAL,
    "score" REAL,
    "issueType" TEXT,
    "problemCategory" TEXT,
    "phenomenon" TEXT,
    "details" TEXT,
    "needsHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "spotChecked" BOOLEAN NOT NULL DEFAULT false,
    "humanOverride" TEXT,
    "reviewerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Annotation_traceRecordId_fkey" FOREIGN KEY ("traceRecordId") REFERENCES "TraceRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Annotation_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "RunTrial" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HumanReviewTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "annotationId" TEXT,
    "trialId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proposedVerdict" TEXT,
    "resolvedVerdict" TEXT,
    "reviewerId" TEXT,
    "evidence" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "HumanReviewTask_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "Annotation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "HumanReviewTask_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "RunTrial" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Badcase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traceRecordId" TEXT,
    "trialId" TEXT,
    "caseId" TEXT,
    "risk" TEXT,
    "source" TEXT NOT NULL DEFAULT 'eval-fail',
    "dataSource" TEXT NOT NULL DEFAULT 'eval',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "triageResult" TEXT,
    "clusterId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Badcase_traceRecordId_fkey" FOREIGN KEY ("traceRecordId") REFERENCES "TraceRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Badcase_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "RunTrial" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Badcase_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "ProblemCluster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RcaRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "badcaseId" TEXT NOT NULL,
    "candidateModules" TEXT NOT NULL DEFAULT '[]',
    "moduleDiagnosis" TEXT NOT NULL DEFAULT '{}',
    "responsibleModule" TEXT NOT NULL,
    "problemCategory" TEXT NOT NULL,
    "problemEnum" TEXT NOT NULL,
    "confidence" REAL,
    "evidence" TEXT,
    "report" TEXT,
    "fixActions" TEXT NOT NULL DEFAULT '[]',
    "owner" TEXT,
    "specPath" TEXT,
    "verificationRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RcaRecord_badcaseId_fkey" FOREIGN KEY ("badcaseId") REFERENCES "Badcase" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProblemCluster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "skillId" TEXT,
    "rootCause" TEXT NOT NULL DEFAULT 'unknown',
    "category" TEXT,
    "scenario" TEXT,
    "risk" TEXT,
    "tool" TEXT,
    "size" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'open',
    "signature" TEXT,
    "concentratedVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProblemCluster_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillOptRound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "skillId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "trainRunId" TEXT,
    "validationRunId" TEXT,
    "candidateEdits" TEXT NOT NULL DEFAULT '[]',
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SkillOptRound_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillOptRound_trainRunId_fkey" FOREIGN KEY ("trainRunId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SkillOptRound_validationRunId_fkey" FOREIGN KEY ("validationRunId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RejectedEdit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillOptRoundId" TEXT,
    "skillId" TEXT,
    "edit" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "validationResult" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RejectedEdit_skillOptRoundId_fkey" FOREIGN KEY ("skillOptRoundId") REFERENCES "SkillOptRound" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductionIngestEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventKey" TEXT NOT NULL,
    "traceRecordId" TEXT,
    "authorizationRef" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "redactionResult" TEXT NOT NULL DEFAULT '{}',
    "sourceSystem" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionIngestEvent_traceRecordId_fkey" FOREIGN KEY ("traceRecordId") REFERENCES "TraceRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AgentConnection_agentId_status_idx" ON "AgentConnection"("agentId", "status");

-- CreateIndex
CREATE INDEX "Dataset_agentId_split_idx" ON "Dataset"("agentId", "split");

-- CreateIndex
CREATE UNIQUE INDEX "Dataset_agentId_filePath_key" ON "Dataset"("agentId", "filePath");

-- CreateIndex
CREATE INDEX "Run_agentId_status_queuedAt_idx" ON "Run"("agentId", "status", "queuedAt");

-- CreateIndex
CREATE INDEX "Run_baselineRunId_idx" ON "Run"("baselineRunId");

-- CreateIndex
CREATE INDEX "RunTrial_runId_status_idx" ON "RunTrial"("runId", "status");

-- CreateIndex
CREATE INDEX "RunTrial_caseId_risk_idx" ON "RunTrial"("caseId", "risk");

-- CreateIndex
CREATE UNIQUE INDEX "RunTrial_runId_caseId_attempt_key" ON "RunTrial"("runId", "caseId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "TraceRecord_traceId_key" ON "TraceRecord"("traceId");

-- CreateIndex
CREATE UNIQUE INDEX "TraceRecord_eventKey_key" ON "TraceRecord"("eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "TraceRecord_trialId_key" ON "TraceRecord"("trialId");

-- CreateIndex
CREATE INDEX "TraceRecord_agentId_source_createdAt_idx" ON "TraceRecord"("agentId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "TraceRecord_runId_caseId_idx" ON "TraceRecord"("runId", "caseId");

-- CreateIndex
CREATE INDEX "TraceRecord_skillId_idx" ON "TraceRecord"("skillId");

-- CreateIndex
CREATE INDEX "Annotation_traceRecordId_scorerType_idx" ON "Annotation"("traceRecordId", "scorerType");

-- CreateIndex
CREATE INDEX "Annotation_trialId_verdict_idx" ON "Annotation"("trialId", "verdict");

-- CreateIndex
CREATE INDEX "HumanReviewTask_status_createdAt_idx" ON "HumanReviewTask"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Badcase_traceRecordId_key" ON "Badcase"("traceRecordId");

-- CreateIndex
CREATE INDEX "Badcase_status_risk_createdAt_idx" ON "Badcase"("status", "risk", "createdAt");

-- CreateIndex
CREATE INDEX "Badcase_clusterId_idx" ON "Badcase"("clusterId");

-- CreateIndex
CREATE UNIQUE INDEX "RcaRecord_badcaseId_key" ON "RcaRecord"("badcaseId");

-- CreateIndex
CREATE INDEX "RcaRecord_problemEnum_idx" ON "RcaRecord"("problemEnum");

-- CreateIndex
CREATE INDEX "ProblemCluster_agentId_rootCause_status_idx" ON "ProblemCluster"("agentId", "rootCause", "status");

-- CreateIndex
CREATE INDEX "SkillOptRound_agentId_skillId_status_idx" ON "SkillOptRound"("agentId", "skillId", "status");

-- CreateIndex
CREATE INDEX "RejectedEdit_skillId_createdAt_idx" ON "RejectedEdit"("skillId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionIngestEvent_eventKey_key" ON "ProductionIngestEvent"("eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionIngestEvent_traceRecordId_key" ON "ProductionIngestEvent"("traceRecordId");

-- CreateIndex
CREATE INDEX "ProductionIngestEvent_sourceSystem_receivedAt_idx" ON "ProductionIngestEvent"("sourceSystem", "receivedAt");

