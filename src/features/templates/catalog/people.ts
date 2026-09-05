import type { TemplateSpec } from "./types";

/**
 * People-team templates (AF-M11-03).
 *
 * Six `Ops` gallery entries demonstrating the people node family on single
 * rails: every graph is a linear trigger-anchored chain over the `people/*`
 * registry nodes, and none of them require a credential at install time (the
 * AI summaries treat their provider keys as optional).
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
              '{"employeeRef":"EMP-ADA-009","candidateName":"Ada Boateng","candidateEmail":"ada@example.com","roleTitle":"Account Executive","department":"Sales","companyName":"Acme Corp","startDate":"2026-11-01","workLocation":"London","compensationText":"GBP 150,000 base salary; sign-on bonus of GBP 10,000","approverEmail":"hiring-manager@example.com","candidates":[{"name":"Ada Boateng","experience":"Six years in enterprise sales","notes":"Closes multi-threaded deals"},{"name":"Barbara Liskov","experience":"Four years in SaaS sales","notes":"Strong pipeline hygiene"}]}',
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
];
