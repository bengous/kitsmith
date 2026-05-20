#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const PAYLOAD_FILENAMES = new Set(["router_init.js", "router_runtime.js", "tanstack_runner.js"]);

const KNOWN_MALICIOUS_SHA256 = new Set([
  "ab4fcadaec49c03278063dd269ea5eef82d24f2124a8e15d7b90f2fa8601266c",
  "2ec78d556d696e208927cc503d48e4b5eb56b31abc2870c2ed2e98d6be27fc96",
]);

export type SupplyChainProbeFinding = {
  readonly kind: "unexpected-payload-path" | "known-malicious-hash";
  readonly path: string;
  readonly hash?: string;
};

function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

export function isPayloadFilename(path: string): boolean {
  return PAYLOAD_FILENAMES.has(basename(path));
}

export function isKnownMaliciousPayloadHash(hash: string): boolean {
  return KNOWN_MALICIOUS_SHA256.has(hash);
}

export function isLegitimateTanStackPayloadPath(path: string): boolean {
  const segments = pathSegments(path);

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === "node_modules" && segments[index + 1] === "@tanstack") {
      return true;
    }
  }

  return false;
}

async function sha256File(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer();
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

async function scanDirectory(
  root: string,
  current: string,
  findings: SupplyChainProbeFinding[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const path = join(current, entry.name);

      if (entry.isDirectory()) {
        await scanDirectory(root, path, findings);
        return;
      }

      if (!entry.isFile() || !isPayloadFilename(path)) {
        return;
      }

      const displayPath = relative(root, path).replaceAll("\\", "/");
      if (!isLegitimateTanStackPayloadPath(path)) {
        findings.push({ kind: "unexpected-payload-path", path: displayPath });
      }

      const hash = await sha256File(path);
      if (isKnownMaliciousPayloadHash(hash)) {
        findings.push({ kind: "known-malicious-hash", path: displayPath, hash });
      }
    }),
  );
}

export async function scanSupplyChainPayloads(root: string): Promise<SupplyChainProbeFinding[]> {
  const findings: SupplyChainProbeFinding[] = [];
  await scanDirectory(root, root, findings);
  return findings.toSorted((left, right) => left.path.localeCompare(right.path));
}

if (import.meta.main) {
  const root = process.argv[2];
  if (root === undefined) {
    throw new Error("Usage: bun scripts/testing/supply-chain-probe.ts <project-root>");
  }

  const findings = await scanSupplyChainPayloads(root);
  if (findings.length > 0) {
    for (const finding of findings) {
      const hashSuffix = finding.hash === undefined ? "" : ` sha256=${finding.hash}`;
      console.error(`${finding.kind}: ${finding.path}${hashSuffix}`);
    }
    process.exit(1);
  }

  console.log("Supply-chain probe OK");
}
