/** QA lifecycle only: retain the browser until the original proxy is drained. */
export async function closeRetainedInquiryBrowser({edge,tasks,contexts,browser}){
 let failure;
 try{
  edge.beginDrain();
  await new Promise((resolve,reject)=>edge.server.close(error=>error?reject(error):resolve()));
  while(tasks.size)await Promise.allSettled([...tasks]);
  await edge.assertDrained();
 }catch(error){failure=error;}finally{
  for(const context of contexts)try{await context.close();}catch(error){failure??=error;}
  if(browser)try{await browser.close();}catch(error){failure??=error;}
 }
 if(failure)throw failure;
}
