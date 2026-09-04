import type { TemplateSpec } from "./types";

/**
 * The invoice shape both extraction paths in #8 produce.
 *
 * Declared once and shared, because the text path and the vision path have to
 * agree field for field — they meet at one confidence check and one sheet, and
 * a field present on only one branch would produce a blank column for half the
 * invoices with nothing to say why.
 *
 * `confidence` is a field the model fills in, not a number this product
 * computes: the extraction knows whether the total was printed clearly or
 * inferred from a smudge, and the threshold branch is only as good as that
 * self-report. Its description says so plainly, because a model asked for a
 * confidence without being told what it means returns 0.95 for everything.
 */
const INVOICE_FIELDS = [
  { name: "vendor", type: "string", description: "Supplier's legal name." },
  {
    name: "invoiceNumber",
    type: "string",
    description: "The supplier's own invoice number, not a PO number.",
  },
  { name: "invoiceDate", type: "string", description: "Issue date, ISO 8601." },
  {
    name: "dueDate",
    type: "string",
    description: "Payment due date, ISO 8601.",
  },
  {
    name: "total",
    type: "number",
    description: "Gross amount payable, including tax. No currency symbol.",
  },
  { name: "currency", type: "string", description: "ISO 4217 code, e.g. GBP." },
  {
    name: "lineItems",
    type: "object",
    description:
      "Array of { description, quantity, unitPrice, amount } for each line.",
  },
  {
    name: "confidence",
    type: "number",
    description:
      "0 to 1. How sure you are that vendor, total and dates are all correct. Return below 0.9 if any of the three was unclear, inferred, or absent — this number decides whether a human reads the invoice before it is booked, so an over-confident answer books a wrong number.",
  },
] as const;

/**
 * Finance & Accounting reference automations (AF-M10-25, source #8–#17).
 *
 * Split out of `data.ts` rather than appended to it: ten more entries would
 * have taken that file past a thousand lines of graph, and these share a
 * subject rather than a domain — the `domain` field still says `data`, which
 * is what the per-domain floor counts.
 *
 * Three of the ten live in `data.ts` because AF-M10-16 authored them as the
 * QuickBooks family's own demonstrations. Two of those were upgraded in place
 * to the source's behaviour rather than duplicated here.
 *
 * No entry carries a real company, item, account or tax-code id. Every one is
 * a `REPLACE_WITH_*` placeholder that `collectPendingSetup` reports on the
 * template page, because a sandbox id that a shipped template points somebody's
 * books at is the kind of value that accepts a write and loses it.
 */
