import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const servers = new Map();
const instanceData = new Map();
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT_FROM_EXTENSION = resolve(EXTENSION_DIR, "..", "..", "..");
const DEFAULT_REPO_SLUG = "MrAili87/Copilot-tailspin";

function getWorkspacePath(session) {
    return session.workspacePath || PROJECT_ROOT_FROM_EXTENSION;
}

function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function summarizeBody(body) {
    const text = (body || "").replace(/\s+/g, " ").trim();
    if (!text) return "No description provided.";
    if (text.length <= 220) return text;
    return `${text.slice(0, 217)}...`;
}

function hoursSince(updatedAt) {
    const ms = Date.now() - new Date(updatedAt).getTime();
    return Math.max(0, Math.round(ms / (1000 * 60 * 60)));
}

function scoreIssue(issue) {
    const labels = issue.labels.map((l) => l.name.toLowerCase());
    let score = 0;

    if (labels.some((l) => /critical|blocker|urgent|p0|high/.test(l))) score += 140;
    if (labels.some((l) => /bug|regression|security|incident|outage/.test(l))) score += 120;
    if (labels.some((l) => /help wanted|good first issue|question/.test(l))) score -= 20;

    const recentHours = hoursSince(issue.updatedAt);
    if (recentHours <= 6) score += 60;
    else if (recentHours <= 24) score += 45;
    else if (recentHours <= 72) score += 25;
    else if (recentHours <= 168) score += 10;

    if (!issue.assignees?.length) score += 35;
    score += Math.min(25, (issue.comments?.totalCount || 0) * 4);
    return score;
}

function topReason(issue) {
    const labels = issue.labels.map((l) => l.name).join(", ");
    const reasons = [];
    const updatedHours = hoursSince(issue.updatedAt);

    if (labels) reasons.push(`labels: ${labels}`);
    if (updatedHours <= 24) reasons.push(`updated ${updatedHours}h ago`);
    else reasons.push(`updated ${Math.round(updatedHours / 24)}d ago`);
    if (!issue.assignees?.length) reasons.push("currently unassigned");
    if ((issue.comments?.totalCount || 0) > 0) reasons.push(`${issue.comments.totalCount} comment(s)`);

    return reasons.length > 0
        ? reasons.join("; ")
        : "triaged as high-priority based on recency and issue metadata";
}

async function detectRepo(workspacePath) {
    let slug = "";
    try {
        const result = await execFileAsync(
            "gh",
            ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
            { cwd: workspacePath },
        );
        slug = result.stdout.trim();
    } catch {
        slug = process.env.GITHUB_REPOSITORY || DEFAULT_REPO_SLUG;
    }
    const [owner, repo] = slug.split("/");
    if (!owner || !repo) {
        throw new Error("Could not determine repository from gh repo view.");
    }
    return { owner, repo, slug };
}

async function loadIssues(workspacePath) {
    const repo = await detectRepo(workspacePath);
    const { stdout } = await execFileAsync(
        "gh",
        [
            "issue",
            "list",
            "--repo",
            repo.slug,
            "--state",
            "open",
            "--limit",
            "60",
            "--json",
            "number,title,body,labels,updatedAt,url,assignees,comments",
        ],
        { cwd: workspacePath },
    );
    const issues = JSON.parse(stdout);
    const ranked = issues
        .map((issue) => ({ ...issue, _score: scoreIssue(issue), _summary: summarizeBody(issue.body), _reason: topReason(issue) }))
        .sort((a, b) => b._score - a._score);
    return { repo, ranked };
}

