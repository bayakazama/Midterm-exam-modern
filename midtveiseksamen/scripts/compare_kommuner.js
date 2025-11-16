#!/usr/bin/env node
import fs from "fs";
import path from "path";
import XLSX from "xlsx";

const dataPath = "../data/kommune/processed";

const kommuner = fs
  .readdirSync(dataPath)
  .filter((f) => f.endsWith("-spreadsheet.xlsx"));

const results = [];

for (const file of kommuner) {
  const wb = XLSX.readFile(path.join(dataPath, file));
  const site = file.replace("-spreadsheet.xlsx", "");

  // Extract median run (last row of "runs" sheet)
  const runs = XLSX.utils.sheet_to_json(wb.Sheets["runs"]);
  const medianRow = runs.find((r) => r.iteration === "average");

  // Extract cache summary data
  const cacheSheet = wb.Sheets["cache_summary"];
  const cacheData = XLSX.utils.sheet_to_json(cacheSheet);
  const totalRow = cacheData.find((r) => r.domain?.includes("TOTAL"));
  const thirdPartyPct = totalRow?.pct_third_party || 0;

  // Extract summary_by_type totals
  const summary = XLSX.utils.sheet_to_json(wb.Sheets["summary_by_type"]);
  
  // Extract median_summary_by_type (from the run closest to median)
  const medianSummary = XLSX.utils.sheet_to_json(wb.Sheets["median_summary_by_type"]);
  
  const totalBytes = medianRow?.TotalBytes_B || 0;
  const totalCO2 = medianRow?.CO2_g_operational || 0;
  const totalRequests = medianRow?.Requests || 0;
  const totalKB = medianRow?.TotalBytes_KB || 0;

  // Calculate total resource bytes (uncompressed) from aggregated summary
  const totalResourceBytes = summary.reduce((sum, row) => {
    return sum + ((row.resourceBytes || row.resourceKB * 1024) || 0);
  }, 0);

  const imageRow = medianSummary.find((r) => r.type === "Image") || {};
  const scriptRow = medianSummary.find((r) => r.type === "Script") || {};

  // Get image data from median run (not aggregated)
  const imagesKB = imageRow?.transferKB || 0;
  const imagesBytes = imageRow?.transferBytes || 0;

  // Compute metrics
  const bytesPerRequest = totalRequests > 0 ? +((totalBytes / totalRequests) / 1024).toFixed(1) : 0;
  const co2PerKB = totalKB > 0 ? +(totalCO2 / totalKB).toFixed(4) : 0;
  const imagePct = totalBytes > 0 ? +((imagesBytes / totalBytes) * 100).toFixed(1) : 0;
  const compressionRatio = totalResourceBytes > 0 ? +(totalBytes / totalResourceBytes).toFixed(2) : 0;

  results.push({
    Kommune: site,
    Performance: medianRow?.PerformanceScore_0_100 || 0,
    Requests: totalRequests,
    TotalBytes_KB: totalKB,
    KB_per_req: bytesPerRequest,
    CO2_g: totalCO2,
    CO2_per_KB: co2PerKB,
    Images_KB: imagesKB,
    ImagePct: imagePct,
    Scripts_KB: scriptRow?.transferKB || 0,
    CompressionRatio: compressionRatio,
    ThirdPartyPct: thirdPartyPct,

  LCP_ms: medianRow?.LCP_ms || 0,
  FCP_ms: medianRow?.FCP_ms || 0,
  TTFB_ms: medianRow?.TTFB_ms || 0,
  TBT_ms: medianRow?.TBT_ms || 0,
  CLS: medianRow?.CLS || 0,
  });
}

// Sort by performance score (descending)
results.sort((a, b) => b.Performance - a.Performance);

const outWb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(results);
XLSX.utils.book_append_sheet(outWb, ws, "kommuner_summary");

if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath, { recursive: true });
}

const outPath = path.join(dataPath, "ALL-KOMMUNER-COMPARISON.xlsx");
XLSX.writeFile(outWb, outPath);
console.log(`Created combined comparison at ${outPath}`);
