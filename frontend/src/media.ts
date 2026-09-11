export type MediaType='IMAGEN'|'VIDEO';
export type MediaPurpose='display'|'download'|'offline';

const imageDisplay='c_limit,w_2048,h_2048,q_auto:good,f_auto';
const imageDownload='c_limit,w_2048,h_2048,q_auto:good,f_jpg';
const videoDelivery='c_limit,w_1920,h_1920,q_auto:good,vc_h264,ac_aac,f_mp4';

export function optimizedCloudinaryMediaUrl(url:string,type:MediaType='IMAGEN',purpose:MediaPurpose='display'){
  const isCloudinaryUpload=url.includes('/image/upload/')||url.includes('/video/upload/');
  if(!url||!/^https?:\/\//i.test(url)||!isCloudinaryUpload)return url;
  const transformation=type==='VIDEO'?videoDelivery:purpose==='display'?imageDisplay:imageDownload;
  if(url.includes(`/upload/${transformation}/`))return url;
  return url.replace('/upload/',`/upload/${transformation}/`);
}
