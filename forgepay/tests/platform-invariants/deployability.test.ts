/**
 * Cross-service deployment guards.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this suite exists
 *
 * Three separate faults shipped to every service's green CI, each of which
 * stopped a container from starting:
 *
 *   1. Fastify 4 plugins registered against a Fastify 5 server. Registration
 *      threw FST_ERR_PLUGIN_VERSION_MISMATCH on the first line of app assembly.
 *      stablecoin-gateway and crypto-gateway were both unstartable.
 *
 *   2. Dockerfiles that never set NODE_ENV. Service config defaults it to
 *      'development', so the image crashed looking for the pino-pretty
 *      transport that `npm ci --omit=dev` does not install — and, worse, every
 *      production guard silently disengaged: fail-closed secret checks, CORS,
 *      and simulation refusals all key off NODE_ENV === 'production'.
 *
 *   3. `build` scripts that ran plain `tsc`, leaving .sql migrations out of
 *      dist/ while the Dockerfile ships only dist/.
 *
 * Every per-service suite passed throughout, because none of them built the
 * real app or looked at the image. The faults live in the seam between the
 * code and its deployment, and nothing was testing that seam.
 *
 * These checks are static on purpose. They read manifests rather than booting
 * containers, so they run in seconds in CI and cover all services at once
 * rather than the handful that happen to export a testable app factory.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'services');

interface Service {
  name: string;
  dir: string;
  pkg: Record<string, any>;
  dockerfile: string | null;
  isNode: boolean;
}

function loadServices(): Service[] {
  return readdirSync(SERVICES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const dir = join(SERVICES_DIR, e.name);
      const pkgPath = join(dir, 'package.json');
      const dfPath = join(dir, 'Dockerfile');
      const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null;
      return {
        name: e.name,
        dir,
        pkg,
        dockerfile: existsSync(dfPath) ? readFileSync(dfPath, 'utf8') : null,
        // A Node service for our purposes is one with a package.json and a
        // TypeScript source tree. Python services (pyproject.toml) and the
        // Kill Bill Java image are out of scope — NODE_ENV means nothing there.
        isNode: Boolean(pkg) && existsSync(join(dir, 'src')),
      };
    })
    .filter(s => s.pkg !== null) as Service[];
}

const services = loadServices();
const nodeServices = services.filter(s => s.isNode);

function major(range: string | undefined): number | null {
  if (!range) return null;
  const m = /(\d+)/.exec(range);
  return m ? Number(m[1]) : null;
}

function deps(s: Service): Record<string, string> {
  return { ...(s.pkg['dependencies'] ?? {}), ...(s.pkg['devDependencies'] ?? {}) };
}

it('finds the services to check', () => {
  expect(services.length).toBeGreaterThan(10);
  expect(nodeServices.length).toBeGreaterThan(10);
});

// ── 1. Fastify plugin compatibility ───────────────────────────────────────────

/**
 * Minimum plugin major that supports Fastify 5.
 *
 * A Fastify plugin declares the core versions it accepts, and registering one
 * built for Fastify 4 against a Fastify 5 instance throws immediately. This is
 * the table that would have caught both unbootable gateways.
 */
const FASTIFY5_MIN_PLUGIN_MAJOR: Record<string, number> = {
  '@fastify/helmet': 12,
  '@fastify/cors': 10,
  '@fastify/rate-limit': 10,
  '@fastify/jwt': 9,
  '@fastify/swagger': 9,
  '@fastify/swagger-ui': 5,
  '@fastify/multipart': 9,
  '@fastify/static': 8,
  '@fastify/websocket': 11,
  '@fastify/formbody': 8,
  '@fastify/under-pressure': 9,
  '@fastify/redis': 7,
  '@fastify/cookie': 10,
  'fastify-plugin': 5,
};

