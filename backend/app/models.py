"""Pydantic schemas. The Finding contract is the API's single source of truth."""
from typing import Literal
from pydantic import BaseModel, Field

Severity = Literal["critical", "warning", "suggestion"]
Category = Literal["tone", "term", "claim", "a11y", "visual"]
Status = Literal["draft", "review", "peer_review", "changes", "approved",
                 "published"]


class Finding(BaseModel):
    id: int | None = None
    content_id: int | None = None
    category: Category
    severity: Severity
    rule: str
    excerpt: str = ""
    suggestion: str = ""
    accepted: int = 0          # 0=pending 1=accepted 2=dismissed
    confidence: float = 0.6    # 0.0-1.0 model certainty (human-review cue)
    evidence: str = ""         # source attribution: fact/guideline/glossary


class ContentCreate(BaseModel):
    type: Literal["text", "image", "email", "social"] = "text"
    title: str = Field(default="", max_length=500)
    text: str = Field(default="", max_length=50_000)
    channel: str = Field(default="web", max_length=100)
    created_by: str = Field(default="creator", max_length=200)


class ContentOut(BaseModel):
    id: int
    type: str
    title: str
    text: str
    image_path: str | None = None
    channel: str
    status: str
    created_by: str
    team: str = "marketing"
    sla_due_at: str | None = None
    published_at: str | None = None
    created_at: str


class ContentWithFindings(ContentOut):
    findings: list[Finding] = []


class FindingPatch(BaseModel):
    accepted: Literal[0, 1, 2]   # 0=pending 1=accepted 2=dismissed


class ReviewResult(BaseModel):
    content_id: int
    findings: list[Finding]
    provider: str
    llm_used: bool
    latency_ms: int
    tokens: int = 0


class CategoryCount(BaseModel):
    category: str
    count: int
    critical: int
    warning: int
    suggestion: int


class TeamScore(BaseModel):
    team: str
    total: int
    approved: int
    pending: int
    findings: int
    criticals: int
    compliance_rate: float


class TrendPoint(BaseModel):
    date: str
    created: int
    approved: int
    findings: int
    compliance_rate: float


class TrendResponse(BaseModel):
    days: int
    points: list[TrendPoint] = []


class AnalyticsSummary(BaseModel):
    total_content: int
    approved: int
    pending: int
    compliance_rate: float
    total_findings: int
    by_category: list[CategoryCount]
    most_violated_rules: list[dict]
    findings_by_severity: dict[str, int]
    llm_calls: int = 0
    total_tokens: int = 0
    by_team: list[TeamScore] = []
    heat_map: list[dict] = []          # category x severity matrix
    overdue_reviews: list[dict] = []   # SLA breaches
    stale_facts: list[dict] = []       # fact store freshness gaps
    guideline_gaps: list[dict] = []    # KB coverage gaps per category
