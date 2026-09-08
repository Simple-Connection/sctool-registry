import { spawnSync } from "node:child_process";

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["./node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.json"]);
run(["--test", "./tests/localization.test.mjs"]);
