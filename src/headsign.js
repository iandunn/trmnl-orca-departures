/**
 * Headsign clean-up, applied to every destination the board draws.
 *
 * Metro builds a headsign by concatenating the destination with the via-point and no separator, so
 * when the two name the same place the phrase arrives twice back to back: `Mount Baker Mount Baker
 * Transit Center`. That is not a fixture artefact — it is what OneBusAway returns, and it costs the
 * widest column on the sign to say nothing.
 *
 * Pure and source-agnostic on purpose: the renderer calls it, so a headsign is collapsed whether it
 * came from a fixture or from a live prediction, and the OneBusAway mapper does not have to remember
 * to do it.
 */

/**
 * Drops one copy of any phrase that repeats immediately after itself.
 *
 * **Only back-to-back repeats.** A word that merely appears twice is usually two different places —
 * `Seattle Pacific University Seattle Center W` names a university and a civic centre, and
 * `Rainier Beach Via Rainier Ave S` names a neighbourhood and the street reaching it. Collapsing
 * either would destroy the destination rather than shorten it, which is worse than the repetition.
 * Adjacency is what separates a stutter from a coincidence.
 *
 * Longest run first, then leftmost, so `A B A B` collapses to `A B` in one pass instead of matching
 * the inner `B A` pairing first and leaving a fragment behind.
 *
 * @param {string} headsign Trip headsign, as OneBusAway reports it.
 * @returns {string}
 */
export function collapseRepeatedPhrases( headsign ) {
	if ( typeof headsign !== 'string' ) {
		return '';
	}

	const words = headsign.trim().split( /\s+/ ).filter( Boolean );

	if ( words.length < 2 ) {
		return words.join( ' ' );
	}

	const compared = words.map( ( word ) => word.toLowerCase() );

	for ( let length = Math.floor( words.length / 2 ); length >= 1; length-- ) {
		for ( let start = 0; start + length * 2 <= words.length; start++ ) {
			const first = compared.slice( start, start + length ).join( ' ' );
			const second = compared.slice( start + length, start + length * 2 ).join( ' ' );

			if ( first === second ) {
				const collapsed = [
					...words.slice( 0, start + length ),
					...words.slice( start + length * 2 ),
				];

				// A three-fold repeat leaves another adjacent pair behind, so run again on the result.
				return collapseRepeatedPhrases( collapsed.join( ' ' ) );
			}
		}
	}

	return words.join( ' ' );
}
