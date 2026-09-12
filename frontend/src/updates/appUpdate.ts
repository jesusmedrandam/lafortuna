const RELEASE_API='https://api.github.com/repos/jesusmedrandam/lafortuna/releases/latest';
const CACHE_KEY='sgb-latest-app-release-v1';
const CACHE_MS=6*60*60*1000;

interface GitHubReleaseAsset {
  name:string;
  browser_download_url:string;
  content_type?:string;
  size?:number;
}

interface GitHubRelease {
  tag_name:string;
  name?:string;
  html_url:string;
  body?:string|null;
  published_at?:string|null;
  assets:GitHubReleaseAsset[];
}

export interface AppUpdateInfo {
  currentVersion:string;
  latestVersion:string|null;
  updateAvailable:boolean;
  apkUrl:string|null;
  apkName:string|null;
  releaseUrl:string|null;
  notes:string|null;
  publishedAt:string|null;
  reason?:'NO_ANDROID'|'NO_RELEASE'|'NO_APK';
}

let runningCheck:Promise<AppUpdateInfo>|null=null;

function versionParts(value:string) {
  return value.replace(/^v/i,'').split(/[.+-]/).map((part)=>Number.parseInt(part,10)).map((part)=>Number.isFinite(part)?part:0);
}

export function isVersionNewer(candidate:string,current:string) {
  const left=versionParts(candidate);const right=versionParts(current);
  for(let index=0;index<Math.max(left.length,right.length);index+=1){
    const difference=(left[index]??0)-(right[index]??0);
    if(difference!==0)return difference>0;
  }
  return false;
}

function currentVersion(){
  try{return window.SGBAndroid?.getAppVersion?.()||'0.0.0';}catch{return'0.0.0';}
}

function fromRelease(release:GitHubRelease):AppUpdateInfo {
  const current=currentVersion();
  const latest=release.tag_name.replace(/^v/i,'');
  const apk=[...(release.assets??[])].sort((a,b)=>{
    const aPreferred=/sgb/i.test(a.name)?1:0;const bPreferred=/sgb/i.test(b.name)?1:0;
    return bPreferred-aPreferred;
  }).find((asset)=>asset.name.toLowerCase().endsWith('.apk'))??null;
  const newer=isVersionNewer(latest,current);
  return{
    currentVersion:current,latestVersion:latest,updateAvailable:newer&&Boolean(apk),
    apkUrl:apk?.browser_download_url??null,apkName:apk?.name??null,
    releaseUrl:release.html_url,notes:release.body??null,publishedAt:release.published_at??null,
    reason:newer&&!apk?'NO_APK':undefined,
  };
}

function cachedResult():AppUpdateInfo|null {
  try{
    const cached=JSON.parse(localStorage.getItem(CACHE_KEY)??'null') as {savedAt:number;value:AppUpdateInfo}|null;
    if(!cached||Date.now()-cached.savedAt>=CACHE_MS)return null;
    const installed=currentVersion();
    return{...cached.value,currentVersion:installed,updateAvailable:Boolean(cached.value.apkUrl&&cached.value.latestVersion&&isVersionNewer(cached.value.latestVersion,installed))};
  }catch{return null;}
}

export async function checkForAppUpdate(force=false):Promise<AppUpdateInfo>{
  if(!window.SGBAndroid)return{currentVersion:'Versión web',latestVersion:null,updateAvailable:false,apkUrl:null,apkName:null,releaseUrl:null,notes:null,publishedAt:null,reason:'NO_ANDROID'};
  if(!force){const cached=cachedResult();if(cached)return cached;}
  if(runningCheck)return runningCheck;
  runningCheck=(async()=>{
    const response=await fetch(RELEASE_API,{headers:{Accept:'application/vnd.github+json'},cache:'no-store'});
    if(response.status===404){
      const value:AppUpdateInfo={currentVersion:currentVersion(),latestVersion:null,updateAvailable:false,apkUrl:null,apkName:null,releaseUrl:'https://github.com/jesusmedrandam/lafortuna/releases',notes:null,publishedAt:null,reason:'NO_RELEASE'};
      localStorage.setItem(CACHE_KEY,JSON.stringify({savedAt:Date.now(),value}));return value;
    }
    if(!response.ok)throw new Error(`GitHub no respondió correctamente (HTTP ${response.status}).`);
    const value=fromRelease(await response.json() as GitHubRelease);
    localStorage.setItem(CACHE_KEY,JSON.stringify({savedAt:Date.now(),value}));
    return value;
  })().finally(()=>{runningCheck=null;});
  return runningCheck;
}

export function startAppUpdate(info:AppUpdateInfo) {
  if(!info.apkUrl||!info.apkName)throw new Error('La versión publicada no incluye un archivo APK.');
  const result=window.SGBAndroid?.downloadAppUpdate?.(info.apkUrl,info.apkName);
  if(!result)throw new Error('Esta descarga solo puede iniciarse desde la aplicación Android.');
  if(result==='ERROR')throw new Error('Android no pudo iniciar la descarga del APK.');
  return result;
}

export function isAppUpdateDownloaded(info:AppUpdateInfo|null) {
  if(!info?.apkName)return false;
  try{return window.SGBAndroid?.isAppUpdateDownloaded?.(info.apkName)===true;}catch{return false;}
}
