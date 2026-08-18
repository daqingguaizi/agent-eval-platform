window.ReviewClient = (() => {
  let health = null;
  const query = (params) => new URLSearchParams(params).toString();
  async function request(path, options) {
    const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }
  return {
    async connect() {
      try { health = await request("/api/health?run=gs-full-1&assessment=baseline-v1"); } catch { health = null; }
      return health;
    },
    get active() { return Boolean(health); },
    get health() { return health; },
    assessment(run, assessment) { return request(`/api/assessment?${query({ run, assessment })}`); },
    case(run, assessment, caseId, attempt) { return request(`/api/case?${query({ run, assessment, case: caseId, attempt })}`); },
    guidance(run, assessment) { return request(`/api/review-guidance?${query({ run, assessment })}`); },
    evidence(run, assessment, caseId, attempt) { return request(`/api/review-evidence?${query({ run, assessment, case: caseId, attempt })}`); },
    reviews(run, assessment, caseId, attempt) { return request(`/api/reviews?${query({ run, assessment, case: caseId, attempt })}`); },
    export(run, assessment, caseId, attempt) { return request(`/api/reviews/export?${query({ run, assessment, case: caseId, attempt })}`); },
    import(run, assessment, caseId, attempt, reviewPackage) { return request(`/api/reviews/import?${query({ run, assessment, case: caseId, attempt })}`, { method: "POST", body: JSON.stringify(reviewPackage) }); },
    save(run, assessment, caseId, attempt, review, action) {
      return request(`/api/reviews/${action}?${query({ run, assessment, case: caseId, attempt })}`, { method: "POST", body: JSON.stringify(review) });
    },
  };
})();
