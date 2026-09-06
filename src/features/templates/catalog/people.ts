import type { TemplateSpec } from "./types";

/**
 * People-team templates (AF-M11-03).
 *
 * `Ops` gallery entries demonstrating the people node family: every graph is a
 * trigger-anchored chain over the `people/*` registry nodes, and none of them
 * require a credential at install time (the AI summaries treat their provider
 * keys as optional).
 *
 * The four PHASE templates — `screen-score-approve-and-hire` (W1),
 * `onboard-new-hire` (W2), `tenure-check-ins` (W3) and
 * `offboard-employee-lifecycle` (W4) — deliberately share one demo subject
 * and one `employeeRef` (AF-M11-12). Installing all four and pressing Run in
 * order walks a single `Employee` row through the whole chain from the
 * editor, with no ATS and no hand-editing between phases; `lifecycle-chain.test.ts`
 * pins that, so a payload edit that breaks the chain fails the build.
 */
export const peopleTemplates: TemplateSpec[] = [
  {
    slug: "offboard-departing-employee",
    name: "Offboard a departing employee",
    description:
      "Walks an exit for a departing employee — captures honest feedback in a structured interview, then hands the people team a dated checklist of the accounts, hardware, and handover steps to close before the last day. Supply the departure details at the trigger and every task lands with an owner and a due date.",
    category: "Ops",
    domain: "ops",
    tags: [
      "offboarding",
      "exit interview",
      "checklist",
      "hr",
      "departure",
      "handover",
    ],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Departing employee",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"employeeName":"Ada Lovelace","roleTitle":"Backend Engineer","departureDate":"2026-09-30","managerName":"Grace Hopper","notes":"Relocating to a different city"}',
          },
        },
        {
          id: "exit-interview",
          type: "EXIT_INTERVIEW",
          name: "Plan the exit interview",
          position: { x: 260, y: 0 },
          data: {
            variableName: "exitInterview",
            employeeName: "{{employeeName}}",
            departureDate: "{{departureDate}}",
            interviewer: "{{managerName}}",
            format: "video",
            focusAreas: [
              { area: "What would have kept you here?" },
              { area: "Feedback on the team and culture" },
              { area: "Knowledge and handover concerns" },
            ],
          },
        },
        {
          id: "offboarding",
          type: "OFFBOARDING_CHECKLIST",
          name: "Build the offboarding checklist",
          position: { x: 520, y: 0 },
          data: {
            variableName: "offboarding",
            roleTitle: "{{roleTitle}}",
            items: [
              {
                key: "handover",
                label: "Document knowledge and handover notes",
                owner: "{{managerName}}",
                dueOffsetDays: 0,
              },
              {
                key: "laptop_return",
                label: "Return laptop, badge and keys",
                owner: "IT Admin",
                dueOffsetDays: 1,
              },
              {
                key: "payroll_final",
                label: "Confirm final payroll and benefits",
                owner: "People Ops",
                dueOffsetDays: 2,
              },
              {
                key: "accounts_off",
                label: "Deactivate email and SaaS accounts",
                owner: "IT Admin",
                dueOffsetDays: 3,
              },
              {
                key: "exit_followup",
                label: "Close the exit interview and archive feedback",
                owner: "People Ops",
                dueOffsetDays: 7,
              },
            ],
          },
        },
      ],
      edges: [
        { source: "start", target: "exit-interview" },
        { source: "exit-interview", target: "offboarding" },
      ],
    },
  },
  {
    slug: "new-hire-onboarding-plan",
    name: "Plan a new hire's onboarding",
    description:
      "Turns the first weeks of a new hire into a concrete plan — an owner-and-due-date onboarding checklist, a timed orientation agenda, and the benefits enrollment they need inside thirty days. Supply the start details once at the trigger and every step is delegated.",
    category: "Ops",
    domain: "ops",
    tags: [
      "onboarding",
      "checklist",
      "orientation",
      "benefits",
      "new hire",
      "hr",
    ],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "New hire details",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"newHireName":"Alan Turing","roleTitle":"ML Engineer","startDate":"2026-10-05","buddyName":"Emmy Noether","workLocation":"London office"}',
          },
        },
        {
          id: "onboarding",
          type: "ONBOARDING_CHECKLIST",
          name: "Build the onboarding checklist",
          position: { x: 260, y: 0 },
          data: {
            variableName: "onboarding",
            roleTitle: "{{roleTitle}}",
            items: [
              {
                key: "accounts",
                label: "Provision accounts and permissions",
                owner: "IT Admin",
                dueOffsetDays: 0,
              },
              {
                key: "hardware",
                label: "Order laptop and accessories",
                owner: "IT Admin",
                dueOffsetDays: 0,
              },
              {
                key: "buddy",
                label: "Assign an onboarding buddy",
                owner: "{{buddyName}}",
                dueOffsetDays: 1,
              },
              {
                key: "day_one",
                label: "Confirm the day-one agenda and desk",
                owner: "People Ops",
                dueOffsetDays: 1,
              },
              {
                key: "thirty_day",
                label: "Hold the 30-day check-in",
                owner: "Hiring Manager",
                dueOffsetDays: 30,
              },
            ],
          },
        },
        {
          id: "orientation",
          type: "ORIENTATION",
          name: "Build the orientation session",
          position: { x: 520, y: 0 },
          data: {
            variableName: "orientation",
            sessionName: "{{newHireName}} orientation",
            startDate: "{{startDate}}",
            locationOrMode: "{{workLocation}}",
            durationMinutes: 120,
            agendaItems: [
              {
                time: "09:00",
                topic: "Welcome and team introductions",
                owner: "{{buddyName}}",
              },
              {
                time: "10:00",
                topic: "Security and compliance walkthrough",
                owner: "IT Admin",
              },
              {
                time: "11:00",
                topic: "Product, roadmap and customers",
                owner: "Hiring Manager",
              },
            ],
          },
        },
        {
          id: "benefits",
          type: "BENEFITS_ENROLLMENT",
          name: "Open benefits enrollment",
          position: { x: 780, y: 0 },
          data: {
            variableName: "benefits",
            employeeName: "{{newHireName}}",
            plan: "medical",
            dependentsCount: 0,
            notes:
              "Enroll within 30 days of the start date; review the family plan at the 30-day check-in.",
          },
        },
      ],
      edges: [
        { source: "start", target: "onboarding" },
        { source: "onboarding", target: "orientation" },
        { source: "orientation", target: "benefits" },
      ],
    },
  },
  {
    slug: "shortlist-review-and-offer",
    name: "Screen a shortlist and draft the offer",
    description:
      "Scores a candidate shortlist against a weighted rubric, books the frontrunner for their final interview, then drafts the offer letter — so screening, scheduling, and the offer stay one run away from a signed hire.",
    category: "Ops",
    domain: "ops",
    tags: ["hiring", "screening", "rubric", "offer", "interview", "candidates"],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Shortlist inputs",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"candidates":[{"name":"Grace Hopper","title":"Backend Engineer"},{"name":"Ada Lovelace","title":"Backend Engineer"},{"name":"Radia Perlman","title":"Backend Engineer"}],"companyName":"Acme","roleTitle":"Backend Engineer","candidateName":"Ada Lovelace","candidateEmail":"ada@example.com","startDate":"2026-10-19","workLocation":"Remote","compensationText":"$180,000 base, 0.2% equity, and a $15,000 sign-on"}',
          },
        },
        {
          id: "ranking",
          type: "CANDIDATE_SCORE_RANK",
          name: "Score and rank the shortlist",
          position: { x: 260, y: 0 },
          data: {
            variableName: "ranked",
            candidatesJson: "{{{json candidates}}}",
            rubric: [
              { key: "experience", label: "Relevant experience", weight: 0.4 },
              { key: "technical", label: "Technical assessment", weight: 0.3 },
              { key: "culture", label: "Culture and values fit", weight: 0.2 },
              {
                key: "availability",
                label: "Start date availability",
                weight: 0.1,
              },
            ],
          },
        },
        {
          id: "booking",
          type: "CANDIDATE_SCHEDULE",
          name: "Book the final interview",
          position: { x: 520, y: 0 },
          data: {
            variableName: "booking",
            candidateName: "{{candidateName}}",
            candidateEmail: "{{candidateEmail}}",
            interviewType: "final",
            bookingUrlTemplate: "https://cal.com/acme/final-round",
          },
        },
        {
          id: "offer",
          type: "OFFER_LETTER",
          name: "Draft the offer letter",
          position: { x: 780, y: 0 },
          data: {
            variableName: "offerLetter",
            companyName: "{{companyName}}",
            roleTitle: "{{roleTitle}}",
            candidateName: "{{candidateName}}",
            startDate: "{{startDate}}",
            workLocation: "{{workLocation}}",
            compensationText: "{{compensationText}}",
            employmentType: "full_time",
            extraTerms:
              "Offer is valid for 10 business days and contingent on a cleared background check.",
          },
        },
      ],
      edges: [
        { source: "start", target: "ranking" },
        { source: "ranking", target: "booking" },
        { source: "booking", target: "offer" },
      ],
    },
  },
  {
    slug: "run-candidate-background-check",
    name: "Run a candidate background check",
    description:
      "Starts a background screening request for a shortlisted candidate and keeps the request reference on the run context, so screening progress can route a condition or feed an audit log further down the workflow.",
    category: "Ops",
    domain: "ops",
    tags: [
      "background check",
      "screening",
      "compliance",
      "candidate",
      "vetting",
    ],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Candidate for screening",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"candidateName":"Margaret Hamilton","candidateEmail":"margaret@example.com","checkType":"enhanced","notes":"Verify employment history and references before the offer expires"}',
          },
        },
        {
          id: "vetting",
          type: "BACKGROUND_CHECK",
          name: "Request the background check",
          position: { x: 260, y: 0 },
          data: {
            variableName: "vetting",
            candidateName: "{{candidateName}}",
            candidateEmail: "{{candidateEmail}}",
            checkType: "enhanced",
            notes: "{{notes}}",
          },
        },
      ],
      edges: [{ source: "start", target: "vetting" }],
    },
  },
  {
    slug: "employee-illness-briefing",
    name: "Brief a manager on sick leave",
    description:
      "Turns a sick-leave note into a one-screen briefing for the manager — expected return, the condition in one neutral line, any reasonable adjustments, and suggested cover — so absent plans are made from the same facts everyone sees.",
    category: "Ops",
    domain: "ops",
    tags: ["illness", "sick leave", "absence", "ai", "briefing", "hr"],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Sick-leave note",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"employeeName":"Katherine Johnson","managerName":"Dorothy Vaughan","absentFrom":"2026-09-21","absentTo":"2026-09-28","notes":"Recovering from surgery; signed off through the 28th; can take short video calls from home"}',
          },
        },
        {
          id: "summarize",
          type: "ILLNESS_SUMMARY",
          name: "Summarize the leave note",
          position: { x: 260, y: 0 },
          data: {
            variableName: "briefing",
            model: "openai:gpt-4o",
            userPrompt:
              "Summarise the sick-leave notes below for {{managerName}}.\n\nEmployee: {{employeeName}}\nAbsent: {{absentFrom}} to {{absentTo}}\nNotes: {{notes}}\n\nReturn: the expected return date if stated, the condition in one neutral line, any reasonable adjustments, and three suggested cover actions.",
            temperature: 0.3,
            maxTokens: 300,
            cacheTtlSeconds: 0,
          },
        },
      ],
      edges: [{ source: "start", target: "summarize" }],
    },
  },
  {
    slug: "candidate-negotiation-briefing",
    name: "Brief for a candidate negotiation",
    description:
      "Condenses a candidate's compensation and negotiation notes into a crisp intelligence briefing for the recruiter — stated positions, the gap to the current offer, and suggested concessions — before the next call tries to close it.",
    category: "Ops",
    domain: "ops",
    tags: [
      "negotiation",
      "compensation",
      "offer",
      "ai",
      "recruiting",
      "briefing",
    ],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Negotiation notes",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"candidateName":"Barbara Liskov","roleTitle":"Staff Engineer","recruiterName":"Frances Allen","salaryExpectation":185000,"currentComp":172000,"equityExpectation":"0.25%","notes":"Countered at 185k base and 0.25% equity; wants a clear growth path to principal before signing"}',
          },
        },
        {
          id: "summarize",
          type: "NEGOTIATION_IQ_SUMMARY",
          name: "Summarize the negotiation notes",
          position: { x: 260, y: 0 },
          data: {
            variableName: "briefing",
            model: "openai:gpt-4o",
            userPrompt:
              "Summarise the negotiation notes below for {{recruiterName}} before the call with {{candidateName}}.\n\nCandidate: {{candidateName}}\nRole: {{roleTitle}}\nSalary expectation: {{salaryExpectation}}\nCurrent compensation: {{currentComp}}\nEquity expectation: {{equityExpectation}}\nNotes: {{notes}}\n\nReturn: the candidate's stated positions, the gap to our current offer, and three suggested concessions or trade-offs.",
            temperature: 0.3,
            maxTokens: 300,
            cacheTtlSeconds: 0,
          },
        },
      ],
      edges: [{ source: "start", target: "summarize" }],
    },
  },
  {
    slug: "screen-score-approve-and-hire",
    name: "Screen, score, approve and record a hire",
    description:
      "Moves a candidate from screening to offer through a human-approved gate: requests a background check, scores the shortlist against a weighted rubric, schedules a final interview, and puts the offer decision in front of an approver by email. Only an approved run drafts the offer letter and records the new hire (OFFERED, keyed by the stable employee reference — a re-run never duplicates it). A rejected run notifies the hiring team instead.",
    category: "Ops",
    domain: "ops",
    tags: [
      "acquisition",
      "hiring",
      "offer",
      "approval",
      "background check",
      "screening",
      "score",
      "employee.hired",
    ],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Candidate shortlist",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"employeeRef":"EMP-ADA-009","candidateName":"Ada Boateng","candidateEmail":"ada@example.com","roleTitle":"Account Executive","department":"Sales","companyName":"Acme Corp","startDate":"2026-11-01","workLocation":"London","compensationText":"GBP 150,000 base salary; sign-on bonus of GBP 10,000","approverEmail":"hiring-manager@example.com","candidates":[{"name":"Ada Boateng","experience":"Six years in enterprise sales","notes":"Closes multi-threaded deals","scores":{"roleFit":5,"companyFit":5,"availability":5}},{"name":"Barbara Liskov","experience":"Four years in SaaS sales","notes":"Strong pipeline hygiene","scores":{"roleFit":4,"companyFit":4,"availability":3}}]}',
          },
        },
        {
          id: "vetting",
          type: "BACKGROUND_CHECK",
          name: "Screen the candidate",
          position: { x: 260, y: 0 },
          data: {
            variableName: "vetting",
            candidateName: "{{candidateName}}",
            candidateEmail: "{{candidateEmail}}",
            checkType: "enhanced",
            notes:
              "Verify employment history and references before the offer clears",
          },
        },
        {
          id: "ranking",
          type: "CANDIDATE_SCORE_RANK",
          name: "Score the shortlist",
          position: { x: 520, y: 0 },
          data: {
            variableName: "ranking",
            candidatesJson: "{{{json candidates}}}",
            rubric: [
              { key: "roleFit", label: "Role fit", weight: 0.4 },
              { key: "companyFit", label: "Company fit", weight: 0.3 },
              { key: "availability", label: "Availability", weight: 0.3 },
            ],
          },
        },
        {
          id: "booking",
          type: "CANDIDATE_SCHEDULE",
          name: "Schedule the final interview",
          position: { x: 780, y: 0 },
          data: {
            variableName: "booking",
            candidateName: "{{candidateName}}",
            candidateEmail: "{{candidateEmail}}",
            interviewType: "final",
            bookingUrlTemplate:
              "https://cal.com/team/interview?email={{candidateEmail}}",
          },
        },
        {
          id: "gate",
          type: "APPROVAL",
          name: "Offer approval",
          position: { x: 1040, y: -80 },
          data: {
            variableName: "approval",
            channel: "email",
            approvers: "{{approverEmail}}",
            from: "automation@example.com",
            subject: "Offer approval needed: {{candidateName}}",
            prompt:
              "{{candidateName}} has cleared screening and scored top of the shortlist for {{roleTitle}}.\n\nProposed package: {{compensationText}}\nStart: {{startDate}}\n\nApprove to draft the offer letter and record the hire, or reject with a note for the hiring team.",
            timeoutSeconds: 86400,
          },
        },
        {
          id: "offer",
          type: "OFFER_LETTER",
          name: "Draft the offer letter",
          position: { x: 1300, y: -160 },
          data: {
            variableName: "offer",
            companyName: "{{companyName}}",
            roleTitle: "{{roleTitle}}",
            candidateName: "{{candidateName}}",
            startDate: "{{startDate}}",
            workLocation: "{{workLocation}}",
            compensationText: "{{compensationText}}",
            employmentType: "full_time",
            extraTerms:
              "Offer is contingent on a cleared background check and reference review.",
          },
        },
        {
          id: "hire",
          type: "EMPLOYEE_HIRED",
          name: "Record New Hire",
          position: { x: 1560, y: -160 },
          data: {
            variableName: "hire",
            employeeRef: "{{employeeRef}}",
            email: "{{candidateEmail}}",
            fullName: "{{candidateName}}",
            role: "{{roleTitle}}",
            department: "{{department}}",
            startDate: "{{startDate}}",
          },
        },
        {
          id: "notify",
          type: "HTTP_REQUEST",
          name: "Notify the hiring team",
          position: { x: 1300, y: 120 },
          data: {
            variableName: "notify",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"event":"offer_rejected","candidate":"{{candidateName}}","role":"{{roleTitle}}","reason":"{{approval.comment}}"}',
            failOnNon2xx: true,
          },
        },
      ],
      edges: [
        { source: "start", target: "vetting" },
        { source: "vetting", target: "ranking" },
        { source: "ranking", target: "booking" },
        { source: "booking", target: "gate" },
        { source: "gate", sourceHandle: "approved", target: "offer" },
        { source: "offer", target: "hire" },
        { source: "gate", sourceHandle: "rejected", target: "notify" },
      ],
    },
  },
  {
    slug: "onboard-new-hire",
    name: "Onboard a signed hire through to day one",
    description:
      "Picks up a signed hire and carries them through onboarding: builds a role-aware checklist, requests the background check, plans the orientation session, submits benefits enrollment, and posts the IT access request. If the hire's start date is known, the run waits until that date before wrapping up; if it is missing or cannot be waited on, the run finishes immediately instead of stalling. Either way the record is moved from ONBOARDING to ACTIVE exactly once, keyed by the stable employee reference.",
    category: "Ops",
    domain: "ops",
    tags: [
      "onboarding",
      "new hire",
      "checklist",
      "orientation",
      "benefits",
      "it access",
      "employee.onboarding",
      "employee.active",
    ],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Signed hire",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"employeeRef":"EMP-ADA-009","candidateName":"Ada Boateng","candidateEmail":"ada@example.com","roleTitle":"Account Executive","department":"Sales","companyName":"Acme Corp","startDate":"2026-11-01","workLocation":"London","compensationText":"GBP 150,000 base salary; sign-on bonus of GBP 10,000","approverEmail":"hiring-manager@example.com"}',
          },
        },
        {
          id: "onboarding",
          type: "EMPLOYEE_ONBOARDING",
          name: "Start Onboarding",
          position: { x: 260, y: 0 },
          data: {
            variableName: "onboarding",
            employeeRef: "{{employeeRef}}",
          },
        },
        {
          id: "checklist",
          type: "ONBOARDING_CHECKLIST",
          name: "Build the onboarding checklist",
          position: { x: 520, y: 0 },
          data: {
            variableName: "checklist",
            roleTitle: "{{roleTitle}}",
            items: [
              {
                key: "laptopAndAccess",
                label: "Issue laptop and day-one system access",
                owner: "IT Ops",
                dueOffsetDays: 1,
              },
              {
                key: "toolsAndAccounts",
                label: "Create accounts in company tools",
                owner: "IT Ops",
                dueOffsetDays: 1,
              },
              {
                key: "buddyAssign",
                label: "Assign a peer buddy for the first two weeks",
                owner: "People Ops",
                dueOffsetDays: 0,
              },
            ],
          },
        },
        {
          id: "vetting",
          type: "BACKGROUND_CHECK",
          name: "Run the final background check",
          position: { x: 780, y: 0 },
          data: {
            variableName: "vetting",
            candidateName: "{{candidateName}}",
            candidateEmail: "{{candidateEmail}}",
            checkType: "standard",
            notes:
              "Confirm the signed offer terms and the start-date commitments before day one",
          },
        },
        {
          id: "orientation",
          type: "ORIENTATION",
          name: "Plan the orientation session",
          position: { x: 1040, y: 0 },
          data: {
            variableName: "orientation",
            sessionName: "New-hire orientation - {{candidateName}}",
            startDate: "{{startDate}}",
            locationOrMode: "{{workLocation}}",
            durationMinutes: 120,
            agendaItems: [
              {
                time: "09:00",
                topic: "Welcome, team intro and housekeeping",
                owner: "People Ops",
              },
              {
                time: "10:00",
                topic: "Role expectations and first-week goals",
                owner: "Hiring Manager",
              },
              {
                time: "11:00",
                topic: "Tools walkthrough and security basics",
                owner: "IT Ops",
              },
            ],
          },
        },
        {
          id: "benefits",
          type: "BENEFITS_ENROLLMENT",
          name: "Submit benefits enrollment",
          position: { x: 1300, y: 0 },
          data: {
            variableName: "benefits",
            employeeName: "{{candidateName}}",
            plan: "medical",
            dependentsCount: 0,
            notes:
              "Enroll by day five; payroll deduction starts with the first pay run",
          },
        },
        {
          id: "ittools",
          type: "HTTP_REQUEST",
          name: "Request IT access",
          position: { x: 1560, y: 0 },
          data: {
            variableName: "ittools",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"event":"it_access_requested","employeeRef":"{{employeeRef}}","name":"{{candidateName}}","role":"{{roleTitle}}","startDate":"{{startDate}}"}',
            failOnNon2xx: true,
          },
        },
        {
          id: "has-date",
          type: "CONDITION",
          name: "Start date known?",
          position: { x: 1820, y: 0 },
          data: {
            left: "{{startDate}}",
            operator: "is_not_empty",
          },
        },
        {
          id: "wait",
          type: "WAIT",
          name: "Wait until day one",
          position: { x: 2080, y: -120 },
          data: {
            mode: "until",
            until: "{{startDate}}",
          },
        },
        {
          id: "done",
          type: "MERGE",
          name: "Rejoin",
          position: { x: 2340, y: 0 },
          data: {},
        },
        {
          id: "active",
          type: "EMPLOYEE_ACTIVE",
          name: "Mark Employee Active",
          position: { x: 2600, y: 0 },
          data: {
            variableName: "active",
            employeeRef: "{{employeeRef}}",
            activeAt: "{{startDate}}",
          },
        },
      ],
      edges: [
        { source: "start", target: "onboarding" },
        { source: "onboarding", target: "checklist" },
        { source: "checklist", target: "vetting" },
        { source: "vetting", target: "orientation" },
        { source: "orientation", target: "benefits" },
        { source: "benefits", target: "ittools" },
        { source: "ittools", target: "has-date" },
        { source: "has-date", sourceHandle: "true", target: "wait" },
        { source: "has-date", sourceHandle: "false", target: "done" },
        { source: "wait", target: "done" },
        { source: "done", target: "active" },
      ],
    },
  },
  {
    slug: "tenure-check-ins",
    name: "Welcome an active employee and run tenure check-ins",
    description:
      "Picks up an employee as they become active and runs their tenure on rails: a welcome notice, then scheduled check-ins at 30, 60 and 90 days with a quarterly 360 review at the last mark. It only notifies and carries context forward — it never mutates the employee record.",
    category: "Ops",
    domain: "ops",
    tags: [
      "tenure",
      "check-in",
      "performance review",
      "360 review",
      "retention",
      "employee.active",
    ],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Active employee",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"employeeRef":"EMP-ADA-009","employeeName":"Ada Boateng","roleTitle":"Account Executive","department":"Sales","managerName":"Adjoa Asante","activeSince":"2026-11-01"}',
          },
        },
        {
          id: "welcome",
          type: "HTTP_REQUEST",
          name: "Send the tenure welcome",
          position: { x: 260, y: 0 },
          data: {
            variableName: "welcome",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"event":"tenure_welcome","employeeRef":"{{employeeRef}}","employeeName":"{{employeeName}}","roleTitle":"{{roleTitle}}","department":"{{department}}","managerName":"{{managerName}}","activeSince":"{{activeSince}}","message":"Tenure tracking started - check-ins are scheduled at 30, 60 and 90 days"}',
            failOnNon2xx: true,
          },
        },
        {
          id: "wait-30-days",
          type: "WAIT",
          name: "Wait 30 days",
          position: { x: 520, y: 0 },
          data: {
            mode: "duration",
            seconds: 2592000,
          },
        },
        {
          id: "checkin-30-days",
          type: "HTTP_REQUEST",
          name: "30-day check-in",
          position: { x: 780, y: 0 },
          data: {
            variableName: "checkin30",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"event":"tenure_checkin_30","employeeRef":"{{employeeRef}}","employeeName":"{{employeeName}}","roleTitle":"{{roleTitle}}","managerName":"{{managerName}}","daysActive":"30","stage":"30-day check-in","action":"Hold the first tenure check-in and confirm ramp-up is on track"}',
            failOnNon2xx: true,
          },
        },
        {
          id: "wait-60-days",
          type: "WAIT",
          name: "Wait 60 days",
          position: { x: 1040, y: 0 },
          data: {
            mode: "duration",
            seconds: 2592000,
          },
        },
        {
          id: "checkin-60-days",
          type: "HTTP_REQUEST",
          name: "60-day check-in",
          position: { x: 1300, y: 0 },
          data: {
            variableName: "checkin60",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"event":"tenure_checkin_60","employeeRef":"{{employeeRef}}","employeeName":"{{employeeName}}","roleTitle":"{{roleTitle}}","managerName":"{{managerName}}","daysActive":"60","stage":"60-day check-in","action":"Collect informal feedback and nominate the employee for the 90-day 360 review"}',
            failOnNon2xx: true,
          },
        },
        {
          id: "wait-90-days",
          type: "WAIT",
          name: "Wait 90 days",
          position: { x: 1560, y: 0 },
          data: {
            mode: "duration",
            seconds: 2592000,
          },
        },
        {
          id: "review-quarterly",
          type: "HTTP_REQUEST",
          name: "Quarterly 360 review",
          position: { x: 1820, y: 0 },
          data: {
            variableName: "review90",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"event":"tenure_review_quarterly","employeeRef":"{{employeeRef}}","employeeName":"{{employeeName}}","roleTitle":"{{roleTitle}}","managerName":"{{managerName}}","daysActive":"90","stage":"Quarterly 360 review","action":"Collect peer feedback and deliver the aggregated performance review to the manager"}',
            failOnNon2xx: true,
          },
        },
      ],
      edges: [
        { source: "start", target: "welcome" },
        { source: "welcome", target: "wait-30-days" },
        { source: "wait-30-days", target: "checkin-30-days" },
        { source: "checkin-30-days", target: "wait-60-days" },
        { source: "wait-60-days", target: "checkin-60-days" },
        { source: "checkin-60-days", target: "wait-90-days" },
        { source: "wait-90-days", target: "review-quarterly" },
      ],
    },
  },
  {
    slug: "offboard-employee-lifecycle",
    name: "Run an exit from request to offboarded",
    description:
      "Closes the lifecycle for a departing employee: opens offboarding against the employee record (ACTIVE to OFFBOARDING, recording the last day and the reason), plans the exit interview, builds the dated offboarding checklist, posts the access-revocation request, and completes the exit exactly once. OFFBOARDED is an end state, so a re-run is a no-op and an employee who never entered offboarding returns a conflict instead of skipping the phase.",
    category: "Ops",
    domain: "ops",
    tags: [
      "offboarding",
      "exit",
      "leaver",
      "access revocation",
      "checklist",
      "employee.offboarding",
      "employee.offboarded",
    ],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Offboarding request",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"employeeRef":"EMP-ADA-009","employeeName":"Ada Boateng","roleTitle":"Account Executive","department":"Sales","managerName":"Adjoa Asante","lastDay":"2027-01-15","exitReason":"Resigned to join a startup"}',
          },
        },
        {
          id: "offboarding",
          type: "EMPLOYEE_OFFBOARDING",
          name: "Start Offboarding",
          position: { x: 260, y: 0 },
          data: {
            variableName: "offboarding",
            employeeRef: "{{employeeRef}}",
            exitDate: "{{lastDay}}",
            exitReason: "{{exitReason}}",
          },
        },
        {
          id: "exit-interview",
          type: "EXIT_INTERVIEW",
          name: "Plan the exit interview",
          position: { x: 520, y: 0 },
          data: {
            variableName: "exitInterview",
            employeeName: "{{employeeName}}",
            departureDate: "{{lastDay}}",
            interviewer: "{{managerName}}",
            format: "video",
            focusAreas: [
              { area: "What would have kept you here?" },
              { area: "Feedback on the team and culture" },
              { area: "Knowledge and handover concerns" },
            ],
          },
        },
        {
          id: "checklist",
          type: "OFFBOARDING_CHECKLIST",
          name: "Build the offboarding checklist",
          position: { x: 780, y: 0 },
          data: {
            variableName: "checklist",
            roleTitle: "{{roleTitle}}",
            items: [
              {
                key: "handover",
                label: "Document knowledge and hand over open work",
                owner: "{{managerName}}",
                dueOffsetDays: 0,
              },
              {
                key: "asset_return",
                label: "Return laptop, badge and keys",
                owner: "IT Admin",
                dueOffsetDays: 1,
              },
              {
                key: "payroll_final",
                label: "Confirm final payroll and benefits end date",
                owner: "People Ops",
                dueOffsetDays: 2,
              },
              {
                key: "exit_followup",
                label: "Close the exit interview and archive feedback",
                owner: "People Ops",
                dueOffsetDays: 7,
              },
            ],
          },
        },
        {
          id: "revoke-access",
          type: "HTTP_REQUEST",
          name: "Revoke system access",
          position: { x: 1040, y: 0 },
          data: {
            variableName: "revoke",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"event":"access_revocation_requested","employeeRef":"{{employeeRef}}","employeeName":"{{employeeName}}","roleTitle":"{{roleTitle}}","department":"{{department}}","lastDay":"{{lastDay}}","scope":["email","sso","vpn","code repositories","payroll portal"]}',
            failOnNon2xx: true,
          },
        },
        {
          id: "offboarded",
          type: "EMPLOYEE_OFFBOARDED",
          name: "Complete Offboarding",
          position: { x: 1300, y: 0 },
          data: {
            variableName: "offboarded",
            employeeRef: "{{employeeRef}}",
            exitDate: "{{lastDay}}",
          },
        },
      ],
      edges: [
        { source: "start", target: "offboarding" },
        { source: "offboarding", target: "exit-interview" },
        { source: "exit-interview", target: "checklist" },
        { source: "checklist", target: "revoke-access" },
        { source: "revoke-access", target: "offboarded" },
      ],
    },
  },
  {
    slug: "hris-new-hire-to-onboarding",
    name: "Open the lifecycle from your HRIS",
    description:
      "Watches your BambooHR employee directory and opens the lifecycle for each new person automatically — no ATS export, no manual trigger. Records the hire against the HRIS employee id, so the reference the handoffs are keyed by is the same one your HR system uses and a re-poll can never duplicate the row. Connect BambooHR and activate; the people already in the directory are never replayed.",
    category: "Ops",
    domain: "ops",
    tags: [
      "hris",
      "bamboohr",
      "new hire",
      "polling",
      "acquisition",
      "employee.hired",
      "onboarding",
    ],
    graph: {
      nodes: [
        {
          id: "start",
          type: "BAMBOOHR_TRIGGER",
          name: "New employee in BambooHR",
          position: { x: 0, y: 0 },
          data: {
            pollIntervalSeconds: 900,
          },
        },
        {
          id: "hire",
          type: "EMPLOYEE_HIRED",
          name: "Record New Hire",
          position: { x: 260, y: 0 },
          data: {
            variableName: "hire",
            employeeRef: "{{employee.employeeRef}}",
            email: "{{employee.email}}",
            fullName: "{{employee.fullName}}",
            role: "{{employee.role}}",
            department: "{{employee.department}}",
            managerEmail: "{{employee.managerEmail}}",
            startDate: "{{employee.startDate}}",
          },
        },
        {
          id: "onboarding",
          type: "EMPLOYEE_ONBOARDING",
          name: "Start Onboarding",
          position: { x: 520, y: 0 },
          data: {
            variableName: "onboarding",
            employeeRef: "{{employee.employeeRef}}",
          },
        },
        {
          id: "checklist",
          type: "ONBOARDING_CHECKLIST",
          name: "Build the onboarding checklist",
          position: { x: 780, y: 0 },
          data: {
            variableName: "checklist",
            roleTitle: "{{employee.role}}",
            items: [
              {
                key: "laptopAndAccess",
                label: "Issue laptop and day-one system access",
                owner: "IT Ops",
                dueOffsetDays: 1,
              },
              {
                key: "buddyAssign",
                label: "Assign a peer buddy for the first two weeks",
                owner: "People Ops",
                dueOffsetDays: 0,
              },
            ],
          },
        },
        {
          id: "notify",
          type: "HTTP_REQUEST",
          name: "Notify the people team",
          position: { x: 1040, y: 0 },
          data: {
            variableName: "notify",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"event":"hris_new_hire","employeeRef":"{{employee.employeeRef}}","name":"{{employee.fullName}}","role":"{{employee.role}}","startDate":"{{employee.startDate}}","outcome":"{{hire.outcome}}"}',
            failOnNon2xx: true,
          },
        },
      ],
      edges: [
        { source: "start", target: "hire" },
        { source: "hire", target: "onboarding" },
        { source: "onboarding", target: "checklist" },
        { source: "checklist", target: "notify" },
      ],
    },
  },
];
