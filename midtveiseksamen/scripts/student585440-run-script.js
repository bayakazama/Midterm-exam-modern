#!/usr/bin/env node
import fs from "fs";
import { co2 } from "@tgwf/co2";
import XLSX from "xlsx";
import fetch from "node-fetch";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

// --- Municipalities in Møre og Romsdal ---
const kommuner = [
  "alesund.kommune.no",
  "aukra.kommune.no",
  "aure.kommune.no",
  "averoy.kommune.no",
  "fjord.kommune.no",
  "giske.kommune.no",
  "gjemnes.kommune.no",
  "hareid.kommune.no",
  "heroy.kommune.no",
  "hustadvika.kommune.no",
  "kristiansund.kommune.no",
  "molde.kommune.no",
  "rauma.kommune.no",
  "sande-mr.kommune.no",
  "smola.kommune.no",
  "stranda.kommune.no",
  "sunndal.kommune.no",
  "sula.kommune.no",
  "sykkylven.kommune.no",
  "tingvoll.kommune.no",
  "ulstein.kommune.no",
  "vanylven.kommune.no",
  "vestnes.kommune.no",
  "volda.kommune.no",
  "orsta.kommune.no",
];

const BASE_DIR = "../data/kommune";

// --- Setup ---
const oneByte = new co2({ model: "1byte" });
const swd = new co2();

