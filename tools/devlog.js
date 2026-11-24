// Writes public/devlog.json (the landing page's Development progress) from the git history.
// Run by .github/workflows/deploy.yml on every push to main, so each shipped change shows up by itself;
// `npm run devlog` does the same locally. Which module a commit counts for and what kind of change it is
// come from readCommit() in public/logic/devlog.js. Only the summary line, time and short hash are published.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readCommit } from "../public/logic/devlog.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const SEP = "\u001e", END = "\u001d";
const raw = execFileSync("git", ["log", "--no-merges", "--reverse", `--format=${SEP}%h%n%aI%n%s%n%b${END}`, "--name-only"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });

const items = raw.split(SEP).filter(Boolean).map((chunk) => {
  const [head, tail = ""] = chunk.split(END);
  const [sha, at, subject, ...body] = head.split("\n");
  return readCommit({ sha, at, subject, body: body.join("\n"), files: tail.split("\n").map((f) => f.trim()).filter(Boolean) });
}).filter(Boolean);

const first = execFileSync("git", ["log", "--reverse", "--format=%aI"], { cwd: root, encoding: "utf8" }).split("\n")[0];
const out = { app: "our-journal-devlog", version: 1, generated: new Date().toISOString(), since: first.slice(0, 10), items };
writeFileSync(new URL("../public/devlog.json", import.meta.url), JSON.stringify(out));
console.log(`devlog.json: ${items.length} activities since ${out.since}`);
