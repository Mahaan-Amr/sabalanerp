/** Data-only result projection after actual original child and lease closure. */
export function closedReadOnlyObservationPassed({prerequisitesPassed,originalChildren,leaseClosed,failure}){
 return prerequisitesPassed===true&&originalChildren?.allOriginalChildrenClosed===true&&originalChildren?.interrupted===false&&leaseClosed===true&&!failure;
}
