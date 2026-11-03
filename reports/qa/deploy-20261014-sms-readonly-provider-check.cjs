(async()=>{
 const key=process.env.SMS_IR_API_KEY; const configuredBase=(process.env.SMS_IR_API_URL||'https://api.sms.ir/v1').replace(/\/+$/,''); if(configuredBase!=='https://api.sms.ir/v1'){console.log(JSON.stringify({readOnly:true,authenticated:false,reason:'CONFIGURED_PROVIDER_ENDPOINT_NOT_VERIFIED',smsSent:false}));process.exitCode=1;return;}
 if(!key){console.log(JSON.stringify({readOnly:true,authenticated:false,reason:'API_KEY_MISSING',smsSent:false}));process.exitCode=1;return;}
 const response=await fetch('https://api.sms.ir/v1/credit',{method:'GET',headers:{'X-API-KEY':key},redirect:'error',signal:AbortSignal.timeout(15000)});
 const body=await response.json();
 const authenticated=response.status===200&&body.status===1;
 const positiveCredit=authenticated&&typeof body.data==='number'&&Number.isFinite(body.data)&&body.data>0;
 console.log(JSON.stringify({checkedAt:new Date().toISOString(),readOnly:true,httpStatus:response.status,authenticated,positiveCredit,smsSent:false,templateApprovalRechecked:false,documentation:'https://sms.ir/rest-api/'}));
 if(!authenticated||!positiveCredit)process.exitCode=1;
})().catch(()=>{console.log(JSON.stringify({readOnly:true,authenticated:false,reason:'PROVIDER_READONLY_CHECK_FAILED',smsSent:false}));process.exitCode=1});