function renderIssueCard(issue, emphasize) {
    const labels = issue.labels.length
        ? issue.labels.map((l) => `<span class="tag">${escapeHtml(l.name)}</span>`).join("")
        : '<span class="muted">No labels</span>';
    const why = emphasize
        ? `<p class="why"><strong>Why this is in the top 3:</strong> ${escapeHtml(issue._reason)}</p>`
        : "";
    return `
<article class="card">
  <div class="card-head">
    <h3><a href="${escapeHtml(issue.url)}" target="_blank" rel="noopener noreferrer">#${issue.number} ${escapeHtml(issue.title)}</a></h3>
    <button data-issue-number="${issue.number}" data-issue-title="${escapeHtml(issue.title)}">Add to current context</button>
  </div>
  <p class="desc">${escapeHtml(issue._summary)}</p>
  ${why}
  <div class="meta">
    ${labels}
  </div>
</article>`;
}

function renderHtml(model) {
    const top = model.top.length
        ? model.top.map((issue) => renderIssueCard(issue, true)).join("\n")
        : '<p class="empty">No open issues found.</p>';
    const rest = model.rest.length
        ? model.rest.map((issue) => renderIssueCard(issue, false)).join("\n")
        : '<p class="empty">No remaining issues.</p>';

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Issue Triage Board</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        margin: 0;
        font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        background: var(--background-color-default, #0f172a);
        color: var(--text-color-default, #e2e8f0);
      }
      .wrap { max-width: 1080px; margin: 0 auto; padding: 18px; }
      h1 { margin: 0 0 8px 0; font-size: 22px; }
      p.sub { margin: 0 0 16px 0; color: var(--text-color-muted, #94a3b8); }
      section { margin-bottom: 22px; }
      h2 { margin: 0 0 10px 0; font-size: 16px; }
      .grid { display: grid; gap: 10px; }
      .card {
        border: 1px solid var(--border-color-default, #334155);
        border-radius: 10px;
        background: color-mix(in srgb, var(--background-color-default, #0f172a) 80%, #1e293b);
        padding: 12px;
      }
      .card-head { display: flex; gap: 10px; justify-content: space-between; align-items: flex-start; }
      .card h3 { margin: 0; font-size: 15px; line-height: 1.4; }
      .card a { color: #60a5fa; text-decoration: none; }
      .card a:hover { text-decoration: underline; }
      .desc { margin: 8px 0; color: var(--text-color-muted, #94a3b8); font-size: 13px; line-height: 1.45; }
      .why { margin: 8px 0; font-size: 13px; color: #cbd5e1; }
      .meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .tag { padding: 2px 8px; border-radius: 999px; border: 1px solid #475569; font-size: 11px; color: #cbd5e1; }
      button {
        border: 1px solid #3b82f6;
        color: #e2e8f0;
        background: #1d4ed8;
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
      }
      button:hover { background: #2563eb; }
      button:focus { outline: 2px solid var(--color-focus-outline, #60a5fa); outline-offset: 2px; }
      .toolbar { display: flex; justify-content: space-between; gap: 8px; margin: 10px 0 16px; }
      .status { font-size: 12px; color: var(--text-color-muted, #94a3b8); min-height: 16px; }
      .empty, .muted { color: var(--text-color-muted, #94a3b8); }
    </style>
  </head>
  <body>
    <main class="wrap">
      <h1>Issue triage board</h1>
      <p class="sub">${escapeHtml(model.repo.slug)} - ${model.total} open issue(s)</p>
      <div class="toolbar">
        <button id="refresh" type="button">Refresh board</button>
        <div id="status" class="status" role="status" aria-live="polite"></div>
      </div>
      <section>
        <h2>Needs attention now (top 3)</h2>
        <div class="grid">${top}</div>
      </section>
      <section>
        <h2>Remaining open issues</h2>
        <div class="grid">${rest}</div>
      </section>
    </main>
    <script>
      const statusEl = document.getElementById('status');
      function setStatus(text) { statusEl.textContent = text; }
      async function addToContext(number, title) {
        setStatus('Adding issue #' + number + ' to current context...');
        const response = await fetch('/api/add-to-context', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ number, title }),
        });
        if (!response.ok) {
          setStatus('Failed to add issue #' + number + ' to context.');
          return;
        }
        setStatus('Issue #' + number + ' added to current context.');
      }
      document.querySelectorAll('button[data-issue-number]').forEach((btn) => {
        btn.addEventListener('click', () => addToContext(btn.dataset.issueNumber, btn.dataset.issueTitle));
      });
      document.getElementById('refresh').addEventListener('click', () => window.location.reload());
    </script>
  </body>
</html>`;
}

async function addIssueToContext(session, instanceId, issueNumber) {
    const model = instanceData.get(instanceId);
    if (!model) throw new CanvasError("canvas_state_missing", "No issue data loaded for this canvas instance.");
    const issue = model.ranked.find((candidate) => String(candidate.number) === String(issueNumber));
    if (!issue) throw new CanvasError("issue_not_found", `Issue #${issueNumber} was not found in the current board.`);

    const labels = issue.labels.map((label) => label.name).join(", ");
    const prompt = [
        `Please add this issue to the active working context and prepare to implement it:`,
        `Issue: #${issue.number} - ${issue.title}`,
        `Repository: ${model.repo.slug}`,
        labels ? `Labels: ${labels}` : "Labels: none",
        `URL: ${issue.url}`,
        `Summary: ${issue._summary}`,
    ].join("\n");
    await session.send(prompt, { mode: "interactive" });
}

async function startServer(session, instanceId, workspacePath) {
    const model = await loadIssues(workspacePath);
    instanceData.set(instanceId, model);

    const server = createServer(async (req, res) => {
        if (req.method === "POST" && req.url === "/api/add-to-context") {
            let raw = "";
            req.on("data", (chunk) => {
                raw += chunk;
            });
            req.on("end", async () => {
                try {
                    const payload = JSON.parse(raw || "{}");
                    await addIssueToContext(session, instanceId, payload.number);
                    res.statusCode = 200;
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify({ ok: true }));
                } catch (error) {
                    res.statusCode = 400;
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
                }
            });
            return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        const latestModel = instanceData.get(instanceId);
        if (!latestModel) {
            res.end("<!doctype html><p>No board data available.</p>");
            return;
        }
        const top = latestModel.ranked.slice(0, 3);
        const rest = latestModel.ranked.slice(3);
        res.end(
            renderHtml({
                repo: latestModel.repo,
                total: latestModel.ranked.length,
                top,
                rest,
            }),
        );
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "triage-kanban",
            displayName: "Issue triage board",
            description: "Kanban-style issue board with top 3 priorities and one-click add-to-context buttons.",
            actions: [
                {
                    name: "refresh_board",
                    description: "Refresh issue data from GitHub for this board instance.",
                    handler: async (ctx) => {
                        const workspacePath = getWorkspacePath(session);
                        const model = await loadIssues(workspacePath);
                        instanceData.set(ctx.instanceId, model);
                        return { refreshed: true, issueCount: model.ranked.length };
                    },
                },
                {
                    name: "add_issue_to_context",
                    description: "Send an issue into the current chat context.",
                    inputSchema: {
                        type: "object",
                        required: ["issueNumber"],
                        properties: {
                            issueNumber: { type: "number" },
                        },
                    },
                    handler: async (ctx) => {
                        const issueNumber = Number(ctx.input?.issueNumber);
                        if (!Number.isFinite(issueNumber)) {
                            throw new CanvasError("invalid_input", "issueNumber must be a number.");
                        }
                        await addIssueToContext(session, ctx.instanceId, issueNumber);
                        return { added: true, issueNumber };
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    const workspacePath = getWorkspacePath(session);
                    entry = await startServer(session, ctx.instanceId, workspacePath);
                    servers.set(ctx.instanceId, entry);
                }
                const model = instanceData.get(ctx.instanceId);
                return {
                    title: "Issue triage board",
                    status: model ? `${model.ranked.length} open issue(s)` : "Loading issues",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    instanceData.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
