// Shared by the offline catalog scripts (and their tests).

/** A catalog entry: the region's names, group and box, and its manifest with absolute part addresses. */
export function entryFor(region, manifest, prefix) {
  return {
    id: region.id,
    name: region.name,
    group: region.group,
    countries: region.countries ?? [],
    bbox: manifest.bbox,
    web: false,
    manifest: {
      ...manifest,
      name: region.name.en,
      files: manifest.files.map((f) => ({ ...f, parts: f.parts.map((p) => ({ ...p, path: /^https?:/.test(p.path) ? p.path : `${prefix}${p.path}` })) })),
    },
  };
}

/**
 * The catalog: the entries built now, then those of the last catalog that were not rebuilt (their
 * files are still on the release), in the order of regions.json, leaving out regions no longer
 * listed.
 */
export function mergeCatalog(regions, fresh, previous) {
  const byId = new Map();
  for (const e of previous?.packs ?? []) byId.set(e.id, e);
  for (const e of fresh) byId.set(e.id, e);
  const packs = [];
  for (const r of regions) {
    const e = byId.get(r.id);
    if (!e) continue;
    // Names and groups follow regions.json even for entries kept from before.
    packs.push({ ...e, name: r.name, group: r.group, countries: r.countries ?? e.countries ?? [] });
  }
  return { v: 1, built: new Date().toISOString(), packs };
}

/**
 * The catalog as published with the site: packs marked `site` in regions.json are copied next to
 * it (any browser can download them there), with addresses relative to it; the rest keep their
 * release addresses (the Android app downloads those).
 */
export function siteCatalog(catalog, regions, local) {
  const site = new Set(regions.filter((r) => r.site).map((r) => r.id));
  return {
    ...catalog,
    packs: catalog.packs.map((e) => {
      if (!site.has(e.id) || !local.has(e.id)) return { ...e, web: false };
      return {
        ...e,
        web: true,
        manifest: { ...e.manifest, files: e.manifest.files.map((f) => ({ ...f, parts: f.parts.map((p) => ({ ...p, path: `${e.id}/${p.path.split('/').pop()}` })) })) },
      };
    }),
  };
}