export const financeTemplates: TemplateSpec[] = [
  {
    slug: "ap-invoice-processing",
    name: "Read supplier invoices and book the confident ones",
    description:
      "Reference automation #8. Watches a Drive folder for supplier invoices, routes each by file type — embedded text for a PDF, vision for a scan — extracts vendor, dates, totals and line items with Gemini, and then splits on the model's own confidence: at 0.9 or above the invoice is logged and booked into QuickBooks; below it, the invoice goes to an exceptions tab and a reviewer is asked in Slack. The threshold is a real branch on the extracted number, not a note saying it ought to be. PREREQUISITES: Drive, Sheets, Slack and QuickBooks credentials, plus an AI provider key if you are not using the platform's. A spreadsheet with two tabs, Invoices_Raw and Invoices_Exceptions, sharing the columns File, Vendor, Number, Date, Due, Total, Currency, Confidence. Your own payment and expense account ids from the chart of accounts. DEVIATIONS FROM THE SOURCE: the source also triggers on Gmail attachments. This product can read a Gmail message but has no node to fetch an attachment's bytes, so the mail arm would extract nothing — the standard workaround is a Gmail filter that saves attachments to the same Drive folder, which this template then picks up. The source creates a QuickBooks BILL; there is no bill node, so a Purchase is recorded instead, which books the spend against the vendor and account but does not create a payable that ages. If you need the payable, treat this as extraction and review, and enter the bill from the logged row.",
    category: "Finance",
    domain: "data",
    // Drive, Sheets, QuickBooks, Slack. The Gemini key is optional.
    tier: "library",
    tags: [
      "invoice",
      "accounts-payable",
      "quickbooks",
      "gemini",
      "ocr",
      "finance",
    ],
    featured: true,
    graph: {
      nodes: [
        {
          id: "new-file",
          type: "DRIVE_TRIGGER",
          name: "New invoice in the folder",
          position: { x: 0, y: 0 },
          data: {
            folderId: "REPLACE_WITH_INVOICE_FOLDER_ID",
            pollIntervalSeconds: 300,
          },
        },
        {
          id: "fetch",
          type: "DRIVE_DOWNLOAD",
          name: "Fetch the file",
          position: { x: 260, y: 0 },
          data: {
            variableName: "doc",
            fileId: "{{file.id}}",
            maxBytes: 26214400,
          },
        },
        {
          id: "is-scan",
          type: "CONDITION",
          name: "A scan, or a real PDF?",
          position: { x: 520, y: 0 },
          data: {
            // A PDF with embedded text costs nothing to read and reads
            // exactly; sending it to a vision model would be slower, dearer
            // and less accurate. Only images have no text to extract.
            left: "{{doc.mimeType}}",
            operator: "contains",
            right: "image/",
          },
        },
        {
          id: "pages",
          type: "EXTRACT_DOCUMENT_TEXT",
          name: "Read the PDF text",
          position: { x: 800, y: 140 },
          data: {
            variableName: "pages",
            file: "{{{json doc.file}}}",
            maxCharacters: 200000,
          },
        },
        {
          id: "read-text",
          type: "AI_EXTRACT",
          name: "Extract from the text",
          position: { x: 1080, y: 140 },
          data: {
            variableName: "invoice",
            model: "google:gemini-1.5-pro",
            fallbackModels: "openai:gpt-4o",
            content:
              "Extract the invoice below. If a field is absent, leave it empty rather than guessing, and let the confidence reflect that.\n\n{{pages.text}}",
            fields: INVOICE_FIELDS,
          },
        },
        {
          id: "read-image",
          type: "AI_EXTRACT",
          name: "Extract from the scan",
          position: { x: 1080, y: -140 },
          data: {
            // Same variableName as the text path on purpose: the branches
            // converge on one confidence check, so downstream reads `invoice`
            // without caring which route the file took.
            variableName: "invoice",
            model: "google:gemini-1.5-pro",
            fallbackModels: "openai:gpt-4o",
            content:
              "Extract the invoice in the attached image. If a field is absent or unreadable, leave it empty rather than guessing, and let the confidence reflect that.",
            attachments: "{{{json doc.file}}}",
            fields: INVOICE_FIELDS,
          },
        },
        {
          id: "confident",
          type: "CONDITION",
          name: "Confident enough to book?",
          position: { x: 1360, y: 0 },
          data: {
            left: "{{invoice.confidence}}",
            operator: "gte",
            right: "0.9",
          },
        },
        {
          id: "log-raw",
          type: "GOOGLE_SHEETS_APPEND",
          name: "Log the invoice",
          position: { x: 1640, y: -120 },
          data: {
            variableName: "logged",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Invoices_Raw",
            values:
              '{"File": "{{doc.name}}", "Vendor": "{{invoice.vendor}}", "Number": "{{invoice.invoiceNumber}}", "Date": "{{invoice.invoiceDate}}", "Due": "{{invoice.dueDate}}", "Total": "{{invoice.total}}", "Currency": "{{invoice.currency}}", "Confidence": "{{invoice.confidence}}"}',
          },
        },
        {
          id: "book",
          type: "QBO_CREATE_EXPENSE",
          name: "Book it in QuickBooks",
          position: { x: 1920, y: -120 },
          data: {
            variableName: "booked",
            paymentAccountId: "REPLACE_WITH_PAYMENT_ACCOUNT_ID",
            paymentType: "CreditCard",
            expenseAccountId: "REPLACE_WITH_EXPENSE_ACCOUNT_ID",
            amount: "{{invoice.total}}",
            txnDate: "{{invoice.invoiceDate}}",
            description:
              "{{invoice.vendor}} invoice {{invoice.invoiceNumber}} ({{doc.name}})",
          },
        },
        {
          id: "log-exception",
          type: "GOOGLE_SHEETS_APPEND",
          name: "Log the exception",
          position: { x: 1640, y: 140 },
          data: {
            variableName: "flagged",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Invoices_Exceptions",
            values:
              '{"File": "{{doc.name}}", "Vendor": "{{invoice.vendor}}", "Number": "{{invoice.invoiceNumber}}", "Date": "{{invoice.invoiceDate}}", "Due": "{{invoice.dueDate}}", "Total": "{{invoice.total}}", "Currency": "{{invoice.currency}}", "Confidence": "{{invoice.confidence}}"}',
          },
        },
        {
          id: "ask-a-human",
          type: "SLACK_POST",
          name: "Ask a reviewer",
          position: { x: 1920, y: 140 },
          data: {
            variableName: "asked",
            channel: "#ap-review",
            text: "*Invoice needs a look* — confidence {{invoice.confidence}}\n{{doc.name}} · {{invoice.vendor}} · {{invoice.total}} {{invoice.currency}}\nIt is in the Invoices_Exceptions tab; nothing has been booked.",
          },
        },
      ],
      edges: [
        { source: "new-file", target: "fetch" },
        { source: "fetch", target: "is-scan" },
        { source: "is-scan", target: "read-image", sourceHandle: "true" },
        { source: "is-scan", target: "pages", sourceHandle: "false" },
        { source: "pages", target: "read-text" },
        { source: "read-text", target: "confident" },
        { source: "read-image", target: "confident" },
        { source: "confident", target: "log-raw", sourceHandle: "true" },
        { source: "log-raw", target: "book" },
        { source: "confident", target: "log-exception", sourceHandle: "false" },
        { source: "log-exception", target: "ask-a-human" },
      ],
    },
  },
  {
    slug: "expense-sync-airtable-quickbooks",
    name: "Approved expenses straight into QuickBooks",
    description:
      "Reference automation #9. Watches an Airtable expense table for records marked Approved, records the matching QuickBooks expense, attaches the receipt to that same record so the document and the entry are never separated, and writes the status back to Done with the QuickBooks id. PREREQUISITES: an Airtable credential and base with the columns Status, Receipt URL, Amount, Date, Memo and Last Modified, plus a QuickBooks credential and your own payment and expense account ids. DEVIATIONS FROM THE SOURCE: the source polls every record and then checks Status = Approved in the workflow; here the check is the trigger's own filterByFormula, so an unapproved record never starts a run at all. The write-back to Done is what stops a second run re-booking the same expense, so if you change the trigger's filter, change that guard with it.",
    category: "Finance",
    domain: "data",
    // Airtable to watch and write back, QuickBooks to record.
    tier: "library",
    tags: ["expenses", "airtable", "quickbooks", "receipt", "approval"],
    graph: {
      nodes: [
        {
          id: "approved",
          type: "AIRTABLE_TRIGGER",
          name: "Expense approved",
          position: { x: 0, y: 0 },
          data: {
            baseId: "REPLACE_WITH_BASE_ID",
            tableId: "Expenses",
            // The filter IS the approval check. A formula names the column by
            // its display name in braces, which is the one piece of Airtable
            // syntax people get wrong first.
            filterByFormula: '{Status} = "Approved"',
            modifiedField: "Last Modified",
            pollIntervalSeconds: 300,
          },
        },
        {
          id: "receipt-file",
          type: "FILE_DOWNLOAD",
          name: "Fetch the receipt",
          position: { x: 280, y: 0 },
          data: {
            variableName: "receipt",
            url: "{{record.fields.[Receipt URL]}}",
          },
        },
        {
          id: "expense",
          type: "QBO_CREATE_EXPENSE",
          name: "Record the expense",
          position: { x: 560, y: 0 },
          data: {
            variableName: "expense",
            paymentAccountId: "REPLACE_WITH_PAYMENT_ACCOUNT_ID",
            paymentType: "CreditCard",
            expenseAccountId: "REPLACE_WITH_EXPENSE_ACCOUNT_ID",
            amount: "{{record.fields.Amount}}",
            txnDate: "{{record.fields.Date}}",
            description: "{{record.fields.Memo}}",
          },
        },
        {
          id: "attach",
          type: "QBO_ATTACH",
          name: "Attach the receipt",
          position: { x: 840, y: 0 },
          data: {
            variableName: "attached",
            // QuickBooks calls this a Purchase in the API and an Expense on
            // screen. Same record, two names.
            entity: "Purchase",
            entityId: "{{expense.id}}",
            file: "{{{json receipt.file}}}",
          },
        },
        {
          id: "mark-done",
          type: "AIRTABLE_UPDATE",
          name: "Mark it done",
          position: { x: 1120, y: 0 },
          data: {
            variableName: "closed",
            baseId: "REPLACE_WITH_BASE_ID",
            tableId: "Expenses",
            recordId: "{{record.id}}",
            fields:
              '{"Status": "Done", "QuickBooks ID": "{{expense.id}}", "Booked": "{{expense.txnDate}}"}',
          },
        },
      ],
      edges: [
        { source: "approved", target: "receipt-file" },
        { source: "receipt-file", target: "expense" },
        { source: "expense", target: "attach" },
        { source: "attach", target: "mark-done" },
      ],
    },
  },
  {
    slug: "quickbooks-invoice-alerts-slack",
    name: "Invoice activity in Slack, without QuickBooks seats",
    description:
      'Reference automation #10. Posts a Slack alert whenever an invoice is created or updated in QuickBooks, with the customer, the amount, the due date and whether it is still outstanding — so a sales or account team can see billing without everyone holding a QuickBooks licence. PREREQUISITES: a webhook registered in the Intuit Developer Portal and subscribed to Invoice events, a QuickBooks credential, and a Slack credential with the target channel. DEVIATIONS FROM THE SOURCE: the source posts customer name and due date; the balance is added here, because "invoice updated" without it is an alert nobody can act on — the common update IS a payment, and the balance is how you tell.',
    category: "Finance",
    domain: "data",
    // QuickBooks to read the invoice, Slack to say so.
    tier: "library",
    tags: ["quickbooks", "slack", "invoice", "alerting", "visibility"],
    graph: {
      nodes: [
        {
          id: "invoice-event",
          type: "QBO_WEBHOOK_TRIGGER",
          name: "Invoice created or changed",
          position: { x: 0, y: 0 },
          data: {
            entities: ["Invoice"],
            operations: ["Create", "Update"],
          },
        },
        {
          id: "detail",
          type: "QBO_GET",
          name: "Fetch the invoice",
          position: { x: 300, y: 0 },
          data: {
            // Intuit's webhook carries an id and an operation, nothing else —
            // every readable field needs this second call.
            variableName: "invoice",
            entity: "Invoice",
            entityId: "{{qbo.entityId}}",
          },
        },
        {
          id: "alert",
          type: "SLACK_POST",
          name: "Post to Slack",
          position: { x: 600, y: 0 },
          data: {
            variableName: "posted",
            channel: "#billing",
            text: "*Invoice {{invoice.record.DocNumber}}* — {{qbo.operation}}\n{{invoice.record.CustomerRef.name}} · {{invoice.record.TotalAmt}} due {{invoice.record.DueDate}}\nOutstanding: {{invoice.record.Balance}}",
          },
        },
      ],
      edges: [
        { source: "invoice-event", target: "detail" },
        { source: "detail", target: "alert" },
      ],
    },
  },
  {
    slug: "quickbooks-invoice-pdf-to-drive",
    name: "Archive every invoice PDF to Drive",
    description:
      "Reference automation #12. Saves a PDF copy of every new QuickBooks invoice into a Drive folder, named by date, number and customer so the folder sorts chronologically and stays searchable. An audit trail outside QuickBooks, and a folder you can share with people who should not have QuickBooks access. PREREQUISITES: a Google credential with the Drive API enabled and a destination folder id, a QuickBooks credential, and an Intuit Developer Portal webhook subscribed to Invoice events. DEVIATIONS FROM THE SOURCE: none. The filename is built date-first, which the source leaves to the reader — a folder named number-first sorts by an id nobody remembers.",
    category: "Finance",
    domain: "data",
    // QuickBooks to fetch, Drive to keep.
    tier: "library",
    tags: ["quickbooks", "drive", "invoice", "pdf", "archive", "audit"],
    graph: {
      nodes: [
        {
          id: "invoice-created",
          type: "QBO_WEBHOOK_TRIGGER",
          name: "Invoice created",
          position: { x: 0, y: 0 },
          data: {
            entities: ["Invoice"],
            operations: ["Create"],
          },
        },
        {
          id: "detail",
          type: "QBO_GET",
          name: "Fetch the invoice",
          position: { x: 300, y: 0 },
          data: {
            // Only for the filename. The PDF itself comes from its own
            // endpoint, which returns bytes and no metadata.
            variableName: "invoice",
            entity: "Invoice",
            entityId: "{{qbo.entityId}}",
          },
        },
        {
          id: "pdf",
          type: "QBO_GET_INVOICE_PDF",
          name: "Render the PDF",
          position: { x: 600, y: 0 },
          data: {
            variableName: "pdf",
            invoiceId: "{{qbo.entityId}}",
            filename:
              "{{invoice.record.TxnDate}} {{invoice.record.DocNumber}} {{invoice.record.CustomerRef.name}}.pdf",
          },
        },
        {
          id: "archive",
          type: "DRIVE_UPLOAD",
          name: "File it in Drive",
          position: { x: 900, y: 0 },
          data: {
            variableName: "archived",
            file: "{{{json pdf.file}}}",
            folderId: "REPLACE_WITH_ARCHIVE_FOLDER_ID",
            filename:
              "{{invoice.record.TxnDate}} {{invoice.record.DocNumber}} {{invoice.record.CustomerRef.name}}.pdf",
          },
        },
      ],
      edges: [
        { source: "invoice-created", target: "detail" },
        { source: "detail", target: "pdf" },
        { source: "pdf", target: "archive" },
      ],
    },
  },
  {
    slug: "quickbooks-receipt-from-sheet-row",
    name: "A sales sheet that files its own receipts",
    description:
      "Reference automation #13. Watches a sales sheet and, for each new row, files a QuickBooks sales receipt — creating the customer first when the name is new. Both branches finish at the same receipt, so a first sale and a repeat sale produce the same record. PREREQUISITES: Sheets and QuickBooks credentials, and at least one Product/Service item configured in QuickBooks. Columns: Reference, Customer, Email, Description, Amount. Headers are addressed as {{row.fields.Customer}}, so a header containing a space needs bracket syntax — which is why these are single words. DEVIATIONS FROM THE SOURCE: rows already in the sheet when you publish are not replayed; the trigger records where the sheet was and starts from there. The source has no such guard, and without one, publishing a workflow against an existing sheet files a receipt for every historical sale at once.",
    category: "Finance",
    domain: "data",
    // Sheets to watch, QuickBooks to file.
    tier: "library",
    tags: ["quickbooks", "sheets", "receipt", "customer", "sales", "finance"],
    graph: {
      nodes: [
        {
          id: "new-sale",
          type: "SHEETS_TRIGGER",
          name: "New sale logged",
          position: { x: 0, y: 0 },
          data: {
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            range: "Sales!A1:E1000",
            keyColumn: "Reference",
            pollIntervalSeconds: 300,
          },
        },
        {
          id: "customer",
          type: "QBO_FIND_CUSTOMER",
          name: "Find the customer",
          position: { x: 280, y: 0 },
          data: {
            variableName: "customer",
            displayName: "{{row.fields.Customer}}",
            email: "{{row.fields.Email}}",
          },
        },
        {
          id: "known",
          type: "CONDITION",
          name: "Already a customer?",
          position: { x: 560, y: 0 },
          data: {
            left: "{{customer.found}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "new-customer",
          type: "QBO_CREATE_CUSTOMER",
          name: "Create the customer",
          position: { x: 840, y: 120 },
          data: {
            variableName: "created",
            displayName: "{{row.fields.Customer}}",
            email: "{{row.fields.Email}}",
          },
        },
        {
          id: "resolve",
          type: "SET",
          name: "Whichever customer we have",
          position: { x: 1120, y: 0 },
          data: {
            // The two branches meet here so the receipt node exists once. A
            // second copy on the other branch is a second thing to keep in
            // step, and they drift.
            mappings: [
              {
                key: "qboCustomerId",
                value:
                  "{{#if customer.found}}{{customer.customerId}}{{else}}{{created.customerId}}{{/if}}",
              },
            ],
          },
        },
        {
          id: "receipt",
          type: "QBO_CREATE_SALES_RECEIPT",
          name: "File the receipt",
          position: { x: 1400, y: 0 },
          data: {
            variableName: "receipt",
            customerId: "{{qboCustomerId}}",
            lines:
              '[{"description":"{{row.fields.Description}}","amount":"{{row.fields.Amount}}"}]',
            depositToAccountId: "REPLACE_WITH_DEPOSIT_ACCOUNT_ID",
            customerMemo: "Sheet reference {{row.fields.Reference}}",
          },
        },
      ],
      edges: [
        { source: "new-sale", target: "customer" },
        { source: "customer", target: "known" },
        { source: "known", target: "resolve", sourceHandle: "true" },
        { source: "known", target: "new-customer", sourceHandle: "false" },
        { source: "new-customer", target: "resolve" },
        { source: "resolve", target: "receipt" },
      ],
    },
  },
  {
    slug: "quickbooks-invoice-sync-to-sheet",
    name: "A live invoice log anyone can read",
    description:
      "Reference automation #15. Mirrors every new or updated QuickBooks invoice into a Google Sheet, matching on the invoice id so an update rewrites its own row instead of adding a second one. The result is a shareable, always-current invoice log for people without QuickBooks seats, and a clean source for a dashboard. PREREQUISITES: QuickBooks and Google credentials, an Intuit webhook subscribed to Invoice events, and a sheet whose headers include ID, Domain, Customer Name, Due Date. DEVIATIONS FROM THE SOURCE: the source describes appending or updating; this uses an upsert keyed on ID, which is the same intent stated precisely — an append-only sheet quietly grows a second row every time an invoice is paid. Total and Balance columns are added, because a log without them cannot answer the question people open it to ask.",
    category: "Finance",
    domain: "data",
    // QuickBooks to read, Sheets to mirror.
    tier: "library",
    tags: ["quickbooks", "sheets", "invoice", "sync", "reporting", "dashboard"],
    graph: {
      nodes: [
        {
          id: "invoice-event",
          type: "QBO_WEBHOOK_TRIGGER",
          name: "Invoice created or changed",
          position: { x: 0, y: 0 },
          data: {
            entities: ["Invoice"],
            operations: ["Create", "Update"],
          },
        },
        {
          id: "detail",
          type: "QBO_GET",
          name: "Fetch the invoice",
          position: { x: 300, y: 0 },
          data: {
            variableName: "invoice",
            entity: "Invoice",
            entityId: "{{qbo.entityId}}",
          },
        },
        {
          id: "mirror",
          type: "SHEETS_UPSERT",
          name: "Write the row",
          position: { x: 600, y: 0 },
          data: {
            variableName: "row",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Invoices",
            range: "Invoices!A:G",
            // Keyed on the QuickBooks id, so the second event for an invoice
            // finds the first event's row.
            matchColumn: "ID",
            matchValue: "{{qbo.entityId}}",
            values:
              '{"ID": "{{qbo.entityId}}", "Domain": "{{invoice.record.domain}}", "Customer Name": "{{invoice.record.CustomerRef.name}}", "Due Date": "{{invoice.record.DueDate}}", "Total": "{{invoice.record.TotalAmt}}", "Balance": "{{invoice.record.Balance}}", "Updated": "{{qbo.lastUpdated}}"}',
          },
        },
      ],
      edges: [
        { source: "invoice-event", target: "detail" },
        { source: "detail", target: "mirror" },
      ],
    },
  },
  {
    slug: "full-cycle-invoicing-airtable-stripe-qbo",
    name: "Approved deal to payment link, in one pass",
    description:
      "Reference automation #16. Takes a deal marked Approved for Invoicing in Airtable, makes sure the customer exists in both QuickBooks and Stripe, raises the QuickBooks invoice, creates a Stripe payment link for it, and writes the invoice number, the link and an Invoiced status back to the Airtable record. Quote to cash from one trigger. PREREQUISITES: an Airtable token with read and write record scopes; a QuickBooks credential; a Stripe secret key and an existing Stripe Price for the thing you sell. Airtable columns: Status, Customer, Email, Description, Amount, Last Modified, plus QuickBooks ID, Invoice Number and Payment Link for the write-back. DEVIATIONS FROM THE SOURCE: the source creates the payment link from the deal amount. Stripe payment links are built from a Price, not an arbitrary amount, so this points at a Price you configure — a link for a variable amount needs a Checkout Session, which is a different API. The QuickBooks invoice still carries the deal's real amount, so the invoice is right and the link is a fixed-price convenience; if your amounts vary per deal, invoice from here and send the payment link by hand.",
    category: "Finance",
    domain: "data",
    // Airtable, QuickBooks and Stripe.
    tier: "library",
    tags: [
      "invoice",
      "stripe",
      "quickbooks",
      "airtable",
      "quote-to-cash",
      "revops",
    ],
    featured: true,
    graph: {
      nodes: [
        {
          id: "approved",
          type: "AIRTABLE_TRIGGER",
          name: "Deal approved for invoicing",
          position: { x: 0, y: 0 },
          data: {
            baseId: "REPLACE_WITH_BASE_ID",
            tableId: "Deals",
            filterByFormula: '{Status} = "Approved for Invoicing"',
            modifiedField: "Last Modified",
            pollIntervalSeconds: 300,
          },
        },
        {
          id: "qbo-customer",
          type: "QBO_FIND_CUSTOMER",
          name: "Find in QuickBooks",
          position: { x: 280, y: -80 },
          data: {
            variableName: "customer",
            displayName: "{{record.fields.Customer}}",
            email: "{{record.fields.Email}}",
          },
        },
        {
          id: "known",
          type: "CONDITION",
          name: "Known to QuickBooks?",
          position: { x: 560, y: -80 },
          data: {
            left: "{{customer.found}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "new-customer",
          type: "QBO_CREATE_CUSTOMER",
          name: "Create in QuickBooks",
          position: { x: 840, y: 40 },
          data: {
            variableName: "created",
            displayName: "{{record.fields.Customer}}",
            email: "{{record.fields.Email}}",
          },
        },
        {
          id: "resolve",
          type: "SET",
          name: "Whichever customer we have",
          position: { x: 1120, y: -80 },
          data: {
            mappings: [
              {
                key: "qboCustomerId",
                value:
                  "{{#if customer.found}}{{customer.customerId}}{{else}}{{created.customerId}}{{/if}}",
              },
            ],
          },
        },
        {
          id: "stripe-customer",
          type: "STRIPE_FIND_OR_CREATE_CUSTOMER",
          name: "Find or create in Stripe",
          position: { x: 1400, y: -80 },
          data: {
            // Stripe has one node for both halves, which is why this side of
            // the graph is a single box and the QuickBooks side is four.
            variableName: "payer",
            email: "{{record.fields.Email}}",
            name: "{{record.fields.Customer}}",
          },
        },
        {
          id: "invoice",
          type: "QBO_CREATE_INVOICE",
          name: "Raise the invoice",
          position: { x: 1680, y: -80 },
          data: {
            variableName: "invoice",
            customerId: "{{qboCustomerId}}",
            lines:
              '[{"description":"{{record.fields.Description}}","amount":"{{record.fields.Amount}}"}]',
            email: "{{record.fields.Email}}",
            customerMemo: "Airtable deal {{record.id}}",
          },
        },
        {
          id: "link",
          type: "STRIPE_CREATE_PAYMENT_LINK",
          name: "Create the payment link",
          position: { x: 1960, y: -80 },
          data: {
            variableName: "link",
            priceId: "REPLACE_WITH_STRIPE_PRICE_ID",
            quantity: 1,
            metadata:
              '{"airtableRecord":"{{record.id}}","qboInvoice":"{{invoice.id}}"}',
          },
        },
        {
          id: "write-back",
          type: "AIRTABLE_UPDATE",
          name: "Write it back",
          position: { x: 2240, y: -80 },
          data: {
            variableName: "updated",
            baseId: "REPLACE_WITH_BASE_ID",
            tableId: "Deals",
            recordId: "{{record.id}}",
            fields:
              '{"Status": "Invoiced", "QuickBooks ID": "{{qboCustomerId}}", "Invoice Number": "{{invoice.docNumber}}", "Payment Link": "{{link.url}}", "Stripe Customer": "{{payer.id}}"}',
          },
        },
      ],
      edges: [
        { source: "approved", target: "qbo-customer" },
        { source: "qbo-customer", target: "known" },
        { source: "known", target: "resolve", sourceHandle: "true" },
        { source: "known", target: "new-customer", sourceHandle: "false" },
        { source: "new-customer", target: "resolve" },
        { source: "resolve", target: "stripe-customer" },
        { source: "stripe-customer", target: "invoice" },
        { source: "invoice", target: "link" },
        { source: "link", target: "write-back" },
      ],
    },
  },
  {
    slug: "quickbooks-invoice-from-airtable-order",
    name: "Confirmed sales orders become invoices",
    description:
      'Reference automation #17. Watches an Airtable sales-order table for orders marked Confirmed, creates the QuickBooks customer if the name is new, raises an invoice carrying the order\'s line items, and writes the invoice number and QuickBooks id back to the order so billing status is visible where the order lives. PREREQUISITES: an Airtable base on Pro or higher with the columns Status, Customer, Email, Line Items, Due Date and Last Modified, plus QuickBooks Invoice ID and Invoice Number for the write-back; and a QuickBooks credential. DEVIATIONS FROM THE SOURCE: the source uses a webhook fired from Airtable; this uses the Airtable trigger, because a polled read with a formula filter needs no automation configured on the Airtable side and reaches the same records. Line Items must hold a JSON array — [{"description":"...","amount":100}] — since a QuickBooks invoice line is an object and no single spreadsheet cell can express a list of them otherwise.',
    category: "Finance",
    domain: "data",
    // Airtable to watch and write back, QuickBooks to invoice.
    tier: "library",
    tags: ["quickbooks", "airtable", "invoice", "orders", "billing", "sales"],
    graph: {
      nodes: [
        {
          id: "confirmed",
          type: "AIRTABLE_TRIGGER",
          name: "Order confirmed",
          position: { x: 0, y: 0 },
          data: {
            baseId: "REPLACE_WITH_BASE_ID",
            tableId: "Sales Orders",
            filterByFormula: '{Status} = "Confirmed"',
            modifiedField: "Last Modified",
            pollIntervalSeconds: 300,
          },
        },
        {
          id: "customer",
          type: "QBO_FIND_CUSTOMER",
          name: "Find the customer",
          position: { x: 280, y: 0 },
          data: {
            variableName: "customer",
            displayName: "{{record.fields.Customer}}",
            email: "{{record.fields.Email}}",
          },
        },
        {
          id: "known",
          type: "CONDITION",
          name: "Already a customer?",
          position: { x: 560, y: 0 },
          data: {
            left: "{{customer.found}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "new-customer",
          type: "QBO_CREATE_CUSTOMER",
          name: "Create the customer",
          position: { x: 840, y: 120 },
          data: {
            variableName: "created",
            displayName: "{{record.fields.Customer}}",
            email: "{{record.fields.Email}}",
          },
        },
        {
          id: "resolve",
          type: "SET",
          name: "Whichever customer we have",
          position: { x: 1120, y: 0 },
          data: {
            mappings: [
              {
                key: "qboCustomerId",
                value:
                  "{{#if customer.found}}{{customer.customerId}}{{else}}{{created.customerId}}{{/if}}",
              },
            ],
          },
        },
        {
          id: "invoice",
          type: "QBO_CREATE_INVOICE",
          name: "Raise the invoice",
          position: { x: 1400, y: 0 },
          data: {
            variableName: "invoice",
            customerId: "{{qboCustomerId}}",
            // Triple braces: the cell holds a JSON array, and escaping it
            // would send QuickBooks the literal text of one.
            lines: "{{{record.fields.[Line Items]}}}",
            dueDate: "{{record.fields.[Due Date]}}",
            email: "{{record.fields.Email}}",
            customerMemo: "Order {{record.id}}",
          },
        },
        {
          id: "write-back",
          type: "AIRTABLE_UPDATE",
          name: "Write it back",
          position: { x: 1680, y: 0 },
          data: {
            variableName: "updated",
            baseId: "REPLACE_WITH_BASE_ID",
            tableId: "Sales Orders",
            recordId: "{{record.id}}",
            fields:
              '{"Status": "Invoiced", "QuickBooks Invoice ID": "{{invoice.id}}", "Invoice Number": "{{invoice.docNumber}}", "Invoice Total": "{{invoice.total}}"}',
          },
        },
      ],
      edges: [
        { source: "confirmed", target: "customer" },
        { source: "customer", target: "known" },
        { source: "known", target: "resolve", sourceHandle: "true" },
        { source: "known", target: "new-customer", sourceHandle: "false" },
        { source: "new-customer", target: "resolve" },
        { source: "resolve", target: "invoice" },
        { source: "invoice", target: "write-back" },
      ],
    },
  },
];
