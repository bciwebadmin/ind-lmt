// functions/branchRouting.js
//
// ZIP -> branch inference for Bobcat of Indy.
//
// *** CURRENTLY DISABLED ON PURPOSE. Branch is assigned manually. ***
//
// `nearestBranchForZip` always returns null, so nothing auto-fills a branch on
// manual entry or intake. Callers already handle null (the UI shows no
// suggestion; intake leaves the field blank), so this is a supported state, not
// a broken one.
//
// Why it is empty rather than inherited:
//
// The Berry Material Handling fork (grandparent of this one) carried 276 explicit
// Kansas ZIPs and a 3-digit centroid table covering Kansas and its neighbours.
// Left in place, a lead with a Kansas, Missouri or Oklahoma ZIP resolved to
// "Wichita" or "Topeka" — branch names this deployment has never heard of. The
// lead then matched no routing entry and silently fell through to Unassigned,
// with a junk branch stored in Firestore. Nothing errored.
//
// Deleting the data is safer than keeping it until the real territory map
// exists, because wrong-but-confident is worse than absent.
//
// ---------------------------------------------------------------------------
// TO RE-ENABLE, when the territory map arrives from sales:
//
//   1. Fill BRANCH_LOCATIONS with each branch's real coordinates. The addresses
//      are below; they have NOT been geocoded, so do that rather than estimate.
//   2. Fill ZIP_TO_BRANCH from the territory map. This has to carry metro
//      Indianapolis explicitly — see the warning under ZIP_TO_BRANCH.
//   3. Fill ZIP3_CENTROIDS for IN, IL, OH, KY and MI.
//   4. Mirror every change into src/lib/branchRouting.js (identical except
//      for the export style — there is no shared build step).
//   5. Add territory assertions to scripts/test-helpers.mjs and run them under
//      plain node before trusting any of it.
// ---------------------------------------------------------------------------

// Branch yard addresses, as supplied by the dealership. Coordinates are
// deliberately absent — geocode these properly rather than estimating, since
// the centroid fallback is pure distance arithmetic.
//
//   Anderson        2075 E Co Rd 67, Anderson IN 46017
//   Columbus        21 N National Rd, Columbus IN 47203
//   Ellettsville    700 E Temperance St, Ellettsville IN 47429
//   Indy            2935 Bluff Rd, Indianapolis IN 46225
//   Indy North      4489 S Indianapolis Rd, Whitestown IN 46075   <- Boone County, NW of the city
const BRANCH_LOCATIONS = [];

// Curated 5-digit ZIP -> branch map, straight from the territory map.
//
// WARNING: Indy and Indy North are ~25 miles apart and both serve metro
// Indianapolis (461/462). Worse, Indy North (46075) shares the 460 prefix with
// Anderson (46017), so a 460 centroid sits between two branches. The distance
// fallback cannot tell them apart and would still return a branch, confidently.
// THIS MAP MUST CARRY METRO INDIANAPOLIS AND THE 460 BLOCK EXPLICITLY.
// Columbus (472) and Ellettsville (474) are far enough out that the centroid
// fallback is usable there.
const ZIP_TO_BRANCH = {};

// 3-digit ZIP centroids for the distance fallback. Indiana plus the border
// prefixes of Illinois, Ohio, Kentucky and Michigan when this is filled in.
const ZIP3_CENTROIDS = {};

function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the nearest branch to a given ZIP.
 *
 * Returns null while the tables above are empty, which is the current state —
 * branch is assigned by hand. The logic is left intact so that filling the
 * three tables is all that is needed to turn inference back on.
 *
 * @param {string|number} zip - 5-digit ZIP (first 3 digits used as fallback)
 * @param {string[]} [availableBranches] - Branch names from Settings. When
 *        provided, only these can be suggested. Pass the configured list;
 *        omitting it means "no constraint", which is rarely what you want.
 * @returns {{branch: string, distanceMiles: number}|null}
 */
function nearestBranchForZip(zip, availableBranches = null) {
  if (!zip) return null;
  const cleaned = String(zip).trim().replace(/[^0-9]/g, '');
  if (cleaned.length < 3) return null;

  // Direct 5-digit mapping
  if (cleaned.length >= 5) {
    const zip5 = cleaned.slice(0, 5);
    const directBranch = ZIP_TO_BRANCH[zip5];
    if (directBranch && (!availableBranches || availableBranches.includes(directBranch))) {
      return { branch: directBranch, distanceMiles: 0 };
    }
  }

  // Fallback: 3-digit centroid + Haversine distance
  const prefix = cleaned.slice(0, 3);
  const center = ZIP3_CENTROIDS[prefix];
  if (!center) return null;

  const candidates = availableBranches
    ? BRANCH_LOCATIONS.filter(b => availableBranches.includes(b.name))
    : BRANCH_LOCATIONS;
  if (candidates.length === 0) return null;

  let nearest = null;
  let nearestDist = Infinity;
  for (const branch of candidates) {
    const d = haversineDistanceMiles(center.lat, center.lng, branch.lat, branch.lng);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = branch.name;
    }
  }
  return { branch: nearest, distanceMiles: Math.round(nearestDist) };
}

module.exports = { nearestBranchForZip };
