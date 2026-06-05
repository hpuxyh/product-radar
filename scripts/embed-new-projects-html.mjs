import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const htmlPath = path.join(root, "new-projects.html");
const manifestPath = path.join(root, "manifest.json");
const startMarker = '<script id="embedded-new-projects-data" type="application/json">';
const endMarker = "</script>";

function fail(message) {
  console.error(`[embed-new-projects-html] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(htmlPath)) fail("new-projects.html not found");
if (!fs.existsSync(manifestPath)) fail("manifest.json not found");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
const latest = (manifest.dates || []).find((entry) => (entry.reports || []).includes("new-projects"));
if (!latest) fail("manifest.json has no new-projects report");

const digestPath = path.join(root, "digests", latest.date, "new-projects.json");
if (!fs.existsSync(digestPath)) fail(`${path.relative(root, digestPath)} not found`);

const digest = JSON.parse(fs.readFileSync(digestPath, "utf-8"));
const payload = {
  dates: [{ date: latest.date, reports: latest.reports }],
  digests: { [latest.date]: digest },
};

const safeJson = JSON.stringify(payload).replaceAll("</", "<\\/");
const html = fs.readFileSync(htmlPath, "utf-8");
const start = html.indexOf(startMarker);
if (start === -1) fail("embedded data marker start not found");
const contentStart = start + startMarker.length;
const end = html.indexOf(endMarker, contentStart);
if (end === -1) fail("embedded data marker end not found");

const nextHtml = `${html.slice(0, contentStart)}\n${safeJson}\n${html.slice(end)}`;
fs.writeFileSync(htmlPath, nextHtml);
console.log(
  `[embed-new-projects-html] embedded ${digest.projects?.length ?? 0} projects for ${latest.date} into new-projects.html`,
);
