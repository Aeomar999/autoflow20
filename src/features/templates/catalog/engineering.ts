import type { TemplateSpec } from "./types";

/**
 * Engineering & DevOps reference automations (AF-M10-26, source #18–#20).
 *
 * All three read a commit message as a small command language, which is what
 * makes them one family rather than three GitHub templates: the parsing is the
 * same shape each time, and the difference is what happens next.
 *
 * Jira is always transitioned **by name**. AF-M10-18 built `JIRA_TRANSITION`
 * that way for exactly this reason — a shipped template cannot know a
 * project's status ids, and a template carrying somebody else's ids fails on
 * install with a 400 that names nothing useful.
 */
export const engineeringTemplates: TemplateSpec[] = [
  {
    slug: "multi-repo-pr-and-jira",
    name: "One workflow, every repo: PRs and Jira from commit commands",
    description:
      "Reference automation #18. Watches pushes across several repositories, reads each commit message for a command and a Jira key, opens the pull request, moves the ticket, and tells the team in Slack and Notion. The repository routing decides only what differs per repo — the base branch to open against and the channel to announce in — and then every repo runs the same single PR, transition and notification chain. PREREQUISITES: a GitHub webhook per repository pointing at this workflow's trigger URL, a GitHub credential with pull-request write, a Jira credential with issue-transition permission, a Slack credential, and a Notion integration token with the target database shared to it. Commit messages must carry a Jira key and a command, e.g. \"PROJ-123 [auto-pr] fix the login redirect\". DEVIATIONS FROM THE SOURCE: the source lists a JIRA status-ID mapping as a prerequisite; there is none here, because transitions are resolved by name against the issue's own workflow at run time, so this template works on a project whose ids differ without being edited. The SWITCH routes on repository name only to set per-repo values; the PR, the transition and the notification exist once and serve every repo. The source duplicates that branch per repository, which is the same behaviour written three times and drifting after the first edit. The Jira project is not among the routed values, deliberately — the key in the commit message already names it, and a second copy in config is one that goes stale.",
    category: "Ops",
    domain: "ops",
    // GitHub, Jira, Slack, Notion.
    tier: "library",
    tags: ["github", "jira", "slack", "notion", "pull-request", "devops"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "pushed",
          type: "GITHUB_TRIGGER",
          name: "Push to any watched repo",
          position: { x: 0, y: 0 },
          data: {
            // No `repo` filter: one workflow, many webhooks, and the payload
            // says which repository it came from.
            events: "push",
          },
        },
        {
          id: "parse",
          type: "CODE",
          name: "Read the commit command",
          position: { x: 260, y: 0 },
          data: {
            code: 'const commits = input.github?.payload?.commits ?? [];\nconst repository = input.github?.repository ?? "";\n\n// The LAST commit carrying a command wins. A push can contain several, and\n// acting on all of them opens three pull requests for one push.\nlet found = null;\n\nfor (const commit of commits) {\n  const message = String(commit.message ?? "");\n  const key = message.match(/\\b([A-Z][A-Z0-9]+-\\d+)\\b/);\n  const command = message.match(/\\[(auto-pr|taskcompleted)\\]/i);\n  if (!key || !command) continue;\n\n  found = {\n    issueKey: key[1],\n    command: command[1].toLowerCase(),\n    // The first line, which is the commit subject and the only part worth\n    // putting in a PR title.\n    subject: message.split("\\n")[0].trim().slice(0, 200),\n    sha: String(commit.id ?? commit.sha ?? ""),\n    author: commit.author?.name ?? "",\n  };\n}\n\nconst branch = String(input.github?.payload?.ref ?? "").replace(\n  /^refs\\/heads\\//,\n  "",\n);\n\nreturn {\n  matched: found !== null,\n  repository,\n  branch,\n  issueKey: found?.issueKey ?? "",\n  command: found?.command ?? "",\n  subject: found?.subject ?? "",\n  sha: found?.sha ?? "",\n  author: found?.author ?? "",\n};\n',
          },
        },
        {
          id: "commanded",
          type: "CONDITION",
          name: "Was there a command?",
          position: { x: 520, y: 0 },
          data: {
            // Most pushes are ordinary. Stopping here keeps the run cheap and
            // the trace honest about why nothing happened.
            left: "{{matched}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "which-repo",
          type: "SWITCH",
          name: "Which repository?",
          position: { x: 800, y: 0 },
          data: {
            // Routing decides the two things that genuinely differ per repo.
            // Everything after the merge is one copy, so a change to how PRs
            // are opened is a change in one place.
            rules: [
              {
                outputKey: "api",
                left: "{{repository}}",
                operator: "contains",
                right: "REPLACE_WITH_API_REPO_NAME",
              },
              {
                outputKey: "web",
                left: "{{repository}}",
                operator: "contains",
                right: "REPLACE_WITH_WEB_REPO_NAME",
              },
            ],
            fallback: "extra",
          },
        },
        {
          id: "api-settings",
          type: "SET",
          name: "API repo settings",
          position: { x: 1080, y: -140 },
          data: {
            mappings: [
              { key: "baseBranch", value: "main" },
              { key: "notifyChannel", value: "#api-team" },
            ],
          },
        },
        {
          id: "web-settings",
          type: "SET",
          name: "Web repo settings",
          position: { x: 1080, y: 0 },
          data: {
            mappings: [
              { key: "baseBranch", value: "develop" },
              { key: "notifyChannel", value: "#web-team" },
            ],
          },
        },
        {
          id: "default-settings",
          type: "SET",
          name: "Anything else",
          position: { x: 1080, y: 140 },
          data: {
            // The unmatched port is wired deliberately. A new repository added
            // to the webhook list should still get a PR against main and land
            // somewhere visible, not fall off the end of the graph silently.
            mappings: [
              { key: "baseBranch", value: "main" },
              { key: "notifyChannel", value: "#engineering" },
            ],
          },
        },
        {
          id: "wants-pr",
          type: "CONDITION",
          name: "A PR, or a transition?",
          position: { x: 1360, y: 0 },
          data: {
            left: "{{command}}",
            operator: "equals",
            right: "auto-pr",
          },
        },
        {
          id: "pull-request",
          type: "GITHUB_CREATE_PR",
          name: "Open the pull request",
          position: { x: 1640, y: -100 },
          data: {
            variableName: "pr",
            // The repository comes from the payload, so this node serves every
            // watched repo — the reason the routing above sets values rather
            // than duplicating this box.
            repo: "{{repository}}",
            title: "{{issueKey}} {{subject}}",
            head: "{{branch}}",
            base: "{{baseBranch}}",
            body: "Opened automatically from a commit command.\n\n- Commit: `{{sha}}`\n- Author: {{author}}\n- Ticket: {{issueKey}}",
          },
        },
        {
          id: "move-ticket",
          type: "JIRA_TRANSITION",
          name: "Move the ticket",
          position: { x: 1640, y: 120 },
          data: {
            variableName: "moved",
            issueKey: "{{issueKey}}",
            // By NAME, resolved against the issue's own workflow at run time.
            // A status id here would be this workspace's id and nobody else's.
            transition: "Done",
            comment: "Closed by commit {{sha}} in {{repository}}.",
          },
        },
        {
          id: "tell-slack",
          type: "SLACK_POST",
          name: "Tell the team",
          position: { x: 1940, y: 0 },
          data: {
            variableName: "posted",
            // Set by the routing above, which is the second thing that differs
            // per repository and the reason the SWITCH earns its place.
            channel: "{{notifyChannel}}",
            text: "*{{repository}}* — {{issueKey}}\n{{subject}}\nCommand `{{command}}` from {{author}} on `{{branch}}`.",
          },
        },
        {
          id: "log-notion",
          type: "NOTION_CREATE_PAGE",
          name: "Log it in Notion",
          position: { x: 2220, y: 0 },
          data: {
            variableName: "logged",
            databaseId: "REPLACE_WITH_NOTION_DATABASE_ID",
            properties:
              '{"Name": "{{issueKey}} {{subject}}", "Repository": "{{repository}}", "Command": "{{command}}", "Author": "{{author}}", "Commit": "{{sha}}"}',
          },
        },
      ],
      edges: [
        { source: "pushed", target: "parse" },
        { source: "parse", target: "commanded" },
        { source: "commanded", target: "which-repo", sourceHandle: "true" },
        { source: "which-repo", target: "api-settings", sourceHandle: "api" },
        { source: "which-repo", target: "web-settings", sourceHandle: "web" },
        {
          source: "which-repo",
          target: "default-settings",
          sourceHandle: "extra",
        },
        { source: "api-settings", target: "wants-pr" },
        { source: "web-settings", target: "wants-pr" },
        { source: "default-settings", target: "wants-pr" },
        { source: "wants-pr", target: "pull-request", sourceHandle: "true" },
        { source: "wants-pr", target: "move-ticket", sourceHandle: "false" },
        { source: "pull-request", target: "tell-slack" },
        { source: "move-ticket", target: "tell-slack" },
        { source: "tell-slack", target: "log-notion" },
      ],
    },
  },
  {
    slug: "single-repo-pr-and-jira",
    name: "Commit commands for one repository",
    description:
      'Reference automation #19. The lighter half of the multi-repo version, for a team working out of one codebase: a push arrives, the commit message is read for a Jira key and a command, and `[auto-pr]` opens the pull request while `[taskcompleted]` moves the ticket to Done. No routing, no notification fan-out — two credentials and two outcomes. PREREQUISITES: admin on the repository so you can add the webhook, a GitHub credential with pull-request write, and a Jira Cloud credential with permission to transition issues. Commit format: "PROJ-123 [auto-pr] short description". DEVIATIONS FROM THE SOURCE: none in behaviour. The transition is named rather than given as an id, so this installs against any project without a status-ID mapping step.',
    category: "Ops",
    domain: "ops",
    // GitHub and Jira. Nothing else.
    tier: "library",
    tags: ["github", "jira", "pull-request", "commit", "devops", "ticket"],
    graph: {
      nodes: [
        {
          id: "pushed",
          type: "GITHUB_TRIGGER",
          name: "Push to the repo",
          position: { x: 0, y: 0 },
          data: {
            repo: "REPLACE_WITH_OWNER_SLASH_REPO",
            events: "push",
          },
        },
        {
          id: "parse",
          type: "CODE",
          name: "Read the commit command",
          position: { x: 280, y: 0 },
          data: {
            code: 'const commits = input.github?.payload?.commits ?? [];\n\n// Last command in the push wins: acting on every commit in a five-commit\n// push would open five pull requests for one branch.\nlet found = null;\n\nfor (const commit of commits) {\n  const message = String(commit.message ?? "");\n  const key = message.match(/\\b([A-Z][A-Z0-9]+-\\d+)\\b/);\n  const command = message.match(/\\[(auto-pr|taskcompleted)\\]/i);\n  if (!key || !command) continue;\n\n  found = {\n    issueKey: key[1],\n    command: command[1].toLowerCase(),\n    subject: message.split("\\n")[0].trim().slice(0, 200),\n    sha: String(commit.id ?? commit.sha ?? ""),\n  };\n}\n\nreturn {\n  matched: found !== null,\n  issueKey: found?.issueKey ?? "",\n  command: found?.command ?? "",\n  subject: found?.subject ?? "",\n  sha: found?.sha ?? "",\n  branch: String(input.github?.payload?.ref ?? "").replace(\n    /^refs\\/heads\\//,\n    "",\n  ),\n};\n',
          },
        },
        {
          id: "commanded",
          type: "CONDITION",
          name: "Was there a command?",
          position: { x: 560, y: 0 },
          data: {
            left: "{{matched}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "wants-pr",
          type: "CONDITION",
          name: "A PR, or a transition?",
          position: { x: 840, y: 0 },
          data: {
            left: "{{command}}",
            operator: "equals",
            right: "auto-pr",
          },
        },
        {
          id: "pull-request",
          type: "GITHUB_CREATE_PR",
          name: "Open the pull request",
          position: { x: 1120, y: -100 },
          data: {
            variableName: "pr",
            repo: "REPLACE_WITH_OWNER_SLASH_REPO",
            title: "{{issueKey}} {{subject}}",
            head: "{{branch}}",
            base: "main",
            body: "Opened automatically from commit `{{sha}}`.\n\nTicket: {{issueKey}}",
          },
        },
        {
          id: "move-ticket",
          type: "JIRA_TRANSITION",
          name: "Move the ticket to Done",
          position: { x: 1120, y: 100 },
          data: {
            variableName: "moved",
            issueKey: "{{issueKey}}",
            transition: "Done",
            comment: "Closed by commit {{sha}}.",
          },
        },
      ],
      edges: [
        { source: "pushed", target: "parse" },
        { source: "parse", target: "commanded" },
        { source: "commanded", target: "wants-pr", sourceHandle: "true" },
        { source: "wants-pr", target: "pull-request", sourceHandle: "true" },
        { source: "wants-pr", target: "move-ticket", sourceHandle: "false" },
      ],
    },
  },
  {
    slug: "release-notes-from-commits",
    name: "Release notes a stakeholder can read",
    description:
      "Reference automation #20. Collects the week's commits, pulls the Jira tickets their messages reference, and has a model write release notes from both — the commit says what changed, the ticket says why it mattered, and notes written from either alone read like a changelog or a wish list. The draft is emailed to a stakeholder list. PREREQUISITES: GitHub, Jira and SMTP credentials, plus an AI provider key if you are not using the platform's. Commit messages must contain a Jira key, e.g. \"PROJ-123: Fix login bug\" — commits without one still appear, under a heading that says they had no ticket, because silently dropping them makes the notes wrong rather than short. DEVIATIONS FROM THE SOURCE: the source triggers on every push. On an active repository that is an email per commit, which is a commit feed rather than release notes, so this runs weekly instead and gathers the commits since the last run. To match the source exactly, replace the schedule with a GitHub trigger on `release` — which is the event release notes actually describe.",
    category: "Ops",
    domain: "ops",
    // GitHub, Jira and SMTP. The model key is optional.
    tier: "library",
    tags: ["release-notes", "github", "jira", "gemini", "email", "devops"],
    graph: {
      nodes: [
        {
          id: "weekly",
          type: "SCHEDULE_TRIGGER",
          name: "Weekly",
          position: { x: 0, y: 0 },
          data: { cron: "0 16 * * 5", timezone: "UTC" },
        },
        {
          id: "window",
          type: "CODE",
          name: "The week just gone",
          position: { x: 260, y: 0 },
          data: {
            code: "// GitHub's `since` is an ISO timestamp, so the window is computed here\n// rather than being a fixed date somebody has to remember to move.\nconst since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);\n\nreturn {\n  since: since.toISOString(),\n  windowLabel: `${since.toISOString().slice(0, 10)} to ${new Date().toISOString().slice(0, 10)}`,\n};\n",
          },
        },
        {
          id: "commits",
          type: "GITHUB_LIST_COMMITS",
          name: "Collect the commits",
          position: { x: 520, y: 0 },
          data: {
            variableName: "commits",
            repo: "REPLACE_WITH_OWNER_SLASH_REPO",
            ref: "main",
            since: "{{since}}",
            limit: 200,
          },
        },
        {
          id: "keys",
          type: "CODE",
          name: "Find the ticket keys",
          position: { x: 780, y: 0 },
          data: {
            code: 'const commits = input.commits?.commits ?? input.commits?.items ?? [];\n\nconst keys = new Set();\nconst withTicket = [];\nconst withoutTicket = [];\n\nfor (const commit of commits) {\n  const message = String(commit.message ?? commit.commit?.message ?? "");\n  const subject = message.split("\\n")[0].trim();\n  const match = subject.match(/\\b([A-Z][A-Z0-9]+-\\d+)\\b/);\n\n  if (match) {\n    keys.add(match[1]);\n    withTicket.push({ subject, key: match[1] });\n  } else {\n    // Kept, not dropped. Notes that quietly omit half the week are worse\n    // than notes that say some commits had no ticket.\n    withoutTicket.push({ subject });\n  }\n}\n\nconst list = [...keys];\n\nreturn {\n  keyList: list,\n  // JQL wants a quoted, comma-separated set. An empty set would make the\n  // query invalid, so a key that cannot exist stands in for "none".\n  jql: `key in (${list.length ? list.join(",") : "NONE-0"})`,\n  withTicket,\n  withoutTicket,\n  commitCount: commits.length,\n};\n',
          },
        },
        {
          id: "tickets",
          type: "JIRA_SEARCH",
          name: "Pull the tickets",
          position: { x: 1040, y: 0 },
          data: {
            variableName: "tickets",
            jql: "{{jql}}",
            limit: 200,
          },
        },
        {
          id: "draft",
          type: "AI_LLM",
          name: "Draft the notes",
          position: { x: 1300, y: 0 },
          data: {
            variableName: "notes",
            model: "google:gemini-3.6-flash",
            fallbackModels: "openai:gpt-4o",
            systemPrompt:
              "You write release notes for people who do not read code. Group by what changed for the user, not by component. Say what each change lets someone do now that they could not before. Never invent a change that is not in the input. End with a short section titled 'Changes without a ticket' listing those commit subjects verbatim, or omit the section if there are none. Plain text, no code blocks.",
            userPrompt:
              "Period: {{windowLabel}}\n{{commitCount}} commits.\n\nCommits with tickets:\n{{{json withTicket}}}\n\nTickets:\n{{{json tickets.issues}}}\n\nCommits without tickets:\n{{{json withoutTicket}}}",
            temperature: 0.4,
            maxTokens: 2000,
          },
        },
        {
          id: "send",
          type: "EMAIL_SEND",
          name: "Email the stakeholders",
          position: { x: 1560, y: 0 },
          data: {
            variableName: "sent",
            from: "releases@example.com",
            fromName: "Release notes",
            to: "REPLACE_WITH_RECIPIENT_LIST",
            subject: "Release notes — {{windowLabel}}",
            body: "{{notes.text}}",
          },
        },
      ],
      edges: [
        { source: "weekly", target: "window" },
        { source: "window", target: "commits" },
        { source: "commits", target: "keys" },
        { source: "keys", target: "tickets" },
        { source: "tickets", target: "draft" },
        { source: "draft", target: "send" },
      ],
    },
  },
];
