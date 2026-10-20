import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {supportTicketStorageDirectory} from '../../backend/src/services/supportFileRuntime';

type BrowserSupportTicket={id:string;title:string;description:string;screenshotSha256:string;attachmentBytes:number;
  resourcePath:string;buildId:string;backendSlotId:string};
/** Original restored native application's own sole client and HTTP handlers.
 * Screenshots come from independently restored bytes; no re-render/regeneration. */
export async function verifyRestoredBrowserSupportTickets({db,base,headers,tickets,actorId}:{db:PrismaClient;base:string;
  headers:Record<string,string>;tickets:BrowserSupportTicket[];actorId:string}){
  assert.equal(tickets.length,2);assert.equal(new Set(tickets.map(value=>value.id)).size,2);
  assert.equal(new Set(tickets.map(value=>value.buildId)).size,2);
  assert.deepEqual(new Set(tickets.map(value=>value.backendSlotId)),new Set(['backend_native_a','backend_native_b']));
  const directory=supportTicketStorageDirectory();
  for(const expected of tickets){
    assert.match(expected.screenshotSha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(expected.attachmentBytes)&&expected.attachmentBytes>0);
    const match=/^\/api\/support-tickets\/attachments\/([a-z0-9]{20,32})\/download$/.exec(expected.resourcePath);assert.ok(match);
    const ticket=await db.supportTicket.findUniqueOrThrow({where:{id:expected.id},include:{entries:true,attachments:true}});
    assert.equal(ticket.reporterId,actorId);assert.equal(ticket.title,expected.title);
    const reports=ticket.entries.filter(value=>value.kind==='REPORT');assert.equal(reports.length,1);
    assert.equal(reports[0].authorId,actorId);assert.equal(reports[0].body,expected.description);
    assert.equal(ticket.attachments.length,1);const attachment=ticket.attachments[0];
    assert.equal(attachment.id,match[1]);assert.equal(attachment.ticketId,expected.id);assert.equal(attachment.kind,'IMAGE');
    assert.equal(attachment.mimeType,'image/png');assert.equal(attachment.sha256,expected.screenshotSha256);
    assert.equal(attachment.size,expected.attachmentBytes);assert.equal(attachment.deletedAt,null);assert.equal(attachment.redactedAt,null);
    assert.ok(attachment.storageName);assert.equal(path.basename(attachment.storageName),attachment.storageName);
    const bytes=fs.readFileSync(path.join(directory,attachment.storageName));
    assert.equal(bytes.length,expected.attachmentBytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.screenshotSha256);
    assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    const response=await fetch(base+expected.resourcePath+'?inline=true',{headers});assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type')?.split(';')[0],'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    const denied=await fetch(base+expected.resourcePath+'?inline=true');assert.equal(denied.status,401);await denied.arrayBuffer();
  }
  return {tickets:2,attachments:2,originalScreenshotBytes:true,actualRestoredHttpAuthorization:true};
}
