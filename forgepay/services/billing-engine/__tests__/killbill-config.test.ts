/**
 * Static checks on the billing engine's real config files.
 *
 * The previous version of this file asserted on objects the test itself
 * defined, so it passed while Kill Bill could not start: an entrypoint for a
 * killbill.jar the image doesn't have, ${VAR} placeholders Kill Bill never
 * expands, a catalog that failed Kill Bill's own validation, and a payment
 * plugin name nothing registered. These guard each of those.
 *
 * The catalog was validated against a running Kill Bill 0.24.10
 * (POST /1.0/kb/catalog/xml/validate); these checks keep the properties that
 * validation depended on.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf-8');

const properties = read('config/killbill.properties');
const catalog = read('config/catalog/forgepay-base-catalog.xml');
const dockerfile = read('Dockerfile');
const pom = read('forgepay-plugin/pom.xml');
const pluginSource = read('forgepay-plugin/src/main/java/io/forgepay/killbill/HyperswitchPaymentPluginApi.java');

const settings = Object.fromEntries(
  properties.split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

describe('killbill.properties', () => {
  it('contains no ${VAR} placeholders (Kill Bill does not expand them)', () => {
    for (const [k, v] of Object.entries(settings)) expect(v, k).not.toMatch(/\$\{/);
  });

  it('holds no database credentials (they come from KB_* environment variables)', () => {
    expect(settings['org.killbill.dao.password']).toBeUndefined();
    expect(settings['org.killbill.billing.osgi.dao.password']).toBeUndefined();
  });

  it('names the payment plugin the bundle actually registers', () => {
    const registered = pluginSource.match(/PLUGIN_NAME = "([^"]+)"/)?.[1];
    expect(registered).toBe('forgepay-hyperswitch');
    expect(settings['org.killbill.payment.plugin.name']).toBe(registered);
  });

  it('points the default catalog at where the Dockerfile puts it', () => {
    expect(settings['org.killbill.catalog.uri']).toBe('file:///var/lib/killbill/config/catalog/forgepay-base-catalog.xml');
    expect(dockerfile).toMatch(/COPY .*config\/catalog\/\s+\/var\/lib\/killbill\/config\/catalog\//);
  });
});

describe('Dockerfile', () => {
  it('keeps the stock image entrypoint (there is no killbill.jar to run)', () => {
    expect(dockerfile).not.toMatch(/ENTRYPOINT/);
    expect(dockerfile).not.toMatch(/killbill\.jar/);
  });

  it('installs the plugin jar the pom builds, where Kill Bill looks for Java plugins', () => {
    const artifact = pom.match(/<artifactId>(forgepay-[^<]+)<\/artifactId>/)?.[1];
    const version = pom.match(/<packaging>bundle<\/packaging>/) ? pom.match(/<version>([^<]+)<\/version>\s*<packaging>/)?.[1] : null;
    expect(artifact).toBeTruthy();
    expect(version).toBeTruthy();
    const jar = `${artifact}-${version}.jar`;
    expect(dockerfile).toContain(`/build/target/${jar}`);
    expect(dockerfile).toContain(`/var/lib/killbill/bundles/plugins/java/forgepay-hyperswitch/${version}/${jar}`);
  });

  it('writes killbill.properties where the image reads it', () => {
    expect(dockerfile).toMatch(/config\/killbill\.properties \/var\/lib\/killbill\/killbill\.properties/);
  });
});

describe('catalog', () => {
  const currencies = [...catalog.matchAll(/<currencies>([\s\S]*?)<\/currencies>/g)][0]![1]!
    .match(/<currency>([A-Z]{3})<\/currency>/g)!.map((c) => c.slice(10, 13));
  const plans = [...catalog.matchAll(/<plan name="([^"]+)">/g)].map((m) => m[1]!);
  const priceListPlans = [...catalog.matchAll(/<plans>\s*([\s\S]*?)<\/plans>/g)].pop()![1]!
    .match(/<plan>([^<]+)<\/plan>/g)!.map((p) => p.replace(/<\/?plan>/g, ''));

  it('uses product names without spaces (they must be XML NCNames)', () => {
    for (const m of catalog.matchAll(/<product name="([^"]+)">/g)) expect(m[1]).toMatch(/^[A-Za-z_][\w.-]*$/);
  });

  it('prices every plan only in the catalog currencies', () => {
    for (const m of catalog.matchAll(/<price><currency>([A-Z]{3})<\/currency>/g)) expect(currencies).toContain(m[1]);
  });

  it('lists every plan in the default price list, and nothing else', () => {
    expect([...priceListPlans].sort()).toEqual([...plans].sort());
  });

  it('has default change and cancel policy cases (Kill Bill rejects the catalog without them)', () => {
    const change = catalog.match(/<changePolicy>([\s\S]*?)<\/changePolicy>/)![1]!;
    const cancel = catalog.match(/<cancelPolicy>([\s\S]*?)<\/cancelPolicy>/)![1]!;
    const hasDefault = (block: string) =>
      [...block.matchAll(/<(?:change|cancel)PolicyCase>([\s\S]*?)<\/(?:change|cancel)PolicyCase>/g)]
        .some((c) => c[1]!.trim().startsWith('<policy>'));
    expect(hasDefault(change)).toBe(true);
    expect(hasDefault(cancel)).toBe(true);
  });
});
