import "server-only";
import { listBambooHrEmployees } from "@/features/hris/server/bamboohr-client";
import type { PollingTrigger } from "@/nodes/types";

type BambooHrTriggerConfig = {
  department?: string;
};

/**
 * `BAMBOOHR_TRIGGER`'s poller (AF-M11-10 on the AF-M10-05 framework).
 *
 * The M11 brief calls for the lifecycle to open from an HRIS rather than from
 * someone pressing Run. That is a polling problem — BambooHR has no outbound
 * webhook for directory changes — and the framework already solves it: this
 * answers "who is in the directory?", and dispatch, dedupe, the cursor, the
 * backoff and the never-replay-history rule stay where ADR-0024 put them. No
 * bespoke trigger, no second scheduler.
 *
 * **Identity is the BambooHR employee id**, which is stable for the life of
 * the record. A person is therefore dispatched once, on the poll that first
 * sees them, and an edit to their row does not re-fire the chain — which is
 * what you want when the downstream node creates an `Employee` and moves it to
 * `OFFERED`.
 *
 * The payload is shaped to drop straight into `EMPLOYEE_HIRED`: `employeeRef`
 * is the HRIS id, so the handoff's stable business key is the same identifier
 * the HRIS uses, and re-running the workflow can never duplicate the row.
 */
export const polling: PollingTrigger<BambooHrTriggerConfig> = {
  defaultIntervalSeconds: 900,

  async poll({ config, credentials, limit }) {
    const employees = await listBambooHrEmployees({
      secret: credentials?.credentialId,
      where: "BambooHR trigger",
    });

    const department = config.department?.trim().toLowerCase();

    return {
      items: employees
        .filter(
          (employee) =>
            !department ||
            (employee.department ?? "").toLowerCase() === department,
        )
        // An employee with no work email cannot be handed to the lifecycle:
        // `employeeHiredSchema` requires one, and dispatching a run that is
        // certain to fail at its second node is worse than not dispatching.
        .filter((employee) => employee.workEmail !== null)
        .map((employee) => ({
          id: employee.id,
          data: {
            employee: {
              employeeRef: employee.id,
              email: employee.workEmail,
              fullName:
                employee.displayName ??
                [employee.firstName, employee.lastName]
                  .filter(Boolean)
                  .join(" "),
              role: employee.jobTitle ?? "",
              department: employee.department ?? "",
              managerEmail: employee.supervisorEmail ?? "",
              startDate: employee.hireDate ?? "",
            },
            source: "bamboohr",
          },
        }))
        .slice(0, limit),
      // The directory has no server-side cursor to resume from; identity comes
      // from the framework's id window. Recorded so a stuck trigger is
      // diagnosable from the row alone.
      cursor: {
        lastPolledAt: new Date().toISOString(),
        directorySize: employees.length,
      },
    };
  },
};
