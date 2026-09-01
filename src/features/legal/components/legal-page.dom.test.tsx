import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LegalPage, LegalSection } from "./legal-page";

/**
 * AF-M8-10. The guard is the point of this component: an unconfigured
 * deployment must not be able to serve something that reads as a published
 * policy. Both directions are tested, because a guard that never opens is
 * just as broken as one that never closes.
 */

const KEYS = [
  "NEXT_PUBLIC_LEGAL_ENTITY_NAME",
  "NEXT_PUBLIC_LEGAL_JURISDICTION",
  "NEXT_PUBLIC_LEGAL_ADDRESS",
  "NEXT_PUBLIC_LEGAL_CONTACT_EMAIL",
  "NEXT_PUBLIC_LEGAL_PRIVACY_EMAIL",
  "NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE",
] as const;

const saved: Record<string, string | undefined> = {};

const configure = () => {
  process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME = "AutoFlow Technologies Ltd";
  process.env.NEXT_PUBLIC_LEGAL_JURISDICTION = "England and Wales";
  process.env.NEXT_PUBLIC_LEGAL_ADDRESS = "1 Example Street, London";
  process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL = "legal@example.com";
  process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE = "2026-09-14";
};

const subject = () => (
  <LegalPage summary="What this covers." title="Privacy Policy">
    <LegalSection title="Retention">
      <p>Run inputs are erased after seven days.</p>
    </LegalSection>
  </LegalPage>
);

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("LegalPage — unconfigured", () => {
  it("withholds the policy body entirely", () => {
    render(subject());

    expect(
      screen.queryByText(/Run inputs are erased after seven days/),
    ).toBeNull();
    expect(screen.queryByText("Retention")).toBeNull();
  });

  it("says plainly that it is not published", () => {
    render(subject());

    expect(
      screen.getByText(/This document is not published yet/),
    ).toBeInTheDocument();
  });

  it("still shows the document title, so the URL is not a dead end", () => {
    render(subject());

    expect(
      screen.getByRole("heading", { name: "Privacy Policy" }),
    ).toBeInTheDocument();
  });

  it("names what has to be set", () => {
    render(subject());

    expect(
      screen.getByText("NEXT_PUBLIC_LEGAL_ENTITY_NAME"),
    ).toBeInTheDocument();
  });

  it("tells the operator a lawyer has to review it first", () => {
    render(subject());

    expect(screen.getByText(/reviewed by a qualified lawyer/)).toBeVisible();
  });

  it("withholds the body when the entity is set but the date is not", () => {
    // Partial configuration is still unpublished: a policy with no effective
    // date is not a policy anyone can rely on.
    configure();
    delete process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE;

    render(subject());

    expect(
      screen.queryByText(/Run inputs are erased after seven days/),
    ).toBeNull();
  });
});

describe("LegalPage — configured", () => {
  beforeEach(configure);

  it("renders the policy body", () => {
    render(subject());

    expect(
      screen.getByText(/Run inputs are erased after seven days/),
    ).toBeInTheDocument();
    expect(screen.getByText("Retention")).toBeInTheDocument();
  });

  it("shows the entity and effective date", () => {
    render(subject());

    // The name appears in the header and again in the footer address block.
    expect(
      screen.getAllByText(/AutoFlow Technologies Ltd/).length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("2026-09-14")).toBeInTheDocument();
  });

  it("no longer shows the not-published notice", () => {
    render(subject());

    expect(screen.queryByText(/This document is not published yet/)).toBeNull();
  });

  it("links the sibling documents", () => {
    render(subject());

    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getByRole("link", { name: "DPA" })).toHaveAttribute(
      "href",
      "/dpa",
    );
  });
});
