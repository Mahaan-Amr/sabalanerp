import {candidateProvisionPayload} from './protectedCandidateProvision';
import type {SyntheticOwner} from './protectedCandidateSyntheticOwner';

/** Builds only a private, test-only payload for the existing provisioner.
 * The caller must independently prove that the UUID database and OID are its
 * own; this function does not create anything or establish authority. */
export function nativeStageProvisionPayload(checkout:string,root:string,databaseName:string,identity:string,owner:SyntheticOwner,manifest:Readonly<Record<string,string>>):string{
 if(!/^\d+:\d+$/.test(identity))throw Error('NATIVE_STAGE_FIXTURE_IDENTITY_UNPROVEN');
 if(!manifest['dist/services/__tests__/protectedCandidateNativeStageDriver.js']||!manifest['fixture/native-stage-sequence.cjs'])throw Error('NATIVE_STAGE_DRIVER_UNPINNED');
 const value=JSON.parse(candidateProvisionPayload(checkout,root,databaseName,owner,manifest));
 value.configuration.identity=identity;
 return JSON.stringify(value);
}
