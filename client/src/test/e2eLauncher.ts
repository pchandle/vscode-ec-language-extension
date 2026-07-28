import { ChildProcess, execFileSync, spawn as nodeSpawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const DEFAULT_E2E_TIMEOUT_MS = 10 * 60 * 1000;

export type TestProfile = {
  root: string;
  userDataDir: string;
  extensionsDir: string;
};

export type SpawnProcess = (
  command: string,
  args: string[],
  options: Parameters<typeof nodeSpawn>[2]
) => ChildProcess;

export type E2eLaunchOptions = {
  executablePath: string;
  extensionDevelopmentPath: string;
  extensionTestsPath: string;
  timeoutMs: number;
  spawnProcess?: SpawnProcess;
  terminateProcessTree?: (processId: number) => void;
  createProfile?: () => TestProfile;
  removeProfile?: (profile: TestProfile) => void;
  terminateProfileProcesses?: (profile: TestProfile) => void;
};

export class E2eTimeoutError extends Error {
  constructor(timeoutMs: number, readonly profile: TestProfile) {
    super(`VS Code integration tests exceeded the ${Math.round(timeoutMs / 1000)}s timeout. Test profile retained at ${profile.root}`);
  }
}

export function parseE2eTimeout(value: string | undefined): number {
  if (!value) {
    return DEFAULT_E2E_TIMEOUT_MS;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_E2E_TIMEOUT_MS;
}

export function createTestProfile(): TestProfile {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "emergent-vscode-test-"));
  const userDataDir = path.join(root, "user-data");
  const extensionsDir = path.join(root, "extensions");
  fs.mkdirSync(userDataDir);
  fs.mkdirSync(extensionsDir);
  return { root, userDataDir, extensionsDir };
}

export function removeTestProfile(profile: TestProfile): void {
  fs.rmSync(profile.root, { recursive: true, force: true });
}

export function buildVsCodeTestArgs(
  extensionDevelopmentPath: string,
  extensionTestsPath: string,
  profile: TestProfile
): string[] {
  return [
    "--no-sandbox",
    "--disable-gpu-sandbox",
    "--disable-updates",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
    `--extensionTestsPath=${extensionTestsPath}`,
    `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
    `--extensions-dir=${profile.extensionsDir}`,
    `--user-data-dir=${profile.userDataDir}`,
  ];
}

export async function runVsCodeIntegrationTests(options: E2eLaunchOptions): Promise<void> {
  const profile = (options.createProfile ?? createTestProfile)();
  try {
    await runProcess(options, profile);
    (options.terminateProfileProcesses ?? terminateProfileProcesses)(profile);
    (options.removeProfile ?? removeTestProfile)(profile);
  } catch (error) {
    (options.terminateProfileProcesses ?? terminateProfileProcesses)(profile);
    console.error(`VS Code test profile retained at ${profile.root}`);
    throw error;
  }
}

async function runProcess(options: E2eLaunchOptions, profile: TestProfile): Promise<void> {
  const spawnProcess = options.spawnProcess ?? nodeSpawn;
  const child = spawnProcess(
    process.platform === "win32" ? `"${options.executablePath}"` : options.executablePath,
    buildVsCodeTestArgs(options.extensionDevelopmentPath, options.extensionTestsPath, profile),
    {
      env: process.env,
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
    }
  );

  child.stdout?.on("data", (data) => process.stdout.write(data));
  child.stderr?.on("data", (data) => process.stderr.write(data));

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let terminationGrace: NodeJS.Timeout | undefined;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (terminationGrace) {
        clearTimeout(terminationGrace);
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      error ? reject(error) : resolve();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        (options.terminateProcessTree ?? terminateProcessTree)(child.pid);
      }
      terminationGrace = setTimeout(() => finish(new E2eTimeoutError(options.timeoutMs, profile)), 15_000);
    }, options.timeoutMs);

    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (timedOut) {
        finish(new E2eTimeoutError(options.timeoutMs, profile));
      } else if (code === 0) {
        finish();
      } else {
        finish(new Error(`VS Code integration tests exited with ${code ?? signal ?? "an unknown status"}.`));
      }
    });
  });
}

export function terminateProcessTree(processId: number): void {
  if (process.platform === "win32") {
    const killer = nodeSpawn("taskkill", ["/pid", String(processId), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.unref();
    return;
  }
  try {
    process.kill(-processId, "SIGTERM");
    setTimeout(() => {
      try {
        process.kill(-processId, "SIGKILL");
      } catch {
        // The process group exited during the grace period.
      }
    }, 10_000).unref();
  } catch {
    // The process may have exited between the timeout and termination request.
  }
}

/** Removes detached Electron helpers (such as crashpad) scoped to one test profile. */
export function terminateProfileProcesses(profile: TestProfile): void {
  if (process.platform === "win32") {
    return;
  }
  try {
    const output = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
    const processIds = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(profile.root))
      .map((line) => Number(line.split(/\s+/, 1)[0]))
      .filter((processId) => Number.isInteger(processId) && processId > 0 && processId !== process.pid);
    for (const processId of processIds) {
      try {
        process.kill(processId, "SIGTERM");
      } catch {
        // The helper exited while the process list was being inspected.
      }
    }
  } catch {
    // Process inspection is unavailable in this environment.
  }
}
