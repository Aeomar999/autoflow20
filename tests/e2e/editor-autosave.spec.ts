import { expect, test } from "@playwright/test";

test.skip(
  !process.env.E2E_SERVER && !process.env.E2E_BASE_URL,
  "E2E requires a provisioned server (set E2E_SERVER=1 or E2E_BASE_URL)",
);

test("place 3 nodes, connect them, configure one, hard-refresh, everything is exactly as left", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // 1. Sign up
  const email = `test-${Date.now()}@gmail.com`;
  await page.goto("/signup");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password/i).fill("password123");
  await page.getByLabel(/confirm password/i).fill("password123");
  await page.getByRole("button", { name: /sign ?up/i }).click();

  // 2. Wait for redirect
  await page.waitForURL(url => url.pathname === "/" || url.pathname === "/workflows");
  if (page.url().endsWith("/")) {
    await page.goto("/workflows");
  }

  // 3. Create a new workflow
  await page.getByRole("button", { name: /create workflow|new workflow/i }).click();

  // 4. Wait for redirect to /workflows/:id
  await page.waitForURL(/\/workflows\/[a-zA-Z0-9_-]+/);

  // 5. Add 3 HTTP_REQUEST nodes
  for (let i = 0; i < 3; i++) {
    // Open node selector
    await page.getByRole('button', { name: /Add Node/i }).click();
    
    // Wait for the sheet to open
    await expect(page.getByRole("dialog")).toBeVisible();
    
    // Click the HTTP Request option
    // It's a button with the text "HTTP Request" inside it.
    await page.getByRole("button", { name: /HTTP Request/i, exact: false }).click();
    
    // Sheet should close
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }

  // 6. Wait a bit for nodes to be rendered
  await page.waitForTimeout(500);

  // The nodes will have data-id. Let's find all nodes of type HTTP_REQUEST
  const nodes = page.locator('.react-flow__node-HTTP_REQUEST');
  await expect(nodes).toHaveCount(3);
  
  // We also have the MANUAL_TRIGGER node by default
  const triggerNode = page.locator('.react-flow__node-MANUAL_TRIGGER');
  
  // Let's connect TRIGGER -> HTTP1 -> HTTP2 -> HTTP3
  // Function to connect two nodes
  async function connectNodes(sourceLoc: any, targetLoc: any) {
    const sourceHandle = sourceLoc.locator('.react-flow__handle-source').first();
    const targetHandle = targetLoc.locator('.react-flow__handle-target').first();
    
    await sourceHandle.dragTo(targetHandle);
  }

  const http1 = nodes.nth(0);
  const http2 = nodes.nth(1);
  const http3 = nodes.nth(2);

  await connectNodes(triggerNode, http1);
  await connectNodes(http1, http2);
  await connectNodes(http2, http3);

  // 7. Configure one node (http1)
  // Click the node to select it
  await http1.click();
  
  // Wait for the config panel to appear. It should have inputs based on HTTP_REQUEST schema
  // For HTTP_REQUEST, it has 'endpoint', 'method', etc.
  const urlInput = page.getByLabel(/endpoint/i);
  await expect(urlInput).toBeVisible();
  
  await urlInput.fill("https://example.com/api");
  
  // Wait for autosave to trigger (debounce is 1.5s, wait 3s)
  // We can look for the save status badge changing to "Saved" or just wait
  await page.waitForTimeout(3000);

  // 8. Hard-refresh the page
  await page.reload({ waitUntil: "networkidle" });

  // 9. Verify everything is exactly as left
  // Check 3 HTTP_REQUEST nodes exist
  await expect(page.locator('.react-flow__node-HTTP_REQUEST')).toHaveCount(3);
  
  // Check edges exist - React Flow edges have class .react-flow__edge
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  
  // Click http1 and verify config
  await page.locator('.react-flow__node-HTTP_REQUEST').nth(0).click();
  await expect(page.getByLabel(/endpoint/i)).toHaveValue("https://example.com/api");
});
