import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { Client } from "pg";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const environmentPath = path.join(repositoryRoot, "backend", ".env");

const readDatabaseUrl = () => {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!fs.existsSync(environmentPath)) return null;
  const line = fs
    .readFileSync(environmentPath, "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith("DATABASE_URL="));
  if (!line) return null;
  return line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
};

const testDatabaseName = "sabalanerp_e2e";
const resetTestDatabase = async (admin) => {
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [testDatabaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${testDatabaseName}"`);
  await admin.query(`CREATE DATABASE "${testDatabaseName}"`);
};
const configuredUrl = readDatabaseUrl();
let localPgControl = null;
let localDatabaseDir = null;
let testUrl;

if (configuredUrl) {
  const sourceUrl = new URL(configuredUrl);
  if (!["127.0.0.1", "localhost"].includes(sourceUrl.hostname)) {
    throw new Error(
      "Local HR hiring browser tests refuse to derive a test database from a non-loopback PostgreSQL server.",
    );
  }

  testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${testDatabaseName}`;
  testUrl.searchParams.set("schema", "public");

  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await resetTestDatabase(admin);
  } finally {
    await admin.end();
  }
} else {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(
      "Set DATABASE_URL to a loopback test PostgreSQL server or use the Docker test command on this platform.",
    );
  }
  localDatabaseDir = path.join(
    repositoryRoot,
    ".scratch",
    "hr-hiring-e2e",
    "postgres-direct",
  );
  fs.mkdirSync(localDatabaseDir, { recursive: true });
  const postgresBin = path.join(
    repositoryRoot,
    "node_modules",
    "@embedded-postgres",
    "windows-x64",
    "native",
    "bin",
  );
  const initdb = path.join(postgresBin, "initdb.exe");
  localPgControl = path.join(postgresBin, "pg_ctl.exe");
  if (!fs.existsSync(path.join(localDatabaseDir, "PG_VERSION"))) {
    const passwordFile = path.join(
      repositoryRoot,
      ".scratch",
      "hr-hiring-e2e",
      "postgres-password.txt",
    );
    fs.writeFileSync(passwordFile, "postgres", "utf8");
    try {
      execFileSync(
        initdb,
        [
          "-D",
          localDatabaseDir,
          "--username=postgres",
          `--pwfile=${passwordFile}`,
          "--auth-host=scram-sha-256",
          "--encoding=UTF8",
        ],
        { stdio: "inherit" },
      );
    } finally {
      fs.rmSync(passwordFile, { force: true });
    }
  }
  execFileSync(
    localPgControl,
    [
      "-D",
      localDatabaseDir,
      "-o",
      "-p 55434 -h 127.0.0.1",
      "-w",
      "start",
    ],
    { stdio: "inherit" },
  );
  const admin = new Client({
    connectionString:
      "postgresql://postgres:postgres@127.0.0.1:55434/postgres",
  });
  await admin.connect();
  try {
    await resetTestDatabase(admin);
  } finally {
    await admin.end();
  }
  testUrl = new URL(
    `postgresql://postgres:postgres@127.0.0.1:55434/${testDatabaseName}?schema=public`,
  );
}

let exitCode = 1;
try {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, "node_modules", "@playwright", "test", "cli.js"),
      "test",
      "--config=playwright.hr-hiring.config.ts",
      ...process.argv.slice(2),
    ],
    {
      cwd: repositoryRoot,
      env: { ...process.env, DATABASE_URL: testUrl.toString() },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  exitCode = result.status ?? 1;
} finally {
  if (localPgControl && localDatabaseDir) {
    execFileSync(
      localPgControl,
      ["-D", localDatabaseDir, "-m", "fast", "-w", "stop"],
      { stdio: "inherit" },
    );
  }
}

process.exitCode = exitCode;
