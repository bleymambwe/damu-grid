/* Illustrative FHIR R5 export of the demo's live state.
 * One BiologicallyDerivedProduct per unit on a facility's shelf, one SupplyRequest per suggested transfer.
 * Identifiers are synthetic; ISBT 128 product codes are deliberately not invented (text only).
 */
(function (root) {
  'use strict';
  const BASE_DATE = Date.UTC(2026, 9, 1);           // simulation day 0 = 1 October 2026
  const iso = day => new Date(BASE_DATE + day * 86400000).toISOString().slice(0, 10);
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  function locationRef(fac) { return { reference: `Location/${slug(fac.name)}`, display: fac.name }; }

  /** facilities: [{name}], rec: day record, i: facility index, groups: ['O-', ...] or null, L: shelf life */
  function bundleFor(facilities, rec, i, groups, L) {
    const day = rec.t, entries = [], fac = facilities[i];
    const shelf = groups ? (rec.pending ? rec.startG[i] : rec.endG[i]) : [(rec.pending ? rec.start[i] : rec.end[i])];
    let n = 0;
    shelf.forEach((byAge, g) => {
      for (let r = 1; r <= L; r++) {
        for (let u = 0; u < byAge[r]; u++) {
          n++;
          const grp = groups ? groups[g].replace('-', '-neg').replace('+', '-pos').toLowerCase() : 'all';
          const id = `${slug(fac.name)}-d${day}-${grp}-r${r}-${u + 1}`;
          const res = {
            resourceType: 'BiologicallyDerivedProduct',
            id,
            productCategory: { system: 'http://hl7.org/fhir/product-category', code: 'cells', display: 'Cells' },
            productCode: { text: 'Platelets (illustrative; ISBT 128 product code in production)' },
            productStatus: { system: 'http://hl7.org/fhir/biologicallyderived-product-status', code: 'available' },
            biologicalSourceEvent: { system: 'urn:damu-grid:synthetic-donation-id', value: id.toUpperCase() },
            expirationDate: iso(day + r),
            property: [{ type: { text: 'Storage location' }, valueString: fac.name }],
          };
          if (groups) res.property.unshift({ type: { text: 'ABO/RhD group' }, valueCodeableConcept: { text: groups[g] } });
          entries.push({ fullUrl: `urn:uuid:${id}`, resource: res });
        }
      }
    });
    const plan = rec.pending ? rec.plan : rec.done;
    plan.filter(e => e[0] === i || e[1] === i).forEach((e, k) => {
      const [from, to, r, c, why, g] = e;
      entries.push({
        fullUrl: `urn:uuid:sr-d${day}-${i}-${k}`,
        resource: {
          resourceType: 'SupplyRequest',
          id: `sr-d${day}-${from}-${to}-${k}`,
          status: rec.pending ? 'draft' : 'active',
          category: { text: why === 'rescue' ? 'Expiry rescue transfer' : 'Safety-level top-up' },
          item: { concept: { text: `Platelets${groups && g != null ? ' ' + groups[g] : ''}, ${r} day${r > 1 ? 's' : ''} of shelf life left` } },
          quantity: { value: c, unit: 'unit' },
          deliverFrom: locationRef(facilities[from]),
          deliverTo: locationRef(facilities[to]),
          occurrenceDateTime: iso(day + 1),
          authoredOn: iso(day),
          reason: [{ concept: { text: why === 'rescue' ? 'Units would expire at the sender before local demand uses them' : 'Receiver below its two-day safety level' } }],
        },
      });
    });
    return {
      resourceType: 'Bundle',
      type: 'collection',
      timestamp: `${iso(day)}T08:00:00Z`,
      meta: { tag: [{ system: 'urn:damu-grid', code: 'synthetic', display: 'Synthetic demo data' }] },
      total: entries.length,
      entry: entries,
    };
  }
  root.DamuFHIR = { bundleFor };
})(typeof self !== 'undefined' ? self : this);
