import * as assert from "assert";
import { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import * as fs from "fs";
import { PassThrough } from "stream";
import {
  buildVsCodeTestArgs,
  createTestProfile,
  DEFAULT_E2E_TIMEOUT_MS,
  E2eTimeoutError,
  parseE2eTimeout,
  runVsCodeIntegrationTests,
  TestProfile,
} from "./e2eLauncher";

class FakeChildProcess extends EventEmitter {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly pid = 4242;

  public exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit("exit", code, signal);
  }
}

function profileFactory(profiles: TestProfile[]): () => TestProfile {
  return () => {
    const profile = createTestProfile();
    profiles.push(profile);
    return profile;
  };
}

function launchOptions(child: FakeChildProcess, profiles: TestProfile[], timeoutMs = 1_000) {
  return {
    executablePath: "/test/code",
    extensionDevelopmentPath: "/test/extension",
    extensionTestsPath: "/test/tests",
    timeoutMs,
    createProfile: profileFactory(profiles),
    spawnProcess: () => child as unknown as ChildProcess,
  };
}

suite("VS Code E2E launcher", () => {
  test("builds isolated VS Code profile arguments", () => {
    const profile: TestProfile = { root: "/tmp/run", userDataDir: "/tmp/run/user-data", extensionsDir: "/tmp/run/extensions" };
    assert.deepEqual(buildVsCodeTestArgs("/extension", "/tests", profile), [
      "--no-sandbox",
      "--disable-gpu-sandbox",
      "--disable-updates",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
      "--extensionTestsPath=/tests",
      "--extensionDevelopmentPath=/extension",
      "--extensions-dir=/tmp/run/extensions",
      "--user-data-dir=/tmp/run/user-data",
    ]);
    assert.equal(parseE2eTimeout(undefined), DEFAULT_E2E_TIMEOUT_MS);
    assert.equal(parseE2eTimeout("250"), 250);
    assert.equal(parseE2eTimeout("invalid"), DEFAULT_E2E_TIMEOUT_MS);
  });

  test("creates a distinct profile for each sequential run", () => {
    const first = createTestProfile();
    const second = createTestProfile();
    try {
      assert.notEqual(first.root, second.root);
      assert.equal(fs.existsSync(first.userDataDir), true);
      assert.equal(fs.existsSync(second.extensionsDir), true);
    } finally {
      fs.rmSync(first.root, { recursive: true, force: true });
      fs.rmSync(second.root, { recursive: true, force: true });
    }
  });

  test("removes an isolated profile after a successful child exit", async () => {
    const child = new FakeChildProcess();
    const profiles: TestProfile[] = [];
    const terminatedProfiles: string[] = [];
    const run = runVsCodeIntegrationTests({
      ...launchOptions(child, profiles),
      terminateProfileProcesses: (profile) => terminatedProfiles.push(profile.root),
    });
    child.exit(0);
    await run;
    assert.equal(profiles.length, 1);
    assert.deepEqual(terminatedProfiles, [profiles[0].root]);
    assert.equal(fs.existsSync(profiles[0].root), false);
  });

  test("retains the profile after a failed child exit", async () => {
    const child = new FakeChildProcess();
    const profiles: TestProfile[] = [];
    const terminatedProfiles: string[] = [];
    const run = runVsCodeIntegrationTests({
      ...launchOptions(child, profiles),
      terminateProfileProcesses: (profile) => terminatedProfiles.push(profile.root),
    });
    child.exit(1);
    await assert.rejects(run, /exited with 1/);
    assert.equal(fs.existsSync(profiles[0].root), true);
    assert.deepEqual(terminatedProfiles, [profiles[0].root]);
    fs.rmSync(profiles[0].root, { recursive: true, force: true });
  });

  test("terminates a timed-out child and retains its profile", async () => {
    const child = new FakeChildProcess();
    const profiles: TestProfile[] = [];
    const terminated: number[] = [];
    const run = runVsCodeIntegrationTests({
      ...launchOptions(child, profiles, 1),
      terminateProcessTree: (processId) => {
        terminated.push(processId);
        child.exit(0);
      },
    });
    await assert.rejects(run, E2eTimeoutError);
    assert.deepEqual(terminated, [child.pid]);
    assert.equal(fs.existsSync(profiles[0].root), true);
    fs.rmSync(profiles[0].root, { recursive: true, force: true });
  });
});
