/**
 * Route short name to badge text.
 *
 * The badge is a fixed 152px slot — holding it fixed is what keeps the destination column in the
 * same place across modes and densities — so what goes in it has to be short. OneBusAway's
 * `shortName` mostly is: 337 of the region's 393 routes are three characters or fewer.
 *
 * Pure, and called by the renderer rather than a data mapper, so it applies to live predictions and
 * fixtures alike.
 */

/**
 * What an official route designation looks like: a number, a number with an express suffix, or a
 * single letter.
 *
 * The slot holds a designation, never a name — fitting is necessary but not sufficient. `STCL` and
 * `TA034` are short enough to draw and still do not belong there: they read as an code rather than
 * as the route a rider asks for, so they go to the destination with the other word-named routes.
 *
 * Checked against all 393 routes in the region: this keeps 337 — every numbered route, `9X` on
 * Intercity Transit, and the 11 single letters the `Line` rule produces — and moves 17.
 */
const OFFICIAL_DESIGNATION = /^(\d+[A-Za-z]?|[A-Za-z])$/;

/**
 * Drops the word `Line` from a route whose name is a single character plus it, and blanks anything
 * that will not fit the slot.
 *
 * Verified against all 11 agencies' route lists, 2026-08-01: this is exactly 13 routes, and they are
 * the ones a Seattle sign is most likely to show — all eight RapidRide lines (`A Line` … `H Line`),
 * both Link lines (`1 Line`, `2 Line`), Tacoma Link (`T Line`) and both Sounder lines (`N Line`,
 * `S Line`). Metro and Sound Transit both badge these as the bare letter or digit on their own
 * signage, so this matches the printed convention rather than inventing an abbreviation.
 *
 * **The slot holds an official designation or nothing.** Seventeen routes are named rather than
 * numbered — `Swift Blue`, `Monorail`, `First Hill Streetcar`, `Waterfront Shuttle`, `Trailhead
 * Direct Issaquah Alps`, and codes like `STCL` and `TA034` — and 39 more have no `shortName` at all,
 * every Washington State Ferries route and Amtrak Cascades among them. All of those return an empty
 * string, and the renderer leaves the slot blank.
 *
 * A blank slot on its own would lose the route identity, so `destinationWithRoute()` puts the name
 * back at the head of the destination instead. The alternatives were weighed and lost: shrinking the
 * font only reaches about five characters, widening the badge breaks the fixed destination column,
 * and initials would invent signage nobody prints — three Sound Transit routes are all named
 * `Shuttle`, so they would collide as well as mislead.
 *
 * @param {string} shortName Route short name, as OneBusAway reports it.
 * @returns {string} Badge text, or empty when nothing sensible fits.
 */
export function routeBadge( shortName ) {
	if ( typeof shortName !== 'string' ) {
		return '';
	}

	const name = shortName.trim();
	const line = name.match( /^([A-Za-z0-9]) Line$/ );
	const label = line ? line[ 1 ] : name;

	return OFFICIAL_DESIGNATION.test( label ) ? label : '';
}

/**
 * A `longName` that is two place names rather than a service name.
 *
 * Every Washington State Ferries route is shaped this way — `Bainbridge Island - Seattle`,
 * `Tahlequah - Point Defiance` — because a ferry route *is* its endpoints. Putting that in front of
 * a destination produces `Bainbridge Island - Seattle: To Seattle`, which restates the destination
 * and says nothing. Amtrak Cascades is the one route with no short name whose `longName` is a real
 * service name, and it is exactly the case worth surfacing.
 */
const ENDPOINT_PAIR = /\s+-\s+/;

const trimmed = ( value ) => ( typeof value === 'string' ? value.trim() : '' );

/**
 * Puts the route back at the head of its destination when the badge slot is blank.
 *
 * `Swift Blue: Shoreline North/185th Station` reads as one line and costs no layout — the row is the
 * only place left with horizontal room, and the alternative was a row that says where a vehicle goes
 * without saying which vehicle.
 *
 * Three cases, in order:
 *
 * - **The route has a badge.** Nothing is added; repeating the designation would be noise.
 * - **The route is named rather than numbered.** The name goes in front: `Swift Blue`, `Monorail`,
 *   `STCL`.
 * - **The route has no short name at all**, which is every ferry route and Amtrak Cascades. The
 *   `longName` is used instead, but only when it reads as a service name — `Amtrak Cascades:
 *   Portland` is worth saying, and a ferry's endpoint pair is not.
 *
 * The separator is a colon rather than a middle dot or an em dash: it is ASCII, so it cannot depend
 * on a glyph the subsetted font might not carry, and it reads as "this route, going here".
 *
 * @param {string} shortName   Route short name, as OneBusAway reports it.
 * @param {string} routeName   Route long name, used only when there is no short name.
 * @param {string} destination Trip headsign, already collapsed.
 * @returns {string}
 */
export function destinationWithRoute( shortName, routeName, destination ) {
	const short = trimmed( shortName );

	if ( ! short ) {
		const long = trimmed( routeName );

		return long && ! ENDPOINT_PAIR.test( long ) ? `${ long }: ${ destination }` : destination;
	}

	if ( routeBadge( short ) ) {
		return destination;
	}

	return `${ short }: ${ destination }`;
}
