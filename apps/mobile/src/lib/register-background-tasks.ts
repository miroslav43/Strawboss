/**
 * Side-effect imports: register TaskManager tasks before any React screen mounts.
 * Imported once from `app/_layout.tsx`.
 */
// #region agent log
fetch('http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abba4'},body:JSON.stringify({sessionId:'3abba4',location:'register-background-tasks.ts:top',message:'[H2/H5] side-effect register module entered',data:{},timestamp:Date.now()})}).catch(()=>{});
// #endregion
import './location';
// #region agent log
fetch('http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abba4'},body:JSON.stringify({sessionId:'3abba4',location:'register-background-tasks.ts:after-location',message:'[H2] ./location imported OK (TaskManager.defineTask for location did not throw)',data:{},timestamp:Date.now()})}).catch(()=>{});
// #endregion
import './background-sync';
// #region agent log
fetch('http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abba4'},body:JSON.stringify({sessionId:'3abba4',location:'register-background-tasks.ts:done',message:'[H2/H5] both side-effect modules loaded OK',data:{},timestamp:Date.now()})}).catch(()=>{});
// #endregion
