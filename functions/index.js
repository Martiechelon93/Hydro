const {onSchedule} = require('firebase-functions/v2/scheduler');
const {setGlobalOptions} = require('firebase-functions/v2');
const admin = require('firebase-admin');
admin.initializeApp();
setGlobalOptions({region:'europe-west1',maxInstances:1});
const db=admin.firestore(), messaging=admin.messaging();
function nowInZone(timeZone){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date());
  const o={};for(const p of parts)o[p.type]=p.value;
  return {hour:Number(o.hour),minute:Number(o.minute),date:`${o.year}-${o.month}-${o.day}`};
}
exports.sendHydroReminders=onSchedule({schedule:'every 15 minutes',timeZone:'UTC'},async()=>{
  const snap=await db.collection('users').get(), now=Date.now(), jobs=[];
  for(const doc of snap.docs){
    const root=doc.data(), payload=root.payload||{}, prefs=payload.hydroPrefs||{};
    if(prefs.remOn===false)continue;
    let local;try{local=nowInZone(prefs.timezone||'Europe/Rome')}catch{local=nowInZone('UTC')}
    if(local.hour<8||local.hour>=22)continue;
    const interval=Math.max(30,Math.min(120,Number(prefs.interval)||60));
    const last=root.lastReminderAt?.toMillis?.()||0;
    if(now-last<interval*60000-60000)continue;
    const tokenSnap=await doc.ref.collection('pushTokens').get();
    const tokens=tokenSnap.docs.map(d=>({doc:d,token:d.data().token})).filter(x=>x.token);
    if(!tokens.length)continue;
    const today=(payload.data||{})[local.date]||[], total=today.reduce((s,x)=>s+(Number(x.ml)||0),0), goal=Number(payload.goal)||2000;
    if(total>=goal)continue;
    let body='È il momento di bere un po’ d’acqua.';
    if(total<goal*.4)body='Sei un po’ indietro con l’idratazione: bevi un po’ d’acqua 💧';
    else if(total>=goal*.75)body='Sei quasi al tuo obiettivo: ancora un po’ d’acqua 💧';
    for(const item of tokens){
      jobs.push(messaging.send({token:item.token,notification:{title:'Hydro 💧',body},data:{tag:'hydro-reminder',url:'https://martiechelon93.github.io/Hydro/'},webpush:{fcmOptions:{link:'https://martiechelon93.github.io/Hydro/'}}}).catch(async err=>{
        const code=err?.errorInfo?.code||'';
        if(code.includes('registration-token-not-registered')||code.includes('invalid-registration-token'))await item.doc.ref.delete().catch(()=>{});
      }));
    }
    jobs.push(doc.ref.set({lastReminderAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true}));
  }
  await Promise.all(jobs);
});
