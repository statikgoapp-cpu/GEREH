/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { Blob, FormData } = require("node:buffer");

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:8100").replace(/\/+$/, "");
const TEST_IMAGE = process.env.SMOKE_TEST_IMAGE || "";
const AUTH_TOKEN = process.env.SMOKE_TEST_TOKEN || "";

const authHeaders = AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {};

async function getJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeaders, ...(options.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url} but got non-JSON response`);
  }
  return { res, json };
}

async function smoke() {
  console.log(`[smoke] base url: ${BASE_URL}`);

  const health = await getJson(`${BASE_URL}/api/health`);
  if (!health.res.ok || health.json?.ok !== true) {
    throw new Error(`/api/health failed: ${health.res.status}`);
  }
  console.log("[smoke] /api/health OK");

  const patterns = await getJson(`${BASE_URL}/api/patterns`);
  if (AUTH_TOKEN && (!patterns.res.ok || !Array.isArray(patterns.json))) {
    throw new Error(`/api/patterns failed: ${patterns.res.status}`);
  }
  if (!AUTH_TOKEN && patterns.res.status !== 401) {
    throw new Error(`/api/patterns should reject anonymous access: ${patterns.res.status}`);
  }
  console.log(AUTH_TOKEN ? `[smoke] authenticated /api/patterns OK (${patterns.json.length} items)` : "[smoke] anonymous /api/patterns rejected");

  if (!TEST_IMAGE) {
    console.log("[smoke] upload test skipped (set SMOKE_TEST_IMAGE to enable)");
    return;
  }

  const full = path.resolve(TEST_IMAGE);
  if (!fs.existsSync(full)) {
    throw new Error(`SMOKE_TEST_IMAGE not found: ${full}`);
  }

  const fileBuffer = fs.readFileSync(full);
  const form = new FormData();
  form.append("image", new Blob([fileBuffer]), path.basename(full));
  form.append("category", "pattern");
  form.append("normalizeStones", "false");

  const createRes = await fetch(`${BASE_URL}/api/patterns`, {
    method: "POST",
    body: form,
    headers: authHeaders,
  });
  const createText = await createRes.text();
  if (!createRes.ok) {
    throw new Error(`upload failed: ${createRes.status} ${createText}`);
  }
  let created = null;
  try {
    created = JSON.parse(createText);
  } catch {
    throw new Error("upload response is not JSON");
  }
  if (!created?.id) {
    throw new Error("upload response missing id");
  }
  console.log(`[smoke] upload OK (pattern id=${created.id})`);
}

smoke()
  .then(() => {
    console.log("[smoke] all checks passed");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[smoke] failed:", err.message);
    process.exit(1);
  });
