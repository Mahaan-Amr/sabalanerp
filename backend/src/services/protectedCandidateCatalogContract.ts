/** A MATCH applies only to the exact fields checked by a comparator; it does
 * not grant deployment authority. Missing semantic evidence is UNKNOWN. */
export type CatalogComparison='MATCH'|'MISMATCH'|'UNKNOWN';
export function combineCatalogComparisons(values:readonly CatalogComparison[]):CatalogComparison {
 if(!Array.isArray(values)||values.length===0||values.some(v=>v!=='MATCH'&&v!=='MISMATCH'&&v!=='UNKNOWN'))return 'UNKNOWN';
 if(values.includes('MISMATCH'))return 'MISMATCH';
 return values.includes('UNKNOWN')?'UNKNOWN':'MATCH';
}