// --- Helpers ---
function readJSON(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// --- Green hosting and carbon.txt checks ---
async function hasCarbonTxt(domain) {
  try {
    const res = await fetch(`https://${domain}/carbon.txt`, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

async function checkGreenHosting(domain) {
  try {
    const response = await fetch(`https://api.thegreenwebfoundation.org/greencheck/${domain}`);
    const data = await response.json();
    return data.green || false;
  } catch {
    return false;
  }
}

// --- Automatically run Lighthouse if JSONs missing ---
async function runLighthouseIfMissing(domain, basePath) {
  const runPaths = [1, 2, 3].map(
    (n) => `${basePath}/student585440-target-lhr-${n}.json`
  );


  console.log(` Running Lighthouse for ${domain}...`);
  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless", "--no-sandbox"] });
  const options = { logLevel: "error", output: "json", onlyCategories: ["performance"], port: chrome.port };

  for (let i = 0; i < 3; i++) {
    console.log(`    Run ${i + 1}...`);
const runnerResult = await lighthouse(`https://${domain}`, options);

// Save main report
fs.writeFileSync(runPaths[i], runnerResult.report, "utf8");

// Save trace and devtools logs
const artifacts = runnerResult.artifacts;
if (artifacts) {
  if (artifacts.DevtoolsLog) {
    fs.writeFileSync(runPaths[i].replace(".json", "-0.devtoolslog.json"),
      JSON.stringify(artifacts.DevtoolsLog, null, 2));
  }
  if (artifacts.Trace) {
    fs.writeFileSync(runPaths[i].replace(".json", "-0.trace.json"),
      JSON.stringify(artifacts.Trace, null, 2));
  }
}
  }

  await chrome.kill();
  console.log(` Saved Lighthouse reports for ${domain}`);
  return runPaths;
}

// --- Extract cache-control + initiator from DevTools log ---
function extractHeadersAndInitiators(devtoolsPath) {
  if (!fs.existsSync(devtoolsPath)) {
    console.warn(`Missing DevTools log: ${devtoolsPath}`);
    return {};
  }

  const raw = readJSON(devtoolsPath);
  const events = Array.isArray(raw) ? raw : raw.log?.entries || raw.events || [];
  const data = {};

  for (const e of events) {
    const { method, params } = e;

    if (method === "Network.requestWillBeSent" && params.request?.url) {
      const url = params.request.url;
      data[url] = data[url] || {};
      data[url].initiator =
        params.initiator?.type ||
        params.initiator?.url ||
        params.initiator?.stack?.callFrames?.[0]?.url ||
        "";
    }

if (method === "Network.responseReceivedExtraInfo" && params.headers) {
  const cacheControl =
    params.headers["Cache-Control"] ||
    params.headers["cache-control"] ||
    "";
  const url =
    params?.associatedRequest?.url ||
    params?.responseHeadersText?.url ||
    params?.url ||
    "";

  // Attach the cache header directly to the resource URL if we can
  if (url) {
    data[url] = data[url] || {};
    data[url].cache_control = cacheControl;
  } else {
    // Fallback: keep old behavior (to not lose data entirely)
    const statusCode = params.statusCode || 0;
    data[`response_${statusCode}_${Math.random()}`] = {
      cache_control: cacheControl,
      status_code: statusCode,
    };
  }
}

    if (method === "Network.responseReceived" && params.response?.url) {
      const url = params.response.url;
      data[url] = data[url] || {};
      const headers = params.response.headers || {};
      if (!data[url].cache_control) {
        data[url].cache_control =
          headers["cache-control"] || headers["Cache-Control"] || "";
      }
    }
  }

  console.log(` Parsed ${Object.keys(data).length} entries from ${devtoolsPath}`);
  return data;
}

// --- Extract run-level metrics ---
function extractMetrics(lhrPath, iteration) {
  const lhr = readJSON(lhrPath);
  const audits = lhr.audits || {};
  const networkAudit = audits["network-requests"];
  const items = networkAudit?.details?.items || [];

if (items.length === 0) {
  console.warn(` No network-requests data found in ${lhrPath}`);
}


  const totalBytes = items.reduce((sum, i) => sum + (i.transferSize || 0), 0);
  const jsBytes = items
    .filter((i) => i.resourceType === "Script")
    .reduce((sum, i) => sum + (i.transferSize || 0), 0);

  const thirdParty = items.filter(
    (i) =>
      !i.url.includes("molde.kommune.no") &&
      !i.url.includes("mrfylke.no") &&
      !i.url.includes("localhost")
  );
  const thirdPartyBytes = thirdParty.reduce(
    (sum, i) => sum + (i.transferSize || 0),
    0
  );

  const mainThreadTime = audits["mainthread-work-breakdown"]?.numericValue || 0;
  const longTasksCount = audits["long-tasks"]?.details?.items?.length || 0;
  const largestLongTask =
    audits["long-tasks"]?.details?.items?.reduce(
      (max, t) => Math.max(max, t.duration),
      0
    ) || 0;

  return {
    iteration,
    run_filename: lhrPath,
    PerformanceScore_0_100: Math.round(lhr.categories.performance.score * 100),
    LCP_ms: audits["largest-contentful-paint"].numericValue,
    FCP_ms: audits["first-contentful-paint"].numericValue,
    TTFB_ms: audits["server-response-time"].numericValue,
    Requests: items.length,
    TotalBytes_B: totalBytes,
    TotalBytes_KB: +(totalBytes / 1024).toFixed(1),
    TBT_ms: audits["total-blocking-time"].numericValue,
    CLS: audits["cumulative-layout-shift"].numericValue,
    TTI_ms: audits["interactive"].numericValue,
    JSBytes_B: jsBytes,
    ThirdPartyBytes_B: thirdPartyBytes,
    NumberOfThirdPartyRequests: thirdParty.length,
    MainThreadTime_ms: mainThreadTime,
    LongTasksCount: longTasksCount,
    LargestLongTask_ms: largestLongTask,
    CO2_g_operational: oneByte.perByte(totalBytes),
    notes: `run ${iteration}`,
  };
}

// --- Cache summary helper ---
function generateCacheSummary(allRunsData, mainOrigin) {
  const summary = {};
  const seenUrls = new Set();

  let totalRequests = 0;
  let firstPartyCount = 0;
  let thirdPartyCount = 0;

  for (const [url] of Object.entries(allRunsData)) {
    try {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      const parsed = new URL(url);
      const hostname = parsed.hostname || "";
      if (!hostname || hostname.trim() === "") continue;

      const mainHost = new URL(mainOrigin).hostname.replace(/^www\./, "");
      const resourceHost = hostname.replace(/^www\./, "");
      const isFirstParty = resourceHost.endsWith(mainHost);

      totalRequests++;
      if (isFirstParty) firstPartyCount++;
      else thirdPartyCount++;

      if (!summary[hostname]) {
        summary[hostname] = {
          domain: hostname,
          total_requests: 0,
          first_party: 0,
          third_party: 0,
        };
      }

      const s = summary[hostname];
      s.total_requests++;
      if (isFirstParty) s.first_party++;
      else s.third_party++;
    } catch {
      // skip malformed URLs
    }
  }

  // Add overall totals
  summary["__TOTAL__"] = {
    domain: "TOTAL (all unique requests)",
    total_requests: totalRequests,
    first_party: firstPartyCount,
    third_party: thirdPartyCount,
    pct_first_party: +((firstPartyCount / totalRequests) * 100).toFixed(1),
    pct_third_party: +((thirdPartyCount / totalRequests) * 100).toFixed(1),
  };

  return Object.values(summary);
}



// --- Process each site ---
async function processSite(domain) {
  console.log(`\n Processing ${domain}...`);

  const isGreenHosted = await checkGreenHosting(domain);
  const hasCarbonFile = await hasCarbonTxt(domain);

  console.log(` Green hosting: ${isGreenHosted ? " Yes" : " No"}`);
  console.log(` carbon.txt present: ${hasCarbonFile ? " Yes" : " No"}`);

  const mainOrigin = `https://${domain}`;
  const basePath = `${BASE_DIR}/raw/${domain}`;

  fs.mkdirSync(`${BASE_DIR}/raw`, { recursive: true });
  fs.mkdirSync(basePath, { recursive: true });
  fs.mkdirSync(`${BASE_DIR}/processed`, { recursive: true });

  const runPaths = await runLighthouseIfMissing(domain, basePath);

  const runs = runPaths.map((path, i) => extractMetrics(path, i + 1));
  const medianRun = {};
  for (const key of Object.keys(runs[0])) {
    if (typeof runs[0][key] === "number") {
      medianRun[key] = median(runs.map((r) => r[key]));
    }
  }
  medianRun.run_filename = "average (median)";
  medianRun.iteration = "average";
  runs.push(medianRun);
  const wsRuns = XLSX.utils.json_to_sheet(runs);

  const allRunsData = {};
  for (let i = 0; i < 3; i++) {
    const lhr = readJSON(runPaths[i]);
    const items = lhr.audits["network-requests"].details.items;
    const devtoolsPath = runPaths[i].replace(".json", "-0.devtoolslog.json");
    const headerData = extractHeadersAndInitiators(devtoolsPath);

    items.forEach((it) => {
      const url = it.url;
      if (!allRunsData[url]) allRunsData[url] = { url };
      const suffix = `_run${i + 1}`;
      const origin = new URL(it.url).origin;
      const headerInfo = headerData[it.url] || {};
      const cache_control = headerInfo.cache_control || "";
      const initiator = headerInfo.initiator || it.initiatorType || "";
      const mainHost = new URL(mainOrigin).hostname.replace(/^www\./, "");
      const resourceHost = new URL(it.url).hostname.replace(/^www\./, "");
      const first_or_third_party = 
      resourceHost.includes(mainHost) ? "first" : "third";


      allRunsData[url][`resourceType${suffix}`] = it.resourceType;
      allRunsData[url][`mimeType${suffix}`] = it.mimeType;
      allRunsData[url][`transferBytes${suffix}`] = it.transferSize || 0;
      allRunsData[url][`resourceBytes${suffix}`] = it.resourceSize || 0;
      allRunsData[url][`CO2_g_transfer${suffix}`] = oneByte.perByte(
        it.transferSize || 0
      );
      allRunsData[url][`origin${suffix}`] = origin;
      allRunsData[url][`first_or_third_party${suffix}`] = first_or_third_party;
      allRunsData[url][`cache_control${suffix}`] = cache_control;
      allRunsData[url][`status_code${suffix}`] = it.statusCode;
      allRunsData[url][`initiator${suffix}`] = initiator;
    });
  }

  const wsAllRuns = XLSX.utils.json_to_sheet(Object.values(allRunsData));

  // --- SUMMARY_BY_TYPE TAB ---
  const allResources = Object.values(allRunsData).flatMap((r) =>
    [1, 2, 3].map((n) => ({
      resourceType: r[`resourceType_run${n}`] || "other",
      transferBytes: r[`transferBytes_run${n}`] || 0,
      resourceBytes: r[`resourceBytes_run${n}`] || 0,
    }))
  );

  const summary = {};
  allResources.forEach((r) => {
    const t = r.resourceType || "other";
    if (!summary[t])
      summary[t] = { type: t, requests: 0, transferBytes: 0, resourceBytes: 0 };
    summary[t].requests++;
    summary[t].transferBytes += r.transferBytes;
    summary[t].resourceBytes += r.resourceBytes;
  });

  const summaryArr = Object.values(summary).map((s) => ({
    ...s,
    transferKB: +(s.transferBytes / 1024).toFixed(1),
    resourceKB: +(s.resourceBytes / 1024).toFixed(1),
    transferPct: +((s.transferBytes / runs[3].TotalBytes_B) * 100).toFixed(1),
    total_CO2_g: oneByte.perByte(s.transferBytes),
  }));
  const wsSummary = XLSX.utils.json_to_sheet(summaryArr);

  // --- MEDIAN_SUMMARY_BY_TYPE TAB (from the run closest to median) ---
  // Find which run is closest to the median total bytes
  const medianTotalBytes = runs[3].TotalBytes_B;
  let closestRunIndex = 0;
  let closestDiff = Math.abs(runs[0].TotalBytes_B - medianTotalBytes);
  for (let i = 1; i < 3; i++) {
    const diff = Math.abs(runs[i].TotalBytes_B - medianTotalBytes);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestRunIndex = i;
    }
  }

  // Get the Lighthouse report for the closest run
  const medianLhr = readJSON(runPaths[closestRunIndex]);
  const medianItems = medianLhr.audits["network-requests"].details.items;

  // Build summary for median run only
  const medianSummary = {};
  medianItems.forEach((item) => {
    const t = item.resourceType || "other";
    if (!medianSummary[t]) {
      medianSummary[t] = { type: t, requests: 0, transferBytes: 0, resourceBytes: 0 };
    }
    medianSummary[t].requests++;
    medianSummary[t].transferBytes += item.transferSize || 0;
    medianSummary[t].resourceBytes += item.resourceSize || 0;
  });

  const medianSummaryArr = Object.values(medianSummary).map((s) => ({
    ...s,
    transferKB: +(s.transferBytes / 1024).toFixed(1),
    resourceKB: +(s.resourceBytes / 1024).toFixed(1),
    transferPct: +((s.transferBytes / medianTotalBytes) * 100).toFixed(1),
    total_CO2_g: oneByte.perByte(s.transferBytes),
  }));
  const wsMedianSummary = XLSX.utils.json_to_sheet(medianSummaryArr);

  // --- CO2 TAB ---
  const co2Sheet = runs.slice(0, 3).map((r, i) => ({
    iteration: i + 1,
    TotalBytes_B: r.TotalBytes_B,
    CO2_g_OneByte: oneByte.perByte(r.TotalBytes_B),
    CO2_g_SWD: swd.perByte(r.TotalBytes_B),
  }));
  co2Sheet.push({
    iteration: "median",
    TotalBytes_B: median(co2Sheet.map((r) => r.TotalBytes_B)),
    CO2_g_OneByte: median(co2Sheet.map((r) => r.CO2_g_OneByte)),
    CO2_g_SWD: median(co2Sheet.map((r) => r.CO2_g_SWD)),
  });
  const wsCO2 = XLSX.utils.json_to_sheet(co2Sheet);

  // --- Hosting info tab ---
  const hostingSheet = [
    { property: "domain", value: domain },
    { property: "green_hosted", value: isGreenHosted ? "Yes" : "No" },
    { property: "carbon_txt_found", value: hasCarbonFile ? "Yes" : "No" },
    { property: "date_processed", value: new Date().toISOString() },
  ];
  const wsHosting = XLSX.utils.json_to_sheet(hostingSheet);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsRuns, "runs");
  XLSX.utils.book_append_sheet(wb, wsAllRuns, "per_resource_all_runs");
  XLSX.utils.book_append_sheet(wb, wsSummary, "summary_by_type");
  XLSX.utils.book_append_sheet(wb, wsMedianSummary, "median_summary_by_type");
  XLSX.utils.book_append_sheet(wb, wsCO2, "co2");
  XLSX.utils.book_append_sheet(wb, wsHosting, "hosting_info");

  const cacheSummary = generateCacheSummary(allRunsData, mainOrigin);
  const wsCache = XLSX.utils.json_to_sheet(cacheSummary);
  XLSX.utils.book_append_sheet(wb, wsCache, "cache_summary");

  const outputPath = `${BASE_DIR}/processed/${domain}-spreadsheet.xlsx`;
  XLSX.writeFile(wb, outputPath);
  console.log(` Created ${outputPath}`);
}

// --- Run all sites ---
(async () => {
  for (const domain of kommuner) {
    try {
      await processSite(domain);
    } catch (err) {
      console.error(`Error processing ${domain}:`, err.message);
    }
  }
  console.log("\n All spreadsheets generated successfully!");
})();
