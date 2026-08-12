import { bootstrap } from "./bootstrap.mjs";
import { auditRepository } from "./validate.mjs";
import { compile } from "./compiler.mjs";
import { sync } from "./sync.mjs";
import { capabilityProbe } from "./capability.mjs";
import { validateAwards } from "./validate-awards.mjs";
import { auditProfile } from "./profile-audit.mjs";
import { auditRemoteLists } from "./remote-audit.mjs";
import { athensDate } from "./utils.mjs";

const [command, ...args] = process.argv.slice(2);
try {
  let result;
  if (command === "bootstrap") result = await bootstrap();
  else if (command === "audit") result = await auditRepository({ requireListIds: args.includes("--production") });
  else if (command === "compile") result = await compile({ allowPlaceholders: args.includes("--allow-placeholders") });
  else if (command === "sync") result = await sync({ execute: args.includes("--execute"), force: args.includes("--force") });
  else if (command === "capability-probe") result = await capabilityProbe();
  else if (command === "validate-awards") result = await validateAwards({ group: args.find((arg) => arg.startsWith("--group="))?.slice(8) ?? "all" });
  else if (command === "profile-audit") result = await auditProfile({ profileFile: args.find((arg) => arg.startsWith("--profile="))?.slice(10), artifactFile: args.find((arg) => arg.startsWith("--artifact="))?.slice(11), writeArtifacts: args.includes("--write-repair") });
  else if (command === "remote-audit") result = await auditRemoteLists({ execute: args.includes("--execute") });
  else if (command === "athens-guard") {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    result = { date: athensDate(), hour, run: hour === 4 }; if (!result.run) process.exitCode = 78;
  } else throw new Error("Usage: bootstrap|audit|compile|sync|remote-audit|capability-probe|validate-awards|profile-audit|athens-guard");
  // The sync report can contain thousands of rail records and is already
  // persisted to reports/latest.json. Keep CI/terminal output bounded.
  console.log(JSON.stringify(command === "sync" ? { date: result.date, mode: result.mode, totals: result.totals } : result, null, 2));
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
