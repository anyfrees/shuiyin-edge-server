import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  source = path.resolve(root, "../shuiyin-server/src/work-log/http-service.js"),
  target = path.resolve(root, "src/work-log/http-service.generated.js"),
  exportSource = path.resolve(root, "../shuiyin-server/src/work-log/export-core.js"),
  exportTarget = path.resolve(root, "src/work-log/export-core.generated.js");

fs.writeFileSync(target, fs.readFileSync(source));
fs.writeFileSync(exportTarget, fs.readFileSync(exportSource));