describe('Fastify plugins match the Fastify major', () => {
  const fastifyServices = nodeServices.filter(s => deps(s)['fastify']);

  it('has services on Fastify to check', () => {
    expect(fastifyServices.length).toBeGreaterThan(0);
  });

  it.each(fastifyServices.map(s => [s.name, s] as const))(
    '%s registers only plugins built for its Fastify major',
    (_name, service) => {
      const d = deps(service);
      const fastifyMajor = major(d['fastify']);
      if (fastifyMajor === null || fastifyMajor < 5) return; // table covers v5

      const mismatched = Object.entries(FASTIFY5_MIN_PLUGIN_MAJOR)
        .filter(([plugin, min]) => {
          const m = major(d[plugin]);
          return m !== null && m < min;
        })
        .map(([plugin, min]) => `${plugin}@${d[plugin]} needs >=${min} for Fastify ${fastifyMajor}`);

      expect(mismatched).toEqual([]);
    },
  );
});

// ── 2. Containers must declare production ─────────────────────────────────────

describe('Dockerfiles pin NODE_ENV', () => {
  // Only services whose code actually branches on it. A service that never
  // reads NODE_ENV is not made safer by setting it, and demanding it there
  // would be noise rather than a guard.
  function branchesOnProduction(s: Service): boolean {
    const srcDir = join(s.dir, 'src');
    if (!existsSync(srcDir)) return false;
    const stack = [srcDir];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) { stack.push(p); continue; }
        if (!entry.name.endsWith('.ts') || entry.name.includes('.test.')) continue;
        const src = readFileSync(p, 'utf8');
        if (/NODE_ENV'?\]?\s*===?\s*'production'/.test(src)) return true;
      }
    }
    return false;
  }

  const needsNodeEnv = nodeServices.filter(s => s.dockerfile && branchesOnProduction(s));

  it('has services with production guards to check', () => {
    expect(needsNodeEnv.length).toBeGreaterThan(0);
  });

  it.each(needsNodeEnv.map(s => [s.name, s] as const))(
    '%s sets NODE_ENV in its image, so its production guards actually apply',
    (_name, service) => {
      // Without this the container runs as a development build: fail-closed
      // secret checks fall back to defaults like the literal 'dev-secret',
      // CORS stops failing closed, and simulation refusals stop refusing.
      expect(service.dockerfile).toMatch(/ENV\s+NODE_ENV[=\s]+production/);
    },
  );
});

// ── 3. Migrations must reach the image ────────────────────────────────────────

describe('build output includes SQL migrations', () => {
  function hasSqlUnderSrc(s: Service): boolean {
    const srcDir = join(s.dir, 'src');
    if (!existsSync(srcDir)) return false;
    const stack = [srcDir];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) { stack.push(p); continue; }
        if (entry.name.endsWith('.sql')) return true;
      }
    }
    return false;
  }

  const withMigrations = nodeServices.filter(hasSqlUnderSrc);

  it('has services with migrations to check', () => {
    expect(withMigrations.length).toBeGreaterThan(0);
  });

  it.each(withMigrations.map(s => [s.name, s] as const))(
    '%s copies its .sql migrations into dist',
    (_name, service) => {
      // tsc emits only JavaScript. A Dockerfile that ships dist/ therefore
      // ships an image whose migrations are missing entirely.
      const build = service.pkg['scripts']?.['build'] ?? '';
      expect(build).toContain('.sql');
    },
  );
});

// ── 4. Logging transport must be installable ──────────────────────────────────

describe('pino-pretty is declared where it is used', () => {
  function usesPinoPretty(s: Service): boolean {
    const srcDir = join(s.dir, 'src');
    if (!existsSync(srcDir)) return false;
    const stack = [srcDir];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) { stack.push(p); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        if (readFileSync(p, 'utf8').includes('pino-pretty')) return true;
      }
    }
    return false;
  }

  const users = nodeServices.filter(usesPinoPretty);

  it('has services using pino-pretty to check', () => {
    expect(users.length).toBeGreaterThan(0);
  });

  it.each(users.map(s => [s.name, s] as const))(
    '%s declares pino-pretty rather than relying on a hoisted copy',
    (_name, service) => {
      // An undeclared transport resolves in a local node_modules and vanishes
      // in the image, so `npm run dev` and any non-production boot die on
      // "unable to determine transport target for pino-pretty".
      expect(Object.keys(deps(service))).toContain('pino-pretty');
    },
  );
});
