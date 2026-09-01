import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "AutoFlow — expressions",
  description:
    "How an AutoFlow node reads data from the nodes before it: syntax, available context, escaping, and error behaviour.",
};

const Section = ({
  title,
  children,
  id,
}: {
  title: string;
  id: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-3" id={id}>
    <h2 className="text-lg font-medium">{title}</h2>
    {children}
  </section>
);

const Code = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-xl border border-hairline bg-well p-4 text-sm">
    <code>{children}</code>
  </pre>
);

const Row = ({
  expression,
  meaning,
}: {
  expression: string;
  meaning: ReactNode;
}) => (
  <li className="flex flex-col gap-1 border-t border-hairline py-3 first:border-t-0 sm:flex-row sm:gap-6">
    <code className="shrink-0 text-sm sm:w-56">{expression}</code>
    <span className="text-sm text-muted-foreground">{meaning}</span>
  </li>
);

export default function ExpressionsPage() {
  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Expressions</h1>
        <p className="max-w-2xl text-muted-foreground">
          Any text field on a node can contain an expression. Expressions are
          how a node reads what the nodes before it produced. They are evaluated
          once per node, immediately before that node runs.
        </p>
      </header>

      <Section id="syntax" title="Syntax">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Wrap a path in double braces. Everything outside the braces is used
          literally, so an expression can be embedded in a larger string.
        </p>
        <Code>{`Hello {{$json.customer.name}}, your order {{$json.orderId}} shipped.`}</Code>
        <p className="max-w-2xl text-sm text-muted-foreground">
          A node name containing spaces goes in square brackets, unquoted:
        </p>
        <Code>{`{{$node.[HTTP Request].httpResponse.data.title}}`}</Code>
      </Section>

      <Section id="context" title="What you can reference">
        <ul className="rounded-xl border border-hairline bg-panel px-4">
          <Row
            expression="{{$json.field}}"
            meaning="The accumulated output of every node that has run so far in this execution. This is the one you want most of the time."
          />
          <Row
            expression={`{{$node.[Node name].field}}`}
            meaning={
              <>
                The output of one specific upstream node, by its name on the
                canvas. Use this when two nodes produce the same key and you
                need a particular one. Note the square brackets and the{" "}
                <strong>absence of quotes</strong> — they are what allow a name
                containing spaces; adding quotes looks for a key that literally
                contains them.
              </>
            }
          />
          <Row
            expression="{{$execution.id}}"
            meaning="The id of the current run. Useful as an idempotency key in a downstream system."
          />
          <Row
            expression="{{$workflow.id}}"
            meaning="The id of the workflow being run."
          />
          <Row
            expression="{{$now}}"
            meaning="ISO-8601 timestamp, fixed for the whole node so two fields on the same node cannot disagree."
          />
          <Row
            expression="{{field}}"
            meaning="Top-level keys of the accumulated output are also readable without the $json prefix."
          />
        </ul>
      </Section>

      <Section id="escaping" title="Escaping — read this one">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Values interpolated with <code>{"{{ }}"}</code> are HTML-escaped. That
          is right for text, and wrong for almost everything else — a JSON body
          built with <code>{"{{ }}"}</code> becomes invalid the first time a
          value contains a quote or an ampersand.
        </p>
        <Code>{`{{name}}     →  O&#x27;Brien &amp; Sons     (escaped — breaks JSON)
{{{name}}}   →  O'Brien & Sons          (raw — use this in a body)
{{json obj}} →  { "a": 1, "b": [2, 3] } (serialises a whole object)`}</Code>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Rules of thumb: <strong>triple braces</strong> when writing into JSON,
          SQL, or a URL. The <strong>json helper</strong> when you want an
          entire object rather than one scalar — interpolating an object with
          double braces renders <code>[object Object]</code>, which is rarely
          what anyone wanted.
        </p>
      </Section>

      <Section id="missing" title="Missing values do not fail">
        <p className="max-w-2xl text-sm text-muted-foreground">
          A path that does not resolve renders as an empty string. It is not an
          error, and the run continues. This is deliberate — a partially
          populated payload is usually better than a failed run — but it does
          mean a typo in a path is silent. If a downstream system receives an
          empty field, suspect the expression before suspecting the data.
        </p>
        <Code>{`{{$json.custmoer.name}}   →  ""   (typo renders empty, run continues)`}</Code>
      </Section>

      <Section id="limits" title="What expressions deliberately cannot do">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Expressions are not JavaScript. There is no <code>eval</code>, no{" "}
          <code>new Function</code>, and no VM anywhere in the evaluation path.
          The limitation is the security control, not an unfinished feature:
          this system holds every customer's credentials, and arbitrary code in
          a template field would be remote code execution against that store.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>
            No arbitrary code, arithmetic, or method calls inside an expression.
          </li>
          <li>
            No access to <code>constructor</code>, <code>__proto__</code>, or
            any inherited property — only own properties of the run's data.
          </li>
          <li>
            No access to environment variables, globals, or the file system.
          </li>
          <li>
            Transformation belongs in a node (Set, Condition, or an AI node),
            where it is visible on the canvas and recorded in the trace.
          </li>
        </ul>
      </Section>

      <Section id="debugging" title="Seeing what a node actually received">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every node records its resolved input and its output on the execution
          trace, so the fastest way to fix an expression is to open the run and
          read what the node was actually given, rather than reasoning about
          what it should have been. Note that inputs and outputs are redacted
          once a run passes your plan's retention window — debug recent runs.
        </p>
      </Section>
    </article>
  );
}
